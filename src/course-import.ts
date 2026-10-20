import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import {
  courseSchema,
  scheduleSchema,
  parseWeeks,
  type Schedule,
  type Occurrence,
} from './schedule.js';
import { shiftDay, wallTime, validTimeZone } from './timezone.js';

export type ImportPreview = { schedule: Schedule; summary: string; warnings: string[] };
// RFC 4180 reader: quoted commas, doubled quotes, BOM, multiline cells.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else throw new Error('CSV 引号格式错误');
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((s) => s.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(cell);
  if (row.some((s) => s.trim())) rows.push(row);
  return rows;
}
function stableId(value: string) {
  let hash = 2166136261;
  for (const c of value) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
export function importCourses(text: string, name: string, base: Schedule): ImportPreview {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new Error('课表文件不能超过 10 MB');
  if (/BEGIN:VCALENDAR/i.test(text)) return importIcs(text, base);
  if (name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    const schedule = scheduleSchema.parse(value.schedule ?? value);
    return {
      schedule,
      summary: `${schedule.courses.length} 条周课程，${schedule.events.length} 节日历课程`,
      warnings: [],
    };
  }
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一条课程');
  const aliases: Record<string, string> = {
    课程: 'name',
    课程名称: 'name',
    星期: 'weekday',
    开始: 'start',
    开始时间: 'start',
    结束: 'end',
    结束时间: 'end',
    周次: 'weeks',
    地点: 'location',
    教室: 'location',
    教师: 'teacher',
    颜色: 'color',
    编号: 'id',
  };
  const headers = rows[0].map((s) => aliases[s.trim()] ?? s.trim());
  for (const key of ['name', 'weekday', 'start', 'end'])
    if (!headers.includes(key)) throw new Error(`缺少列：${key}。请下载 CSV 模板`);
  const at = Date.now();
  const courses = rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行列数不正确`);
    const r = Object.fromEntries(headers.map((h, i) => [h, row[i].trim()]));
    const days: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    const day = Number(r.weekday) || days[r.weekday.replace(/星期|周/g, '')];
    return courseSchema.parse({
      id:
        r.id ||
        `csv-${stableId(JSON.stringify([r.name, day, r.start, r.end, r.weeks, r.location, r.teacher]))}`,
      name: r.name,
      weekday: day,
      start: r.start.padStart(5, '0'),
      end: r.end.padStart(5, '0'),
      weeks: parseWeeks(r.weeks ?? '', base.totalWeeks),
      location: r.location ?? '',
      teacher: r.teacher ?? '',
      color: r.color || '#4264b2',
      excludedDates: [],
      updatedAt: at,
    });
  });
  const unique = new Map(courses.map((c) => [c.id, c]));
  return {
    schedule: scheduleSchema.parse({
      ...base,
      courses: [...unique.values()],
      events: [],
      holidays: [],
    }),
    summary: `${unique.size} 条周课程`,
    warnings: unique.size < courses.length ? ['文件内重复课程已合并'] : [],
  };
}
function importIcs(text: string, base: Schedule): ImportPreview {
  const root = new ICAL.Component(ICAL.parse(text));
  const components = root.getAllSubcomponents('vevent');
  if (!components.length) throw new Error('ICS 中没有课程事件');
  if (components.length > 2000) throw new Error('ICS 事件过多，请按学期导出');
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const id = String(tz.getFirstPropertyValue('tzid'));
    ICAL.TimezoneService.register(new ICAL.Timezone({ component: tz, tzid: id }));
  }
  const events: Occurrence[] = [],
    warnings: string[] = [];
  const from = wallTime(base.semesterStart, '00:00', base.timeZone);
  const until = wallTime(shiftDay(base.semesterStart, base.totalWeeks * 7), '00:00', base.timeZone);
  const exceptions = components
    .filter((c) => c.hasProperty('recurrence-id'))
    .map((c) => new ICAL.Event(c));
  const at = Date.now();
  let iterations = 0;
  for (const component of components) {
    if (component.hasProperty('recurrence-id')) continue;
    const event = new ICAL.Event(component, {
      exceptions: exceptions.filter(
        (e) => e.uid === String(component.getFirstPropertyValue('uid')),
      ),
    });
    if (String(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') continue;
    if (event.startDate.isDate) {
      warnings.push(`已跳过全天事件：${event.summary}`);
      continue;
    }
    const tzid = String(component.getFirstProperty('dtstart')?.getParameter('tzid') ?? '');
    const convert = (time: ICAL.Time) => {
      if (time.zone?.tzid === 'UTC') return time.toUnixTime() * 1000;
      const zone = time.zone?.tzid && time.zone.tzid !== 'floating' ? time.zone.tzid : tzid;
      if (validTimeZone(zone || base.timeZone)) {
        return Temporal.PlainDateTime.from(time.toString().replace(/Z$/, '')).toZonedDateTime(
          zone || base.timeZone,
          { disambiguation: 'compatible' },
        ).epochMilliseconds;
      }
      if (time.zone && time.zone.tzid !== 'floating') return time.toUnixTime() * 1000;
      throw new Error(`ICS 中的时区 ${zone} 不受支持，需提供 VTIMEZONE`);
    };
    const iterator = event.iterator();
    let occurrence: ICAL.Time | null;
    while ((occurrence = iterator.next())) {
      if (++iterations > 20000) throw new Error('ICS 重复次数超限，请只导出当前学期');
      const details = event.getOccurrenceDetails(occurrence);
      const start = convert(details.startDate),
        end = convert(details.endDate);
      if (start >= until) break;
      if (end <= from) continue;
      if (
        String(details.item.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED'
      )
        continue;
      const uid = event.uid || stableId(component.toString());
      events.push({
        id: `ics-${stableId(uid)}@${occurrence.toString()}`,
        courseId: `ics-${stableId(uid)}`,
        name: details.item.summary || '课程',
        location: details.item.location || '',
        teacher: String(details.item.component.getFirstPropertyValue('description') ?? '').slice(
          0,
          300,
        ),
        color: '#4264b2',
        start,
        end,
        timeZone:
          tzid && validTimeZone(tzid)
            ? tzid
            : event.startDate.zone?.tzid === 'UTC'
              ? 'UTC'
              : base.timeZone,
        updatedAt: at,
      });
      if (events.length > 15000) throw new Error('课程数量超过上限');
    }
  }
  if (!events.length) throw new Error('当前学期范围内没有可导入课程，请先设置开学日期和周数');
  return {
    schedule: scheduleSchema.parse({ ...base, courses: [], events, holidays: [] }),
    summary: `${events.length} 节课程（已展开重复规则和例外日期）`,
    warnings: [...new Set(warnings)],
  };
}
export const csvTemplate =
  '课程名称,星期,开始时间,结束时间,周次,教室,教师\n示例课程,1,08:00,09:40,1-16,H4306,\n单双周示例,3,09:00,11:30,1-15单,实验楼,\n';
