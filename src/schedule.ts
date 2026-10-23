import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import {
  DEFAULT_ZONE,
  validTimeZone,
  zoneDateKey,
  shiftDay,
  weekday,
  wallTime,
} from './timezone.js';

export const zoneSchema = z.string().max(100).refine(validTimeZone, '无效时区');
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    try {
      const d = Temporal.PlainDate.from(s);
      return d.year >= 2000 && d.year <= 2200 && d.toString() === s;
    } catch {
      return false;
    }
  }, '日期无效');
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const coursePeriodSchema = z
  .object({
    start: clockSchema,
    end: clockSchema,
    section: z.enum(['morning', 'afternoon', 'evening']),
  })
  .strict()
  .refine((period) => period.end > period.start, '节次结束时间必须晚于开始时间');
export type CoursePeriod = z.infer<typeof coursePeriodSchema>;
export const defaultCoursePeriods: CoursePeriod[] = [
  ['08:00', '08:45', 'morning'],
  ['08:55', '09:40', 'morning'],
  ['09:55', '10:40', 'morning'],
  ['10:50', '11:35', 'morning'],
  ['11:45', '12:30', 'morning'],
  ['13:30', '14:15', 'afternoon'],
  ['14:25', '15:10', 'afternoon'],
  ['15:25', '16:10', 'afternoon'],
  ['16:20', '17:05', 'afternoon'],
  ['17:15', '18:00', 'afternoon'],
  ['18:30', '19:15', 'evening'],
  ['19:25', '20:10', 'evening'],
  ['20:20', '21:05', 'evening'],
].map(([start, end, section]) => ({ start, end, section: section as CoursePeriod['section'] }));
export const coursePeriodsSchema = z
  .array(coursePeriodSchema)
  .min(1)
  .max(30)
  .superRefine((periods, ctx) => {
    const sections = ['morning', 'afternoon', 'evening'];
    periods.forEach((period, index) => {
      const previous = periods[index - 1];
      if (
        previous &&
        (period.start < previous.end ||
          sections.indexOf(period.section) < sections.indexOf(previous.section))
      )
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: '节次需按上午、下午、晚上及时间顺序排列，时间不能重叠',
        });
    });
  });
