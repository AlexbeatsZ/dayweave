import { v5 as uuidv5 } from 'uuid';
import type { AppState, RecurrenceRule } from './model.js';
import { calendarEventSchema, type CalendarEvent, type EventTemplate } from './event-model.js';
import { shiftDay, zoneDateKey, zoneClock } from './timezone.js';
import { Temporal } from '@js-temporal/polyfill';
import type { Schedule } from './schedule.js';
import { taskPrefix } from './task-domain.js';
import { nextInstanceId, cronToRecurrence } from './recurrence.js';

const namespace = '19e27cdb-af57-4806-84d6-de5ba11229b7';
export const calendarPrefix = (value: string) => uuidv5(value, namespace);
export const eventFingerprint = (row: EventTemplate & { date: string }) =>
  JSON.stringify([
    row.title,
    row.type,
    row.notes,
    row.location,
    row.teacher,
    row.color,
    row.allDay,
    row.periods,
    row.durationDays,
    row.timeZone,
    row.date,
    row.precision,
  ]);

/** Legacy rows remain intact as import provenance and recovery input. No tag has special meaning. */
export function migrateArrangements<
  T extends {
    schedule: Schedule;
    tasks: { id: string }[];
    calendarEvents: CalendarEvent[];
    recurrences: RecurrenceRule[];
  },
