import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import type { RecurrenceDefinition } from './event-model.js';
import { shiftDay, wallTime, zoneDateKey, zoneClock } from './timezone.js';

const normalizeRecurrenceTime = (date: string) =>
  date.length === 19 && date.endsWith(':00') ? date.slice(0, 16) : date;
export const occurrenceKey = (date: string, zone: string) =>
  `${normalizeRecurrenceTime(date)}[${zone}]`;

/** Use the existing RFC 5545 implementation. Timezone conversion stays in Temporal. */
export function validateRrule(text: string) {
  const value = text
    .trim()
    .replace(/^RRULE:/i, '')
    .toUpperCase();
  const recur = ICAL.Recur.fromString(value);
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(recur.freq))
    throw new Error('重复频率支持 DAILY、WEEKLY、MONTHLY、YEARLY');
  if (recur.interval < 1 || !Number.isSafeInteger(recur.interval)) throw new Error('重复间隔无效');
  if (recur.count !== null && recur.count !== undefined && recur.count < 1)
    throw new Error('重复次数必须大于零');
  if (recur.count && recur.until) throw new Error('COUNT 与 UNTIL 只能选择一个');
  // ical.js ignores unknown keys. Reject them before they can silently change dates.
  const keys = new Set([
    'FREQ',
    'INTERVAL',
    'COUNT',
    'UNTIL',
    'WKST',
    'BYSECOND',
    'BYMINUTE',
    'BYHOUR',
    'BYDAY',
    'BYMONTHDAY',
    'BYYEARDAY',
    'BYWEEKNO',
    'BYMONTH',
    'BYSETPOS',
  ]);
  const seen = new Set<string>();
  for (const part of value.split(';')) {
    const [key, input, extra] = part.split('=');
    if (!keys.has(key) || !input || extra !== undefined || seen.has(key))
      throw new Error(`RRULE 字段无效 ${key}`);
    if (
      ['INTERVAL', 'COUNT'].includes(key) &&
      (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(Number(input)))
    )
      throw new Error(`${key} 必须为正整数`);
    seen.add(key);
  }
  return value;
}

export function recurrenceDates(definition: RecurrenceDefinition, through: string): string[] {
  const start = normalizeRecurrenceTime(definition.dtstart);
  const dates = new Set<string>([start, ...definition.rdate.map(normalizeRecurrenceTime)]);
  if (definition.rrule) {
    const recur = ICAL.Recur.fromString(validateRrule(definition.rrule));
    // ical.js normalizes an implicit February 29 to March 1 in non-leap years.
    // Explicit RFC default components retain invalid-date skipping and COUNT semantics.
    if (
      recur.freq === 'YEARLY' &&
      !['BYDAY', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO'].some((key) => key in recur.parts)
    ) {
      if (!('BYMONTH' in recur.parts)) recur.setComponent('BYMONTH', [Number(start.slice(5, 7))]);
      recur.setComponent('BYMONTHDAY', [Number(start.slice(8, 10))]);
    }
    // RRULE iteration uses local wall clocks. UTC UNTIL must be compared as an instant.
    const untilInstant = recur.until?.zone?.tzid === 'UTC' ? recur.until.toUnixTime() * 1000 : null;
    if (untilInstant !== null) {
      recur.until = ICAL.Time.fromString(
        `${zoneDateKey(untilInstant, definition.timeZone)}T${zoneClock(untilInstant, definition.timeZone)}:00`,
        undefined,
      );
    }
    const iterator = recur.iterator(
      ICAL.Time.fromString(start.length === 10 ? start : `${start}:00`, undefined),
    );
    let iterations = 0;
    for (let time = iterator.next(); time; time = iterator.next()) {
      if (++iterations > 200000) throw new Error('重复规则计算超过上限，请缩小有效范围');
      const date = normalizeRecurrenceTime(time.toString());
      if (date.slice(0, 10) > through) break;
      if (
        untilInstant !== null &&
        wallTime(date.slice(0, 10), date.slice(11) || '00:00', definition.timeZone) > untilInstant
      )
        break;
      dates.add(date);
    }
  }
  const excluded = new Set(definition.exdate.map(normalizeRecurrenceTime));
  return [...dates].filter((date) => date.slice(0, 10) <= through && !excluded.has(date)).sort();
}

/** Convert only the Cron forms whose full calendar meaning is identical. */
export function cronToRecurrence(
  cron: string,
  firstDay: string,
  timeZone: string,
  dayStartsAt = '00:00',
): RecurrenceDefinition | null {
  const [minute, hour, day, month, dow] = cron.trim().split(/\s+/);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || Number(hour) > 23 || Number(minute) > 59)
    return null;
  const clock = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  // A pre-boundary Cron belongs to the preceding business day.
  if (clock < dayStartsAt) return null;
  let rrule: string;
  let dtstart = firstDay;
  if (day === '*' && month === '*' && dow === '*') rrule = 'FREQ=DAILY';
  else if (day === '*' && month === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    const days = [
      ...new Set(
        dow
          .split(',')
          .map(Number)
          .map((n) => n % 7),
      ),
    ];
    const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    for (let i = 0; i < 7; i++) {
      const candidate = shiftDay(firstDay, i);
      if (days.includes(Temporal.PlainDate.from(candidate).dayOfWeek % 7)) {
        dtstart = candidate;
        break;
      }
    }
    rrule = `FREQ=WEEKLY;BYDAY=${days.map((n) => names[n]).join(',')}`;
  } else if (/^\d+$/.test(day) && month === '*' && dow === '*') {
    rrule = `FREQ=MONTHLY;BYMONTHDAY=${Number(day)}`;
    let candidate = Temporal.PlainDate.from(firstDay).with({ day: 1 });
    while (true) {
      if (
        Number(day) <= candidate.daysInMonth &&
        candidate.with({ day: Number(day) }).toString() >= firstDay
      ) {
        dtstart = candidate.with({ day: Number(day) }).toString();
        break;
      }
      candidate = candidate.add({ months: 1 });
    }
  } else return null;
  return { dtstart: `${dtstart}T${clock}`, rrule, rdate: [], exdate: [], timeZone };
}

/** Include deleted rows and every ledger entry so a sequence number is never reused. */
export function nextInstanceId(prefix: string, ids: Iterable<string>) {
  let sequence = -1;
  for (const id of ids) {
    if (!id.startsWith(`${prefix}-`)) continue;
    const suffix = id.slice(prefix.length + 1);
    if (/^\d+$/.test(suffix)) sequence = Math.max(sequence, Number(suffix));
  }
  if (!Number.isSafeInteger(sequence + 1)) throw new Error('实例序号超出安全范围');
  return `${prefix}-${sequence + 1}`;
}