export const courseSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(300),
    teacher: z.string().max(300).default(''),
    location: z.string().max(500).default(''),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default('#4264b2'),
    weekday: z.number().int().min(1).max(7),
    start: clockSchema,
    end: clockSchema,
    weeks: z.array(z.number().int().min(1).max(60)).min(1).max(60),
    excludedDates: z.array(calendarDateSchema).max(500).default([]),
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((c) => c.end > c.start, '结束时间应晚于开始时间；跨午夜课程请分成两条');
export const occurrenceSchema = z
  .object({
    id: z.string().min(1).max(500),
    courseId: z.string().max(200),
    name: z.string().min(1).max(300),
    teacher: z.string().max(300).default(''),
    location: z.string().max(500).default(''),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default('#4264b2'),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    timeZone: zoneSchema,
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((e) => e.end > e.start && e.end - e.start <= 7 * 86400000, '课程时间范围无效');
export const scheduleSchema = z
  .object({
    semesterStart: calendarDateSchema.refine((d) => weekday(d) === 1, '开学日期必须为周一'),
    totalWeeks: z.number().int().min(1).max(60),
    timeZone: zoneSchema,
    periods: coursePeriodsSchema.default(() =>
      defaultCoursePeriods.map((period) => ({ ...period })),
    ),
    courses: z.array(courseSchema).max(2000),
    events: z.array(occurrenceSchema).max(15000),
    holidays: z.array(calendarDateSchema).max(1000),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const k of ['courses', 'events'] as const)
      if (new Set(s[k].map((x) => x.id)).size !== s[k].length)
        ctx.addIssue({ code: 'custom', path: [k], message: 'ID 重复' });
    if (s.courses.some((c) => c.weeks.some((w) => w > s.totalWeeks)))
      ctx.addIssue({ code: 'custom', path: ['courses'], message: '上课周次超出学期范围' });
  });
export type Course = z.infer<typeof courseSchema>;
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export function emptySchedule(): Schedule {
  const day = zoneDateKey(Date.now(), DEFAULT_ZONE);
  return {
    semesterStart: shiftDay(day, 1 - weekday(day)),
    totalWeeks: 20,
    timeZone: DEFAULT_ZONE,
    periods: defaultCoursePeriods.map((period) => ({ ...period })),
    courses: [],
    events: [],
    holidays: [],
  };
}
export function semesterWeek(schedule: Schedule, date: string) {
  return (
    Math.floor(
      Temporal.PlainDate.from(schedule.semesterStart).until(Temporal.PlainDate.from(date)).days / 7,
    ) + 1
  );
}
export function courseOccurrences(schedule: Schedule, from = 0, until = Infinity): Occurrence[] {
  const results = schedule.events.filter((e) => e.end > from && e.start < until);
  const holidays = new Set(schedule.holidays);
  for (const course of schedule.courses)
    for (const week of new Set(course.weeks)) {
      const date = shiftDay(schedule.semesterStart, (week - 1) * 7 + course.weekday - 1);
      if (holidays.has(date) || course.excludedDates.includes(date)) continue;
      const start = wallTime(date, course.start, schedule.timeZone),
        end = wallTime(date, course.end, schedule.timeZone);
      if (end <= from || start >= until) continue;
      results.push({
        id: `${course.id}@${date}`,
        courseId: course.id,
        name: course.name,
        teacher: course.teacher,
        location: course.location,
        color: course.color,
        start,
        end,
        timeZone: schedule.timeZone,
        updatedAt: course.updatedAt,
      });
    }
  return results.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export function nextClasses(schedule: Schedule, now = Date.now()) {
  const events = courseOccurrences(schedule, now);
  return {
    current: events.filter((e) => e.start <= now && e.end > now),
    next: events.find((e) => e.start > now) ?? null,
  };
}
export function mergeSchedule(local: Schedule, incoming: Schedule): Schedule {
  if (
    local.courses.length &&
    incoming.courses.length &&
    (local.semesterStart !== incoming.semesterStart ||
      local.timeZone !== incoming.timeZone ||
      local.totalWeeks !== incoming.totalWeeks)
  )
    throw new Error('学期起始、周数或课程时区不同，请先在课表设置中统一');
  const merge = <T extends { id: string; updatedAt: number }>(a: T[], b: T[]) => {
    const map = new Map(a.map((x) => [x.id, x]));
    for (const x of b) {
      const old = map.get(x.id);
      if (old && old.updatedAt === x.updatedAt && JSON.stringify(old) !== JSON.stringify(x))
        throw new Error(`同版本课程冲突：${x.id}`);
      if (!old || old.updatedAt < x.updatedAt) map.set(x.id, x);
    }
    return [...map.values()];
  };
  return scheduleSchema.parse({
    ...local,
    ...(!local.courses.length
      ? {
          semesterStart: incoming.semesterStart,
          totalWeeks: incoming.totalWeeks,
          timeZone: incoming.timeZone,
          periods: incoming.periods,
        }
      : {}),
    courses: merge(local.courses, incoming.courses),
    events: merge(local.events, incoming.events),
    holidays: [...new Set([...local.holidays, ...incoming.holidays])],
  });
}
export function parseWeeks(value: string, max = 20): number[] {
  const clean = value
    .replace(/[周第\s]/g, '')
    .replaceAll('，', ',')
    .replaceAll('、', ',');
  if (!clean) return Array.from({ length: max }, (_, i) => i + 1);
  const odd = clean.includes('单'),
    even = clean.includes('双');
  const nums = clean
    .replace(/[单双()（）]/g, '')
    .split(',')
    .flatMap((part) => {
      const m = part.match(/^(\d+)(?:[-~至](\d+))?$/);
      if (!m) throw new Error(`周次格式无效：${value}`);
      const start = +m[1],
        end = +(m[2] ?? m[1]);
      if (start < 1 || end > max || start > end) throw new Error('周次超出学期范围');
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    });
  return [...new Set(nums)]
    .filter((w) => (!odd && !even) || (odd ? w % 2 === 1 : w % 2 === 0))
    .sort((a, b) => a - b);
}
