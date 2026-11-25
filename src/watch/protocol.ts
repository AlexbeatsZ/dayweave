// Xiaomi Watch S4 quick app protocol: a compact view of today's tasks, the current timer and the
// next classes, and the few commands the watch may send. The hub (/watch) and the phone's offline snapshot
// share this module so the watch never re-implements business rules. See docs/design/watch.md.
import { z } from 'zod';
import { selectTasks, taskCompleted, toggleTask, type AppState } from '../model.js';
import { calendarOccurrences } from '../event-domain.js';
import { businessDateKey, zonedDate } from '../timezone.js';
import {
  activeActivity,
  duration,
  finishTimer,
  nextActivity,
  startTimer,
  toggleTimer,
} from '../timelog/domain.js';

export const WATCH_PROTOCOL = 1;
/** Watch → phone messages above 4 KB never reached the phone on a real S4; keep replies below it too. */
export const WATCH_MESSAGE_LIMIT = 4000;
/** Queued commands older than this are rejected rather than rewriting old history. */
export const WATCH_COMMAND_MAX_AGE = 7 * 86400000;
const TASK_LIMIT = 12;
const ACTIVITY_LIMIT = 6;
const CLASS_LIMIT = 4;
const CLASS_HORIZON = 7 * 86400000;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const id = z.string().min(1).max(100);
const at = z.number().int().nonnegative();
export const watchRequestSchema = z.discriminatedUnion('op', [
  z.object({ v: z.literal(1), id, op: z.literal('view') }),
  z.object({
    v: z.literal(1),
    id,
    op: z.literal('timer.start'),
    activityId: id,
    at,
    countdownMin: z.number().int().min(1).max(180).optional(),
  }),
  ...(['timer.pause', 'timer.resume', 'timer.stop'] as const).map((op) =>
    z.object({ v: z.literal(1), id, op: z.literal(op), timerId: id, at }),
  ),
  // Sets a countdown of `minutes` from now on the running timer; null turns it back into count-up.
  z.object({
    v: z.literal(1),
    id,
    op: z.literal('timer.countdown'),
    timerId: id,
    minutes: z.number().int().min(1).max(180).nullable(),
    at,
  }),
  z.object({
    v: z.literal(1),
    id,
    op: z.literal('timer.extend'),
    timerId: id,
    minutes: z.number().int().min(1).max(60),
    at,
  }),
  // Saves the current timer as a record and continues with another activity.
  z.object({ v: z.literal(1), id, op: z.literal('timer.next'), timerId: id, activityId: id, at }),
  z.object({
    v: z.literal(1),
    id,
    op: z.literal('task.complete'),
    taskId: id,
    expectedUpdatedAt: z.string().max(40),
    at,
  }),
]);
export type WatchRequest = z.infer<typeof watchRequestSchema>;
export type WatchCommand = Exclude<WatchRequest, { op: 'view' }>;
export type WatchErrorCode = 'offline' | 'conflict' | 'invalid' | 'not_found';

export type WatchView = {
  at: number;
  timer: {
    id: string;
    act: string;
    color: string;
    /** null while paused. */
    runningSince: number | null;
    /** Time already counted in closed spans. */
    spansMs: number;
    endAt: number | null;
  } | null;
  tasks: { id: string; t: string; u: string }[];
  acts: { id: string; n: string; c: string }[];
  presets: number[];
  /** Courses in progress or upcoming within a week; `d`/`hm` are formatted in the schedule zone. */
  classes: { n: string; l: string; c: string; s: number; e: number; d: string; hm: string }[];
};
export type WatchReply =
  | ({ v: 1; re: string; ok: true; stale: boolean } & WatchView)
  | { v: 1; re: string; ok: false; err: WatchErrorCode; msg: string };