>(state: T): T {
  if (
    !state.schedule.courses.length &&
    !state.schedule.events.length &&
    !state.calendarEvents.some((row) => row.source?.kind.startsWith('legacy-'))
  )
    return state;
  const events = [...state.calendarEvents];
  const recurrences = structuredClone(state.recurrences);
  const used = new Set([...state.tasks, ...events].map((row) => row.id));
  for (const rule of recurrences) for (const id of Object.values(rule.occurrences)) used.add(id);
  const known = new Map(
    events
      .filter((row) => row.source?.kind.startsWith('legacy-'))
      .map((row) => [row.source!.uid, row]),
  );
  const add = (event: CalendarEvent) => {
    const previous = known.get(event.source!.uid);
    if (!previous) {
      if ([...events, ...state.tasks].some((row) => row.id === event.id))
        throw new Error('旧课程迁移 ID 冲突，请保留原始备份');
      events.push(event);
      used.add(event.id);
      known.set(event.source!.uid, event);
    } else if (
      (!previous.deletedAt || previous.source?.cancelled) &&
      event.source!.revision !== previous.source!.revision &&
      previous.source!.fingerprint === eventFingerprint(previous)
    ) {
      const next = {
        ...event,
        id: previous.id,
        recurrenceId: previous.recurrenceId,
        createdAt: previous.createdAt,
      };
      events[events.indexOf(previous)] = next;
      known.set(event.source!.uid, next);
    }
  };
  for (const course of [...state.schedule.courses].sort((a, b) => a.id.localeCompare(b.id))) {
    const sibling = events.find(
      (row) => row.source?.kind === 'legacy-course' && row.source.id === course.id,
    );
    let prefix = sibling
      ? taskPrefix(sibling.id)
      : calendarPrefix(
          JSON.stringify(['course', state.schedule.semesterStart, course.name, course.teacher]),
        );
    const first = shiftDay(
      state.schedule.semesterStart,
      (Math.min(...course.weeks) - 1) * 7 + course.weekday - 1,
    );
    const dates = [...new Set(course.weeks)]
      .sort((a, b) => a - b)
      .map((week) => shiftDay(state.schedule.semesterStart, (week - 1) * 7 + course.weekday - 1));
    if (
      !sibling &&
      dates.some((date) =>
        events.some(
          (event) =>
            taskPrefix(event.id) === prefix &&
            event.recurrenceId === `${date}T${course.start}[${state.schedule.timeZone}]` &&
            event.source?.kind === 'legacy-course' &&
            event.source.id !== course.id,
        ),
      )
    )
      prefix = calendarPrefix(
        JSON.stringify(['legacy-overlap', state.schedule.semesterStart, course.id]),
      );
    const cancelled = new Set([...state.schedule.holidays, ...course.excludedDates]);
    const grid = state.schedule.periods.filter(
      (period) => period.start >= course.start && period.end <= course.end,
    );
    const periods: [string, string][] =
      grid[0]?.start === course.start && grid.at(-1)?.end === course.end
        ? grid.map((period) => [period.start, period.end])
        : [[course.start, course.end]];
    const template: EventTemplate = {
      title: course.name,
      type: 'course',
      notes: '',
      location: course.location,
      teacher: course.teacher,
      color: course.color,
      allDay: false,
      periods,
      durationDays: 1,
      timeZone: state.schedule.timeZone,
    };
    let rule = recurrences.find((row) => row.prefix === prefix);
    if (!rule) {
      const at = new Date(course.updatedAt).toISOString();
      rule = {
        prefix,
        target: 'event',
        definitions: [],
        eventTemplate: template,
        dateOffsets: [0],
        occurrences: {},
        enabled: true,
        createdAt: at,
        updatedAt: at,
      };
      recurrences.push(rule);
    }
    const dtstart = `${first}T${course.start}`;
    if (!sibling && !rule.definitions.some((definition) => definition.dtstart === dtstart)) {
      const interval =
        course.weeks.length > 1 &&
        course.weeks.slice(1).every((week, i) => week - course.weeks[i] === 2)
          ? 2
          : 1;
      const regular = dates.every((date, i) => date === shiftDay(first, i * 7 * interval));
      rule.definitions.push({
        dtstart,
        timeZone: state.schedule.timeZone,
        eventTemplate: template,
        rrule: regular ? `FREQ=WEEKLY;INTERVAL=${interval};COUNT=${dates.length}` : null,
        rdate: regular ? [] : dates.slice(1).map((date) => `${date}T${course.start}`),
        exdate: dates
          .filter((date) => cancelled.has(date))
          .map((date) => `${date}T${course.start}`),
      });
    }
    for (const date of dates) {
      const uid = `${course.id}@${date}`;
      const previous = known.get(uid);
      const original = `${date}T${course.start}[${state.schedule.timeZone}]`;
      if (!previous && rule.occurrences[original]) continue;
      const id = previous?.id ?? rule.occurrences[original] ?? nextInstanceId(prefix, used);
      const at = new Date(course.updatedAt).toISOString();
      const event = calendarEventSchema.parse({
        ...template,
        id,
        date,
        recurrenceId: original,
        source: {
          kind: 'legacy-course',
          id: course.id,
          uid,
          fingerprint: eventFingerprint({ ...template, date }),
          revision: JSON.stringify([course, cancelled.has(date)]),
          cancelled: cancelled.has(date),
        },
        createdAt: at,
        updatedAt: at,
        deletedAt: cancelled.has(date) ? at : null,
      });
      rule.occurrences[previous?.recurrenceId ?? original] = id;
      add(event);
    }
  }
  for (const old of state.schedule.events) {
    const date = zoneDateKey(old.start, old.timeZone);
    const last = zoneDateKey(old.end, old.timeZone);
    const days = Temporal.PlainDate.from(date).until(Temporal.PlainDate.from(last)).days + 1;
    const template: EventTemplate = {
      title: old.name,
      type: 'course',
      notes: '',
      location: old.location,
      teacher: old.teacher,
      color: old.color,
      allDay: false,
      periods: [[zoneClock(old.start, old.timeZone), zoneClock(old.end, old.timeZone)]],
      precision: { start: old.start % 60000, end: old.end % 60000 },
      durationDays: days,
      timeZone: old.timeZone,
    };
    const at = new Date(old.updatedAt).toISOString();
    add(
      calendarEventSchema.parse({
        ...template,
        date,
        id: `${calendarPrefix(`occurrence:${old.id}`)}-0`,
        recurrenceId: null,
        source: {
          kind: 'legacy-event',
          id: old.id,
          uid: old.id,
          fingerprint: eventFingerprint({ ...template, date }),
          revision: JSON.stringify(old),
        },
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      }),
    );
  }
  const legacyCourses = new Set(
    state.schedule.courses.flatMap((course) =>
      course.weeks.map(
        (week) =>
          `${course.id}@${shiftDay(state.schedule.semesterStart, (week - 1) * 7 + course.weekday - 1)}`,
      ),
    ),
  );
  const legacyEvents = new Set(state.schedule.events.map((row) => row.id));
  for (const row of events) {
    if (row.deletedAt || !row.source || !row.source.kind.startsWith('legacy-')) continue;
    const exists =
      row.source.kind === 'legacy-course'
        ? legacyCourses.has(row.source.uid)
        : legacyEvents.has(row.source.uid);
    if (!exists && row.source.fingerprint === eventFingerprint(row))
      events[events.indexOf(row)] = { ...row, deletedAt: row.updatedAt };
  }
  return { ...state, calendarEvents: events, recurrences };
}

export function arrangementMigrationReport(state: AppState) {
  return {
    legacyCourses: state.schedule.courses.length,
    legacyOccurrences: state.schedule.events.length,
    migratedEvents: state.calendarEvents.filter((row) => row.source?.kind.startsWith('legacy-'))
      .length,
    legacyRepeats: state.repeatRules.map((rule) => {
      const recurrence =
        rule.recurrence ??
        cronToRecurrence(
          rule.cron,
          zoneDateKey(Date.parse(rule.startAt), state.settings.timeZone),
          state.settings.timeZone,
          state.settings.dayStartsAt,
        );
      return {
        prefix: rule.prefix,
        cron: rule.cron,
        recurrence,
        warning: recurrence
          ? null
          : (rule.migrationWarning ?? '此 Cron 保留兼容执行，请核对后再调整为 RRULE'),
      };
    }),
    // Existing tags are user data. Older schemas provide no reliable event marker or times.
    needsReview: state.tasks
      .filter((task) => !task.deletedAt && task.tags.includes('事件'))
      .map((task) => ({
        id: task.id,
        title: task.title,
        reason: '普通标签无法证明这是日程，原待办及全部属性已保留',
      })),
  };
}
