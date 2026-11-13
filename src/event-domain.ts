import { Temporal } from '@js-temporal/polyfill';
import {
  calendarEventSchema,
  eventTemplateSchema,
  type CalendarEvent,
  type RecurrenceDefinition,
} from './event-model.js';
import {
  newTask,
  taskTemplateSchema,
  type AppState,
  type Task,
  type RecurrenceRule,
} from './model.js';
import { taskPrefix } from './task-domain.js';
import { nextInstanceId, occurrenceKey, recurrenceDates, validateRrule } from './recurrence.js';
import { dayStart, shiftDay, wallTime, zoneDateKey, weekday, businessDateKey } from './timezone.js';
import type { Occurrence } from './schedule.js';

const taskOccurrenceDate = (value: string, zone: string, start = '00:00') =>
  value.includes('T')
    ? businessDateKey(wallTime(value.slice(0, 10), value.slice(11), zone), zone, start)
    : value;

/** Existing widget/context consumers retain their occurrence projection and exact epoch bounds. */
export function calendarOccurrences(
  events: CalendarEvent[],
  from = 0,
  until = Infinity,
): Occurrence[] {
  return events
    .filter((event) => !event.deletedAt)
    .map((event) => ({
      id: event.id,
      courseId: taskPrefix(event.id),
      name: event.title,
      teacher: event.teacher,
      location: event.location,
      color: event.color,
      ...eventBounds(event),
      timeZone: event.timeZone,
      updatedAt: Date.parse(event.updatedAt),
    }))
    .filter((event) => event.end > from && event.start < until)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function eventDayCount(
  events: CalendarEvent[],
  preferences: { displayDays: 'auto' | 5 | 7; timeZone: string },
): 5 | 7 {
  if (preferences.displayDays !== 'auto') return preferences.displayDays;
  for (const event of events) {
    if (event.deletedAt) continue;
    const bounds = eventBounds(event);
    const first = event.allDay ? event.date : zoneDateKey(bounds.start, preferences.timeZone);
    const last = event.allDay
      ? shiftDay(event.date, event.durationDays - 1)
      : zoneDateKey(bounds.end - 1, preferences.timeZone);
    for (let date = first, count = 0; date <= last && count < 7; date = shiftDay(date, 1), count++)
      if (weekday(date) > 5) return 7;
  }
  return 5;
}

export function newEvent(
  input: Partial<CalendarEvent> & Pick<CalendarEvent, 'title' | 'date'>,
): CalendarEvent {
  const at = new Date().toISOString();
  return calendarEventSchema.parse({
    id: `${crypto.randomUUID()}-0`,
    type: 'other',
    notes: '',
    location: '',
    teacher: '',
    color: '#4264b2',
    allDay: false,
    periods: input.allDay ? [] : [['09:00', '10:00']],
    durationDays: 1,
    timeZone: 'Asia/Shanghai',
    recurrenceId: null,
    source: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    ...input,
  });
}

export function eventBounds(event: CalendarEvent) {
  return event.allDay
    ? {
        start: dayStart(event.date, event.timeZone),
        end: dayStart(shiftDay(event.date, event.durationDays), event.timeZone),
      }
    : {
        start:
          wallTime(event.date, event.periods[0][0], event.timeZone) + (event.precision?.start ?? 0),
        end:
          wallTime(
            shiftDay(event.date, event.durationDays - 1),
            event.periods.at(-1)![1],
            event.timeZone,
          ) + (event.precision?.end ?? 0),
      };
}
export function eventsOnDate(events: CalendarEvent[], date: string, zone: string) {
  const from = dayStart(date, zone),
    until = dayStart(shiftDay(date, 1), zone);
  return events
    .filter((event) => {
      if (event.deletedAt) return false;
      if (event.allDay)
        return date >= event.date && date < shiftDay(event.date, event.durationDays);
      const bounds = eventBounds(event);
      return bounds.start < until && bounds.end > from;
    })
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        eventBounds(a).start - eventBounds(b).start ||
        a.id.localeCompare(b.id),
    );
}

