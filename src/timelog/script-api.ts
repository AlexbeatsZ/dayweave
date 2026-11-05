/**
 * The read-only data a goal script can ask for (docs/goal-scripts.md). Every method here is a
 * pure function of saved data so the worker transport, the editor's test run and the unit
 * tests share one implementation. Times are epoch milliseconds; spans are clipped to the
 * requested range, which defaults to the judged period.
 */
import type { AppState, PlanGroup, Task, TaskList } from '../model.js';
import { courseOccurrences, type Schedule } from '../schedule.js';
import { getDayStart, getTimeZone, wallTime } from '../timezone.js';
import type { UsageEvent } from '../usage/domain.js';
import {
  clipped,
  dayRange,
  duration,
  goalPeriodKey,
  goalRange,
  goalStatus,
  liveSpans,
  RESULT_PERIODS,
  shiftDay,
  type Goal,
  type Span,
  type State,
} from './domain.js';

export type ScriptData = {
  timelog: State;
  tasks: Task[];
  lists: TaskList[];
  planGroups: PlanGroup[];
  schedule: Schedule;
};
export type ScriptPeriod = {
  key: string;
  kind: 'day' | 'week';
  start: number;
  end: number;
  /** True once the period has ended; only then does the result count. */
  settled: boolean;
  now: number;
  timeZone: string;
  dayStartsAt: string;
  /** Each business day of the period with its own range. */
  days: { date: string; start: number; end: number }[];
};
export type RangeQuery = { start?: number; end?: number };
export type RecordQuery = RangeQuery & {
  /** Activity names or ids; any of them. */
  activities?: string[];
  /** Every one of these tags is required. */
  tags?: string[];
  /** None of these tags may be present. */
  excludeTags?: string[];
  nature?: 'positive' | 'neutral' | 'negative';
};
export type TaskQuery = {
  tag?: string;
  /** Business dates, inclusive. */
  dueFrom?: string;
  dueTo?: string;
  completed?: boolean;
};
export type UsageQuery = RangeQuery & {
  /** Case-insensitive substrings of the application name; any of them. */
  apps?: string[];
  /** Case-insensitive substrings of the window title or URL; any of them. */
  search?: string[];
  kinds?: ('app' | 'web' | 'unlock' | 'media')[];
  /** Device names or ids. */
  devices?: string[];
};
/** Largest range one data call may cover; usage is paged from the device database. */
export const MAX_QUERY_DAYS = 62;

export function scriptPeriod(goal: Pick<Goal, 'period'>, key: string, now: number): ScriptPeriod {
  const first = goalPeriodKey(goal, key);
  const range = goalRange(goal, key);
  const count = goal.period === 'week' ? 7 : 1;
  return {
    key: first,
    kind: goal.period,
    ...range,
    settled: now >= range.end,
    now,
    timeZone: getTimeZone(),
    dayStartsAt: getDayStart(),
    days: Array.from({ length: count }, (_, index) => {
      const date = shiftDay(first, index);
      return { date, ...dayRange(date) };
    }),
  };
}
/** Resolves a query's range against the period and enforces the size limit. */
export function queryRange(query: RangeQuery | undefined, period: ScriptPeriod): Span {
  const start = query?.start ?? period.start,
    end = query?.end ?? period.end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('查询范围无效：end 须晚于 start');
  if (end - start > MAX_QUERY_DAYS * 86400000) throw new Error(`单次查询最多 ${MAX_QUERY_DAYS} 天`);
  return { start, end };
}
const lower = (values?: string[]) => values?.map((value) => value.toLowerCase());
const containsAny = (text: string, needles?: string[]) =>
  !needles?.length || needles.some((needle) => text.toLowerCase().includes(needle));
const instant = (value: string | null) => (value ? Date.parse(value) : null);

