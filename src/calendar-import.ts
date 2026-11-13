import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import type { AppState, RecurrenceRule } from './model.js';
import { type CalendarEvent, type CalendarSubscription } from './event-model.js';
import { calendarPrefix, eventFingerprint } from './event-migration.js';
import { newEvent } from './event-domain.js';
import { nextInstanceId } from './recurrence.js';
import { dayStart, shiftDay, validTimeZone, wallTime, zoneClock, zoneDateKey } from './timezone.js';

export type CalendarImportPreview = {
  sourceId: string;
  from: string;
  through: string;
  items: { uid: string; original: string; event: CalendarEvent | null }[];
  cancelled: string[];
  preserved: string[];
  warnings: string[];
};

function icalInstant(time: ICAL.Time, fallback: string): number {
  if (time.zone.tzid === 'UTC') return time.toUnixTime() * 1000;
  const zone = time.zone.tzid === 'floating' ? fallback : time.zone.tzid;
  if (validTimeZone(zone))
    return wallTime(
      time.toString().slice(0, 10),
      time.isDate ? '00:00' : time.toString().slice(11, 16),
      zone,
    );
  if (time.zone.tzid !== 'floating') return time.toUnixTime() * 1000;
  throw new Error(`日历时区无法解析 ${zone}`);
}