/** A single-instance edit never changes its recurrence identity or source mapping. */
export function saveEvent(
  state: AppState,
  event: CalendarEvent,
  revision?: string,
  scope: 'single' | 'future' | 'all' = 'single',
): AppState {
  const previous = state.calendarEvents.find((row) => row.id === event.id);
  if (previous && (previous.deletedAt || previous.updatedAt !== revision))
    throw new Error('日程已在其他位置修改，请重新打开后编辑');
  if (!previous && state.tasks.some((row) => row.id === event.id)) throw new Error('ID 已存在');
  const at = new Date().toISOString();
  const template = eventTemplateSchema.strip().parse(event);
  const fields = Object.keys(template) as (keyof typeof template)[];
  const patch = previous
    ? Object.fromEntries(
        fields
          .filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(template[field]))
          .map((field) => [field, template[field]]),
      )
    : template;
  const prefix = taskPrefix(event.id);
  const delta = previous
    ? Temporal.PlainDate.from(previous.date).until(Temporal.PlainDate.from(event.date)).days
    : 0;
  const selected = (row: CalendarEvent) =>
    row.id === event.id || (scope === 'all' && taskPrefix(row.id) === prefix && !row.deletedAt);
  const rows = state.calendarEvents.map((row) =>
    selected(row)
      ? calendarEventSchema.parse({
          ...row,
          ...patch,
          date: row.id === event.id ? event.date : shiftDay(row.date, delta),
          updatedAt: at,
        })
      : row,
  );
  if (!previous) rows.push({ ...event, updatedAt: at });
  return {
    ...state,
    calendarEvents: rows,
    recurrences:
      scope === 'single'
        ? state.recurrences
        : state.recurrences.map((rule) => {
            if (rule.prefix !== prefix || rule.target !== 'event') return rule;
            return {
              ...rule,
              eventTemplate: eventTemplateSchema.parse({ ...rule.eventTemplate, ...patch }),
              definitions: rule.definitions.map((definition) => ({
                ...definition,
                ...('timeZone' in patch ? { timeZone: template.timeZone } : {}),
                eventTemplate: eventTemplateSchema.parse({
                  ...(definition.eventTemplate ?? rule.eventTemplate),
                  ...patch,
                }),
              })),
              updatedAt: at,
            };
          }),
  };
}

export function deleteEvent(
  state: AppState,
  id: string,
  wholeSeries = false,
  revision?: string,
): AppState {
  const at = new Date().toISOString(),
    prefix = taskPrefix(id);
  const target = state.calendarEvents.find((row) => row.id === id);
  if (revision && target?.updatedAt !== revision)
    throw new Error('日程已在其他位置修改，请重新打开后删除');
  const selected = state.calendarEvents.filter(
    (row) => row.id === id || (wholeSeries && taskPrefix(row.id) === prefix),
  );
  const keys = new Set(selected.flatMap((row) => (row.recurrenceId ? [row.recurrenceId] : [])));
  return {
    ...state,
    calendarEvents: state.calendarEvents.map((row) =>
      selected.includes(row)
        ? {
            ...row,
            deletedAt: at,
            updatedAt: at,
            source: row.source ? { ...row.source, cancelled: false } : null,
          }
        : row,
    ),
    recurrences: state.recurrences.map((rule) =>
      rule.prefix !== prefix
        ? rule
        : {
            ...rule,
            enabled: wholeSeries ? false : rule.enabled,
            updatedAt: at,
            definitions: rule.definitions.map((definition) => ({
              ...definition,
              exdate: [
                ...new Set([
                  ...definition.exdate,
                  ...[...keys]
                    .filter((key) => key.endsWith(`[${definition.timeZone}]`))
                    .map((key) => key.slice(0, key.lastIndexOf('[')))
                    .filter((value) => value.includes('T') === definition.dtstart.includes('T')),
                ]),
              ],
            })),
          },
    ),
  };
}

