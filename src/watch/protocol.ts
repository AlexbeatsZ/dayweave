// Xiaomi Watch S4 quick app protocol: a compact view of the current timer and today's tasks,
// and the few commands the watch may send. The hub (/watch) and the phone's offline snapshot
// share this module so the watch never re-implements business rules. See docs/design/watch.md.
import { z } from 'zod';
import { selectTasks, taskCompleted, toggleTask, type AppState } from '../model.js';
import { businessDateKey } from '../timezone.js';
import {
  activeActivity,
  duration,
  finishTimer,
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
  };
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
  const running = timelog.timer.runningSince !== null;
  if ((command.op === 'timer.pause' && !running) || (command.op === 'timer.resume' && running))
    return state;
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
