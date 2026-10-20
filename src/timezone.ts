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