/** Rules affect new occurrences. Applying properties to persisted instances is an explicit action. */
export function configureRecurrence(
  state: AppState,
  entity: Task | CalendarEvent,
  target: 'task' | 'event',
  definitions: RecurrenceDefinition[],
  enabled = true,
  dateOffsets = [0],
): AppState {
  const prefix = taskPrefix(entity.id),
    at = new Date().toISOString();
  for (const definition of definitions) {
    if (definition.rrule) validateRrule(definition.rrule);
    recurrenceDates(definition, definition.dtstart.slice(0, 10));
  }
  const previous = state.recurrences.find((row) => row.prefix === prefix);
  const rule: RecurrenceRule = {
    prefix,
    target,
    definitions,
    enabled,
    dateOffsets,
    occurrences: { ...previous?.occurrences },
    ...(target === 'task'
      ? { taskTemplate: taskTemplateSchema.strip().parse(entity) }
      : { eventTemplate: eventTemplateSchema.strip().parse(entity) }),
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  };
  const firstDate =
    target === 'task'
      ? taskOccurrenceDate(
          definitions[0].dtstart,
          definitions[0].timeZone,
          state.settings.dayStartsAt,
        )
      : definitions[0].dtstart.slice(0, 10);
  const isFirst =
    target === 'task'
      ? Object.hasOwn((entity as Task).dates, firstDate)
      : (entity as CalendarEvent).date === firstDate;
  if (!previous && isFirst) {
    const first = definitions[0];
    rule.occurrences[occurrenceKey(first.dtstart, first.timeZone)] = entity.id;
  }
  return {
    ...state,
    recurrences: [...state.recurrences.filter((row) => row.prefix !== prefix), rule],
    // A series has exactly one active generator, including after a Cron-to-RRULE edit.
    repeatRules: state.repeatRules.map((row) =>
      row.prefix === prefix ? { ...row, enabled: false, updatedAt: at } : row,
    ),
    calendarEvents:
      target === 'event' && isFirst
        ? state.calendarEvents.map((row) =>
            row.id === entity.id && !row.recurrenceId
              ? {
                  ...row,
                  recurrenceId: occurrenceKey(definitions[0].dtstart, definitions[0].timeZone),
                }
              : row,
          )
        : state.calendarEvents,
  };
}

/** Only the elected hub invokes this inside the original serialized StateService write. */
export function generateRecurrences(state: AppState, through?: string, at = Date.now()): AppState {
  const today = zoneDateKey(at, state.settings.timeZone),
    target = through ?? shiftDay(today, 42);
  if (target > shiftDay(today, 366)) throw new Error('最多提前生成一年内的重复实例');
  const tasks = [...state.tasks],
    events = [...state.calendarEvents];
  const used = new Set([...tasks, ...events].map((row) => row.id));
  for (const rule of [...state.recurrences, ...state.repeatRules])
    for (const id of Object.values(rule.occurrences)) used.add(id);
  let generated = 0;
  const recurrences = state.recurrences.map((rule) => {
    if (!rule.enabled || generated >= 512) return rule;
    const occurrences = { ...rule.occurrences };
    for (const definition of rule.definitions) {
      const window =
        rule.target === 'event' && state.settings.calendarFeed?.enabled && !through
          ? shiftDay(today, 366)
          : target;
      const datesThrough =
        rule.target === 'task' && definition.dtstart.includes('T') ? shiftDay(window, 1) : window;
      for (const date of recurrenceDates(definition, datesThrough)) {
        const key = occurrenceKey(date, definition.timeZone);
        if (occurrences[key]) continue;
        if (generated >= 512) break;
        const id = nextInstanceId(rule.prefix, used);
        if (rule.target === 'task') {
          const day = taskOccurrenceDate(date, definition.timeZone, state.settings.dayStartsAt);
          if (day > window) continue;
          const template = rule.taskTemplate!;
          tasks.push(
            newTask(template.title, {
              ...template,
              id,
              dates: Object.fromEntries(
                rule.dateOffsets.map((offset) => [shiftDay(day, offset), null]),
              ),
              subtasks: template.subtasks
                .filter((row) => !row.deletedAt)
                .map((row) => ({
                  ...row,
                  id: crypto.randomUUID(),
                  done: false,
                  completedAt: null,
                  deletedAt: null,
                  history: [],
                })),
            }),
          );
        } else {
          const template = definition.eventTemplate ?? rule.eventTemplate!;
          events.push(
            newEvent({
              ...template,
              timeZone: definition.timeZone,
              id,
              date: date.slice(0, 10),
              recurrenceId: key,
            }),
          );
        }
        occurrences[key] = id;
        used.add(id);
        generated++;
      }
    }
    return JSON.stringify(occurrences) === JSON.stringify(rule.occurrences)
      ? rule
      : { ...rule, occurrences, updatedAt: new Date(at).toISOString() };
  });
  return { ...state, tasks, calendarEvents: events, recurrences };
}
