import { Temporal } from '@js-temporal/polyfill';

export const DEFAULT_ZONE = 'Asia/Shanghai';
let currentZone = DEFAULT_ZONE;
export const getTimeZone = () => currentZone;
export function validTimeZone(value: string) {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);
    return true;
  } catch {
    return false;
  }
}
export function setTimeZone(value: string) {
  if (!validTimeZone(value)) throw new Error('时区无效，请选择地区或输入如 Asia/Shanghai、-04:00');
  currentZone = value;
}
export function zonedDate(at = Date.now(), zone = currentZone) {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(zone);
}
export const zoneDateKey = (at = Date.now(), zone = currentZone) =>
  zonedDate(at, zone).toPlainDate().toString();
export const shiftDay = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
export const weekday = (date: string) => Temporal.PlainDate.from(date).dayOfWeek;
export function wallTime(date: string, time: string, zone = currentZone) {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: 'compatible',
  }).epochMilliseconds;
}
export const dayStart = (date: string, zone = currentZone) => wallTime(date, '00:00', zone);
/**
 * Business days (tasks, records, goals, statistics) may begin after midnight so late-night
 * work belongs to the day it continues. Course calendars keep the civil date above.
 */
export const DAY_START_PATTERN = /^0[0-6]:[0-5]\d$/;
let currentDayStart = '00:00';
export const getDayStart = () => currentDayStart;
export function setDayStart(value = '00:00') {
  if (!DAY_START_PATTERN.test(value) || value > '06:00')
    throw new Error('一天的开始时间须在 00:00 到 06:00 之间');
  currentDayStart = value;
}
export function businessDateKey(at = Date.now(), zone = currentZone, start = currentDayStart) {
  const local = zonedDate(at, zone);
  const date = local.toPlainDate();
  // Compare wall clocks rather than subtracting milliseconds, so DST days keep their boundary.
  return (
    local.toPlainTime().toString({ smallestUnit: 'minute' }) < start
      ? date.subtract({ days: 1 })
      : date
  ).toString();
}
export const businessDayStart = (date: string, zone = currentZone, start = currentDayStart) =>
  wallTime(date, start, zone);
export const zoneClock = (at: number, zone = currentZone) =>
  zonedDate(at, zone).toPlainTime().toString({ smallestUnit: 'minute' });
export const dateTimeInput = (at: number, zone = currentZone) =>
  `${zoneDateKey(at, zone)}T${zoneClock(at, zone)}`;
export function parseDateTimeInput(value: string, zone = currentZone) {
  return Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: 'compatible' })
    .epochMilliseconds;
}
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function zoneLabel(zone = currentZone, at = Date.now()) {
  return `${zone} · UTC${zonedDate(at, zone).offset}`;
}
export const timeZones = [
  ['Asia/Shanghai', '北京时间 · UTC+8'],
  ['-04:00', '固定 UTC−4'],
  ['America/New_York', '纽约 · 自动夏令时'],
  ['UTC', 'UTC'],
  ['Asia/Tokyo', '东京'],
  ['Europe/London', '伦敦'],
  ['America/Los_Angeles', '洛杉矶'],
] as const;