export class WatchError extends Error {
  constructor(
    readonly code: WatchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function watchView(state: AppState, now: number): WatchView {
  const { timelog, settings } = state;
  const today = businessDateKey(now, settings.timeZone, settings.dayStartsAt ?? '00:00');
  const activities = timelog.activities.filter(activeActivity);
  const byId = new Map(timelog.activities.map((row) => [row.id, row]));
  // Recently used activities first, then the catalog order, so the watch offers what is likely next.
  const recent = [...timelog.records]
    .filter((row) => !row.deletedAt)
    .sort((a, b) => (b.spans.at(-1)?.end ?? 0) - (a.spans.at(-1)?.end ?? 0))
    .map((row) => row.activityId);
  const order = [...new Set([...recent, ...activities.map((row) => row.id)])]
    .map((activityId) => byId.get(activityId))
    .filter((row) => row && activeActivity(row))
    .slice(0, ACTIVITY_LIMIT);
  const timer = timelog.timer;
  const activity = timer ? byId.get(timer.activityId) : undefined;
  return {
    at: now,
    timer: timer
      ? {
          id: timer.id,
          act: activity?.name ?? '活动',
          color: activity?.color ?? '#8e8e93',
          runningSince: timer.runningSince,
          spansMs: duration(timer.spans),
          endAt: timer.plannedEndAt ?? null,
        }
      : null,
    tasks: selectTasks(state, 'today', '', 'manual', today)
      .filter((task) => !taskCompleted(task))
      .slice(0, TASK_LIMIT)
      .map((task) => ({ id: task.id, t: task.title.slice(0, 40), u: task.updatedAt })),
    acts: order.map((row) => ({ id: row!.id, n: row!.name.slice(0, 12), c: row!.color })),
    presets: timelog.settings.timerPresets ?? [],
    classes: watchClasses(state, now),
  };
}

function watchClasses(state: AppState, now: number): WatchView['classes'] {
  const zone = state.schedule.timeZone;
  const today = zonedDate(now, zone).toPlainDate();
  const hm = (at: number) => zonedDate(at, zone).toPlainTime().toString({ smallestUnit: 'minute' });
  return calendarOccurrences(
    state.calendarEvents.filter((row) => row.type === 'course'),
    now,
    now + CLASS_HORIZON,
  )
    .slice(0, CLASS_LIMIT)
    .map((row) => {
      const date = zonedDate(row.start, zone).toPlainDate();
      const days = date.since(today).days;
      return {
        n: row.name.slice(0, 20),
        l: (row.location ?? '').slice(0, 20),
        c: row.color,
        s: row.start,
        e: row.end,
        d: days === 0 ? '今天' : days === 1 ? '明天' : `周${WEEKDAYS[date.dayOfWeek - 1]}`,
        hm: `${hm(row.start)}–${hm(row.end)}`,
      };
    });
}

/** Time of a watch command: its own clock, never in the hub's future, never older than a week. */
function commandTime(command: WatchCommand, now: number) {
  if (command.at < now - WATCH_COMMAND_MAX_AGE) throw new WatchError('invalid', '操作已过期');
  return Math.min(command.at, now);
}

function domain<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof WatchError) throw error;
    throw new WatchError('conflict', error instanceof Error ? error.message : String(error));
  }
}

/** Applies one watch command with the same domain transitions the UI and REST API use. */
export function applyWatchCommand(state: AppState, command: WatchCommand, now: number): AppState {
  const time = commandTime(command, now);
  const timelog = state.timelog;
  if (command.op === 'task.complete') {
    const task = state.tasks.find((row) => row.id === command.taskId && !row.deletedAt);
    if (!task) throw new WatchError('not_found', '待办已删除');
    if (taskCompleted(task)) return state;
    if (task.updatedAt !== command.expectedUpdatedAt)
      throw new WatchError('conflict', '待办已在其他设备修改');
    return toggleTask(state, task.id);
  }
  if (command.op === 'timer.start') {
    const plannedEndAt = command.countdownMin ? time + command.countdownMin * 60000 : null;
    return {
      ...state,
      timelog: domain(() => startTimer(timelog, command.activityId, '', time, { plannedEndAt })),
    };
  }
  if (!timelog.timer || timelog.timer.id !== command.timerId)
    throw new WatchError('conflict', '计时已在其他设备变化');
  const timer = timelog.timer;
  const running = timer.runningSince !== null;
  if ((command.op === 'timer.pause' && !running) || (command.op === 'timer.resume' && running))
    return state;
  if (running && timer.plannedEndAt != null && timer.plannedEndAt <= time)
    throw new WatchError('conflict', '倒计时已结束');
  if (command.op === 'timer.countdown') {
    if (command.minutes !== null && !running) throw new WatchError('conflict', '请先继续计时');
    const plannedEndAt = command.minutes === null ? null : time + command.minutes * 60000;
    return { ...state, timelog: { ...timelog, timer: { ...timer, plannedEndAt } } };
  }
  if (command.op === 'timer.extend') {
    if (timer.plannedEndAt == null) throw new WatchError('conflict', '正计时不能延长');
    const plannedEndAt = timer.plannedEndAt + command.minutes * 60000;
    return { ...state, timelog: { ...timelog, timer: { ...timer, plannedEndAt } } };
  }
  if (command.op === 'timer.next')
    return {
      ...state,
      timelog: domain(() => nextActivity(timelog, command.activityId, time)),
    };
  return {
    ...state,
    timelog: domain(() =>
      command.op === 'timer.stop' ? finishTimer(timelog, time) : toggleTimer(timelog, time),
    ),
  };
}

export function watchReply(re: string, view: WatchView, stale = false): WatchReply {
  return { v: 1, re, ok: true, stale, ...view };
}

export function watchFailure(re: string, error: unknown): WatchReply {
  const known = error instanceof WatchError;
  return {
    v: 1,
    re,
    ok: false,
    err: known ? error.code : 'invalid',
    msg: (known ? error.message : '请求无效').slice(0, 60),
  };
}