/** Calendar providers share this RFC 5545 path, including detached exceptions and all-day rows. */
export function previewCalendar(
  text: string,
  source: Pick<CalendarSubscription, 'id' | 'timeZone'>,
  from: string,
  through: string,
): CalendarImportPreview {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024)
    throw new Error('日历不能超过 10 MB');
  const root = new ICAL.Component(ICAL.parse(text));
  if (root.name !== 'vcalendar') throw new Error('文件不是 iCalendar 日历');
  for (const component of root.getAllSubcomponents('vtimezone')) {
    const tzid = String(component.getFirstPropertyValue('tzid'));
    ICAL.TimezoneService.register(new ICAL.Timezone({ component, tzid }));
  }
  const rows = root.getAllSubcomponents('vevent');
  if (rows.length > 20000) throw new Error('日历事件数量超过上限');
  const result: CalendarImportPreview = {
    sourceId: source.id,
    from,
    through,
    items: [],
    cancelled: [],
    preserved: [],
    warnings: [],
  };
  const exceptions = rows
    .filter((row) => row.hasProperty('recurrence-id'))
    .map((row) => new ICAL.Event(row));
  const masters = rows.filter((row) => !row.hasProperty('recurrence-id'));
  const seen = new Set<string>();
  let iterations = 0;
  const first = dayStart(from, source.timeZone),
    last = dayStart(shiftDay(through, 1), source.timeZone);
  const add = (
    uid: string,
    original: string,
    item: ICAL.Event,
    startDate: ICAL.Time,
    endDate: ICAL.Time,
    fallback = source.timeZone,
  ) => {
    if (String(item.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') {
      result.items.push({ uid, original, event: null });
      return;
    }
    const startZone = String(
      item.component.getFirstProperty('dtstart')?.getParameter('tzid') ?? fallback,
    );
    const endZone = String(
      item.component.getFirstProperty('dtend')?.getParameter('tzid') ?? startZone,
    );
    const start = icalInstant(startDate, startZone),
      end = icalInstant(endDate, endZone);
    if (end <= first || start >= last) return;
    const zoneName = startDate.zone.tzid;
    const timeZone = validTimeZone(zoneName)
      ? zoneName
      : validTimeZone(startZone)
        ? startZone
        : source.timeZone;
    const date = startDate.isDate ? startDate.toString() : zoneDateKey(start, timeZone);
    const endDateKey = endDate.isDate ? endDate.toString() : zoneDateKey(end, timeZone);
    const dayCount = Temporal.PlainDate.from(date).until(Temporal.PlainDate.from(endDateKey)).days;
    if (end <= start) {
      result.preserved.push(uid);
      result.warnings.push(`时间范围无效，保留原数据 ${item.summary || uid}`);
      return;
    }
    const event = newEvent({
      title: item.summary || '未命名日程',
      date,
      type: 'other',
      notes: String(item.component.getFirstPropertyValue('description') ?? ''),
      location: item.location || '',
      allDay: startDate.isDate,
      timeZone,
      periods: startDate.isDate ? [] : [[zoneClock(start, timeZone), zoneClock(end, timeZone)]],
      ...(startDate.isDate ? {} : { precision: { start: start % 60000, end: end % 60000 } }),
      durationDays: startDate.isDate ? dayCount : dayCount + 1,
      recurrenceId: original,
    });
    result.items.push({ uid, original, event });
  };
  for (const component of masters) {
    const uid = String(component.getFirstPropertyValue('uid') ?? '');
    if (!uid || seen.has(uid)) throw new Error('日历缺少唯一 UID 或包含重复的主事件，原数据保留');
    seen.add(uid);
    if (String(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') {
      result.cancelled.push(uid);
      continue;
    }
    const related = exceptions.filter((row) => row.uid === uid);
    const cancelledExceptions = related.filter(
      (row) => String(row.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED',
    );
    const cancellations = new Set(cancelledExceptions.map((row) => row.recurrenceId.toString()));
    for (const original of cancellations) result.items.push({ uid, original, event: null });
    if (
      related.some(
        (row) =>
          row.component.getFirstProperty('recurrence-id')?.getParameter('range') ===
          'THISANDFUTURE',
      )
    )
      throw new Error('此日历包含 RANGE=THISANDFUTURE 例外，请拆分系列后导入，原数据保留');
    const event = new ICAL.Event(component, {
      exceptions: related.filter((row) => !cancellations.has(row.recurrenceId.toString())),
    });
    const fallback = String(
      component.getFirstProperty('dtstart')?.getParameter('tzid') ?? source.timeZone,
    );
    const iterator = event.iterator();
    const originals = new Set<string>();
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      if (++iterations > 200000) throw new Error('日历重复展开超过上限，原数据保留');
      if (icalInstant(occurrence, fallback) >= last) break;
      if (cancellations.has(occurrence.toString())) continue;
      const details = event.getOccurrenceDetails(occurrence);
      originals.add(occurrence.toString());
      add(uid, occurrence.toString(), details.item, details.startDate, details.endDate, fallback);
    }
    // Detached exceptions can move into this window from a later original occurrence.
    for (const exception of related)
      if (
        !originals.has(exception.recurrenceId.toString()) &&
        !cancellations.has(exception.recurrenceId.toString())
      )
        add(
          uid,
          exception.recurrenceId.toString(),
          exception,
          exception.startDate,
          exception.endDate,
          fallback,
        );
  }
  for (const exception of exceptions)
    if (!seen.has(exception.uid))
      add(
        exception.uid,
        exception.recurrenceId.toString(),
        exception,
        exception.startDate,
        exception.endDate,
      );
  return result;
}

/** Import mutates Events and their shared allocation ledger. Task data is untouched. */
export function applyCalendarImport(
  state: AppState,
  preview: CalendarImportPreview,
  at = Date.now(),
): AppState {
  const timestamp = new Date(at).toISOString();
  const events = [...state.calendarEvents],
    recurrences = structuredClone(state.recurrences);
  const used = new Set([...state.tasks, ...events].map((row) => row.id));
  const warnings = [...preview.warnings];
  const incoming = new Set(preview.items.map((item) => JSON.stringify([item.uid, item.original])));
  const cancelled = new Set(preview.cancelled);
  const modified = (row: CalendarEvent) => row.source?.fingerprint !== eventFingerprint(row);
  for (const item of preview.items) {
    if (
      item.uid.endsWith('@dayweave') &&
      state.calendarEvents.some((row) => `${row.id}@dayweave` === item.uid)
    )
      continue;
    const prefix = calendarPrefix(JSON.stringify(['calendar', preview.sourceId, item.uid]));
    let rule = recurrences.find((row) => row.prefix === prefix);
    const existing = events.find(
      (row) =>
        row.source?.kind === 'calendar' &&
        row.source.id === preview.sourceId &&
        row.source.uid === item.uid &&
        row.recurrenceId === item.original,
    );
    if (!rule && item.event) {
      rule = {
        prefix,
        target: 'event',
        eventTemplate: {
          title: item.event.title,
          type: item.event.type,
          notes: item.event.notes,
          location: item.event.location,
          teacher: item.event.teacher,
          color: item.event.color,
          allDay: item.event.allDay,
          periods: item.event.periods,
          durationDays: item.event.durationDays,
          timeZone: item.event.timeZone,
        },
        definitions: [
          {
            dtstart: item.event.allDay
              ? item.event.date
              : `${item.event.date}T${item.event.periods[0][0]}`,
            rrule: null,
            rdate: [],
            exdate: [],
            timeZone: item.event.timeZone,
          },
        ],
        dateOffsets: [0],
        occurrences: {},
        enabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies RecurrenceRule;
      recurrences.push(rule);
    }
    if (!item.event) {
      if (existing && !existing.deletedAt && !modified(existing))
        events[events.indexOf(existing)] = {
          ...existing,
          deletedAt: timestamp,
          updatedAt: timestamp,
          source: { ...existing.source!, cancelled: true },
        };
      continue;
    }
    if (existing?.deletedAt && !existing.source?.cancelled) continue;
    if (existing && modified(existing)) {
      warnings.push(`保留独立修改 ${existing.title}`);
      continue;
    }
    const id = existing?.id ?? rule!.occurrences[item.original] ?? nextInstanceId(prefix, used);
    if (!existing && rule!.occurrences[item.original]) continue;
    const fingerprint = eventFingerprint(item.event);
    if (existing?.source?.fingerprint === fingerprint && !existing.deletedAt) continue;
    const next: CalendarEvent = {
      ...item.event,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      source: {
        kind: 'calendar',
        id: preview.sourceId,
        uid: item.uid,
        fingerprint,
        cancelled: false,
      },
    };
    if (existing) events[events.indexOf(existing)] = next;
    else events.push(next);
    rule!.occurrences = { ...rule!.occurrences, [item.original]: id };
    rule!.updatedAt = timestamp;
    used.add(id);
  }
  for (const row of events) {
    if (row.deletedAt || row.source?.kind !== 'calendar' || row.source.id !== preview.sourceId)
      continue;
    if (preview.preserved.includes(row.source.uid)) continue;
    if (
      !cancelled.has(row.source.uid) &&
      (row.date < preview.from ||
        row.date > preview.through ||
        incoming.has(JSON.stringify([row.source.uid, row.recurrenceId])))
    )
      continue;
    if (modified(row)) {
      warnings.push(`来源已移除，保留独立修改 ${row.title}`);
      continue;
    }
    events[events.indexOf(row)] = {
      ...row,
      deletedAt: timestamp,
      updatedAt: timestamp,
      source: { ...row.source, cancelled: true },
    };
  }
  return {
    ...state,
    calendarEvents: events,
    recurrences,
    calendarSubscriptions: state.calendarSubscriptions.map((row) =>
      row.id === preview.sourceId
        ? { ...row, checkedAt: at, error: [...new Set(warnings)].join('；').slice(0, 1000) }
        : row,
    ),
  };
}