export function scriptRecords(data: ScriptData, period: ScriptPeriod, query: RecordQuery = {}) {
  const range = queryRange(query, period);
  const { timelog } = data;
  const names = new Map(timelog.activities.map((row) => [row.id, row.name]));
  const wanted = query.activities?.length
    ? new Set(
        timelog.activities
          .filter(
            (row) => query.activities!.includes(row.id) || query.activities!.includes(row.name),
          )
          .map((row) => row.id),
      )
    : null;
  const rows = [
    ...timelog.records
      .filter((row) => !row.deletedAt)
      .map((row) => ({ row, spans: row.spans, running: false })),
    ...(timelog.timer
      ? [{ row: timelog.timer, spans: liveSpans(timelog.timer, period.now), running: true }]
      : []),
  ];
  return rows
    .filter(
      ({ row }) =>
        (!wanted || wanted.has(row.activityId)) &&
        (!query.nature || row.nature === query.nature) &&
        (query.tags ?? []).every((tag) => row.tags.includes(tag)) &&
        !(query.excludeTags ?? []).some((tag) => row.tags.includes(tag)),
    )
    .map(({ row, spans, running }) => ({ row, running, spans: clipped(spans, range) }))
    .filter(({ spans }) => spans.length)
    .map(({ row, running, spans }) => ({
      id: row.id,
      activity: names.get(row.activityId) ?? '',
      activityId: row.activityId,
      nature: row.nature,
      tags: [...row.tags],
      note: row.note,
      taskId: row.taskId ?? null,
      running,
      start: spans[0].start,
      end: spans.at(-1)!.end,
      spans,
      minutes: duration(spans) / 60000,
    }))
    .sort((a, b) => a.start - b.start);
}
export function scriptActivities(data: ScriptData) {
  return data.timelog.activities
    .filter((row) => !row.deletedAt)
    .map(({ id, name, nature, color, archived }) => ({ id, name, nature, color, archived }));
}
export function scriptTasks(data: ScriptData, _period: ScriptPeriod, query: TaskQuery = {}) {
  const lists = new Map(data.lists.map((row) => [row.id, row.name]));
  const slots = new Map(data.planGroups.map((row) => [row.id, row.title]));
  return data.tasks
    .filter(
      (task) =>
        !task.deletedAt &&
        (!query.tag || task.tags.includes(query.tag)) &&
        (!query.dueFrom || (!!task.due && task.due >= query.dueFrom)) &&
        (!query.dueTo || (!!task.due && task.due <= query.dueTo)) &&
        (query.completed === undefined || !!task.completedAt === query.completed),
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      notes: task.notes,
      tags: [...task.tags],
      list: lists.get(task.listId) ?? '',
      due: task.due,
      slot: (task.planGroupId && slots.get(task.planGroupId)) || null,
      estimatedMinutes: task.estimatedMinutes ?? null,
      actualMinutes: task.actualMinutes ?? null,
      effort: task.effort ?? null,
      parentId: task.parentId,
      subtasks: task.subtasks.map(({ title, done }) => ({ title, done })),
      createdAt: Date.parse(task.createdAt),
      completedAt: instant(task.completedAt),
    }));
}
/** Daily-plan time slots (时段) on the period's dates, or `from`–`to` business dates. */
export function scriptSlots(
  data: ScriptData,
  period: ScriptPeriod,
  query: { from?: string; to?: string } = {},
) {
  const from = query.from ?? period.days[0].date,
    to = query.to ?? period.days.at(-1)!.date;
  return data.planGroups
    .filter((row) => !row.deletedAt && row.date >= from && row.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    .map((row) => {
      // A slot ending before the day boundary (e.g. 01:00 with a 04:00 start) is the next morning.
      const end = row.until
        ? wallTime(row.until < period.dayStartsAt ? shiftDay(row.date, 1) : row.date, row.until)
        : null;
      return {
        id: row.id,
        date: row.date,
        title: row.title,
        note: row.note,
        minutes: row.minutes,
        until: row.until,
        end,
        start: end !== null && row.minutes !== null ? end - row.minutes * 60000 : null,
      };
    });
}
export function scriptClasses(data: ScriptData, period: ScriptPeriod, query: RangeQuery = {}) {
  const range = queryRange(query, period);
  return courseOccurrences(data.schedule, range.start, range.end).map((row) => ({
    name: row.name,
    teacher: row.teacher,
    location: row.location,
    start: row.start,
    end: row.end,
  }));
}
/** Statuses of the other (non-script) goals for the same period. */
export function scriptGoals(data: ScriptData, period: ScriptPeriod) {
  return data.timelog.goals
    .filter((goal) => !goal.archived && goal.kind !== 'script')
    .map((goal) => {
      const status = goalStatus(data.timelog, goal, period.key, period.now, data.tasks);
      return {
        id: goal.id,
        name: goal.name,
        group: goal.group ?? '',
        kind: goal.kind ?? 'time',
        period: goal.period,
        met: status.met,
        within: status.within,
        progress: status.progress,
        target: status.target,
      };
    });
}
/** Automatic records (app/web/unlock/media observations) matching `query`, clipped to range. */
export function scriptUsage(events: UsageEvent[], range: Span, query: UsageQuery = {}) {
  const apps = lower(query.apps),
    search = lower(query.search),
    devices = query.devices;
  return events
    .filter(
      (event) =>
        !event.deleted &&
        event.end > range.start &&
        event.start < range.end &&
        (!query.kinds?.length || query.kinds.includes(event.kind)) &&
        (!devices?.length ||
          devices.includes(event.deviceId) ||
          devices.includes(event.deviceName)) &&
        containsAny(event.app, apps) &&
        (!search?.length || containsAny(`${event.title}\n${event.url}`, search)),
    )
    .map((event) => ({
      app: event.app,
      title: event.title,
      url: event.url,
      category: event.category,
      kind: event.kind,
      device: event.deviceName,
      deviceId: event.deviceId,
      platform: event.platform,
      start: Math.max(event.start, range.start),
      end: Math.min(event.end, range.end),
    }))
    .sort((a, b) => a.start - b.start);
}

/** Answers one script run's data calls; `usage` returns the raw events overlapping a range. */
export function scriptHost(
  data: ScriptData,
  period: ScriptPeriod,
  usage: (range: Span) => UsageEvent[],
) {
  return (method: string, query: unknown): unknown => {
    const q = (query ?? {}) as never;
    switch (method) {
      case 'records':
        return scriptRecords(data, period, q);
      case 'activities':
        return scriptActivities(data);
      case 'tasks':
        return scriptTasks(data, period, q);
      case 'slots':
        return scriptSlots(data, period, q);
      case 'classes':
        return scriptClasses(data, period, q);
      case 'goals':
        return scriptGoals(data, period);
      case 'usage': {
        const range = queryRange(q, period);
        return scriptUsage(usage(range), range, q);
      }
      default:
        throw new Error(`ctx.${method} 不存在`);
    }
  };
}
/** Period keys whose results are kept, oldest first and ending with the current period. */
export function resultPeriods(goal: Pick<Goal, 'period'>, today: string) {
  const last = goalPeriodKey(goal, today);
  const step = goal.period === 'week' ? 7 : 1;
  const count = RESULT_PERIODS[goal.period];
  return Array.from({ length: count }, (_, index) => shiftDay(last, (index - count + 1) * step));
}
/** Changes whenever data a script can read changes (automatic records excluded). */
export function dataStamp(state: Pick<AppState, 'timelog' | 'tasks' | 'planGroups' | 'schedule'>) {
  let stamp = 0;
  for (const row of state.timelog.records) stamp = Math.max(stamp, row.updatedAt);
  for (const row of state.timelog.goals)
    if (row.kind !== 'script') stamp = Math.max(stamp, row.updatedAt);
  for (const row of state.tasks) stamp = Math.max(stamp, Date.parse(row.updatedAt));
  for (const row of state.planGroups) stamp = Math.max(stamp, Date.parse(row.updatedAt));
  return [
    stamp,
    state.timelog.records.length,
    state.tasks.length,
    state.planGroups.length,
    state.timelog.timer?.id ?? '',
    JSON.stringify(state.schedule).length,
  ].join(':');
}
