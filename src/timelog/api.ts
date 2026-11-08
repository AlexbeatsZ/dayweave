import { buildTimeline, fillAdjacentGap, lastRecordEnd } from './timeline.js';
import {
  activeActivity,
  adjustTimerStart,
  deleteActivity,
  dayKey,
  dayRange,
  finishTimer,
  goalStatus,
  parseGoalTarget,
  scriptResult,
  goalStages,
  emptyRule,
  type RecordRule,
  liveSpans,
  duration,
  makeBackup,
  newId,
  natureLabels,
  nextActivity,
  startTimer,
  stats,
  timestamp,
  toggleTimer,
  type Activity,
  goalPeriodKey,
  type Goal,
  type GoalTask,
  type Nature,
  type State,
  type TimeRecord,
} from './domain.js';

export type ApiRequest = { method: string; path: string; body?: unknown };
export type ApiResult = { status: number; body: unknown };
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
type TaskReference = { id: string; deletedAt: string | null };
/** Validate explicit API links in the same transaction as the record/timer write. */
export function linkedTaskId(value: unknown, tasks: readonly TaskReference[]) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    return fail(400, 'taskId must be a non-empty string of at most 100 characters or null');
  const task = tasks.find((row) => row.id === value);
  if (!task) return fail(404, 'Task not found for taskId');
  if (task.deletedAt) return fail(409, 'Task is deleted; restore it before linking');
  return task.id;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(400, 'JSON object required');
  return value as Record<string, unknown>;
};
const text = (value: unknown, fallback = ''): string => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return fail(400, 'String required');
  return value;
};
const number = (value: unknown, fallback = 0): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fail(400, 'Finite number required');
  return value;
};
const bool = (value: unknown, fallback = false): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') return fail(400, 'Boolean required');
  return value;
};
function expected(body: Record<string, unknown>, previous: { updatedAt: number }) {
  if (body.expectedUpdatedAt === undefined)
    fail(428, 'expectedUpdatedAt is required for edits/deletes');
  if (body.expectedUpdatedAt !== previous.updatedAt)
    fail(409, 'Entity changed. Read its latest version before editing.');
}
function range(url: URL) {
  const date = url.searchParams.get('date') || dayKey(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dayKey(dayRange(date).start) !== date)
    fail(400, 'date must be a real local YYYY-MM-DD date');
  return { date, ...dayRange(date) };
}
function timerStart(body: Record<string, unknown>, state: State, now: number) {
  if (body.startAt !== undefined && body.fromPreviousRecord === true)
    fail(400, 'Choose startAt or fromPreviousRecord');
  const start = bool(body.fromPreviousRecord)
    ? lastRecordEnd(state, now)
    : number(body.startAt, now);
  if (!start) return fail(409, 'No previous record to continue from');
  if (start < 946684800000 || start > now) fail(400, 'startAt must be a past UTC epoch instant');
  return start;
}
function plannedEnd(body: Record<string, unknown>, start: number, now: number) {
  if (body.endAt == null) return null;
  const end = number(body.endAt);
  if (end <= now || end - start < 1000)
    fail(400, 'endAt must be in the future and at least one second after startAt');
  return end;
}

export async function handleApi(
  request: ApiRequest,
  storage: {
    readState: () => Promise<State>;
    mutateState: (fn: (state: State, tasks: readonly TaskReference[]) => State) => Promise<State>;
    /** Tasks for task-bound goals; the standalone timelog module has none. */
    readTasks?: () => Promise<GoalTask[]>;
  },
): Promise<ApiResult> {
  const { readState, mutateState } = storage;
  try {
    const url = new URL(request.path, 'http://127.0.0.1');
    const segments = url.pathname.split('/').filter(Boolean);
    const action = segments[3];
    if (
      segments.length > 4 ||
      segments.length < 2 ||
      (action && !(segments[1] === 'records' && action === 'fill' && request.method === 'POST'))
    )
      fail(404, 'Route not found');
    if (segments[0] !== 'v1') return fail(404, 'Unknown API version');
    const resource = segments[1],
      itemId = segments[2];
    const method = request.method;
    if (method === 'GET') {
      const state = await readState();
      if (resource === 'health' && !itemId)
        return {
          status: 200,
          body: { app: 'Open Timelog', version: '0.3.0', apiVersion: 1 },
        };
      if (resource === 'openapi' && !itemId)
        return { status: 200, body: { url: '/api/v1/openapi.json' } };
      if (resource === 'timeline' && !itemId) {
        const { date } = range(url);
        return { status: 200, body: { date, items: buildTimeline(state, date, Date.now(), true) } };
      }
      if (resource === 'backup' && !itemId) return { status: 200, body: makeBackup(state) };
      if (resource === 'timer' && !itemId)
        return {
          status: 200,
          body: {
            timer: state.timer,
            elapsedMs: state.timer ? duration(liveSpans(state.timer, Date.now())) : 0,
          },
        };
      if (resource === 'settings' && !itemId) return { status: 200, body: state.settings };
      if (resource === 'stats' && !itemId) {
        const period = range(url);
        return {
          status: 200,
          body: { date: period.date, ...stats(state, period) },
        };
      }
      if (resource === 'activities') {
        const items = state.activities.filter((row) => !row.deletedAt);
        const item = itemId && items.find((row) => row.id === itemId);
        if (itemId && !item) fail(404, 'Activity not found');
        return { status: 200, body: item || { items, total: items.length } };
      }
      if (resource === 'records') {
        if (itemId) {
          const item = state.records.find((row) => row.id === itemId);
          if (!item) fail(404, 'Record not found');
          return { status: 200, body: item };
        }
        const date = url.searchParams.has('date') ? range(url) : null;
        const query = (url.searchParams.get('q') || '').toLocaleLowerCase();
        const offset = Number(url.searchParams.get('offset') || 0),
          limit = Number(url.searchParams.get('limit') || 100);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 500
        )
          fail(400, 'offset >= 0; limit must be 1..500');
        const items = state.records
          .filter(
            (row) =>
              (!row.deletedAt || url.searchParams.get('includeDeleted') === 'true') &&
              (!url.searchParams.has('activityId') ||
                row.activityId === url.searchParams.get('activityId')) &&
              (!url.searchParams.has('taskId') || row.taskId === url.searchParams.get('taskId')) &&
              (!date || row.spans.some((span) => span.start < date.end && span.end > date.start)) &&
              `${row.note} ${row.tags.join(' ')} ${state.activities.find((a) => a.id === row.activityId)?.name}`
                .toLocaleLowerCase()
                .includes(query),
          )
          .sort((a, b) => b.spans[0].start - a.spans[0].start);
        return {
          status: 200,
          body: { items: items.slice(offset, offset + limit), total: items.length, offset, limit },
        };
      }
      if (resource === 'goals') {
        const date = range(url).date;
        const tasks = (await storage.readTasks?.()) ?? [];
        const items = state.goals.map((goal) => {
          const status = goalStatus(state, goal, date, Date.now(), tasks);
          // met stays null until the period has ended. progress/target are minutes for
          // time goals, completed/due tasks for task goals and 0|1 for manual goals.
          return {
            ...goal,
            kind: goal.kind ?? 'time',
            periodKey: goalPeriodKey(goal, date),
            ...(goal.kind === undefined ? { progressMinutes: status.progress } : {}),
            // Script results come from the hub's distributed results; missing ones read as null.
            ...(goal.kind === 'script'
              ? (() => {
                  const result = scriptResult(state, goal, date);
                  return {
                    scriptName:
                      state.scripts?.find((row) => row.id === goal.scriptId)?.name ?? null,
                    scriptNote: result?.note ?? null,
                    scriptError: result?.error ?? null,
                  };
                })()
              : {}),
            progress: status.progress,
            target: status.target,
            settled: status.settled,
            met: status.met,
            // Thresholds reached out of stages + final target (1 level for unstaged goals).
            reached: status.reached,
            levels: status.levels,
          };
        });
        const item = itemId && items.find((row) => row.id === itemId);
        if (itemId && !item) fail(404, 'Goal not found');
        return { status: 200, body: item || { items, total: items.length, date } };
      }
      return fail(404, 'Route not found');
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) return fail(405, 'Method not allowed');
    const body = object(request.body);
    let result: unknown;
    await mutateState((state, tasks) => {
      const now = Date.now();
      if (resource === 'settings' && !itemId && method === 'PATCH') {
        expected(body, state.settings);
        if (!Array.isArray(body.timerPresets) || body.timerPresets.length > 30)
          fail(400, 'timerPresets must contain at most 30 durations in minutes');
        const timerPresets = [
          ...new Set(
            (body.timerPresets as unknown[]).map((value) => {
              const minutes = number(value);
              if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
                fail(400, 'Preset minutes must be integers in 1..10080');
              return minutes;
            }),
          ),
        ];
        const settings = {
          ...state.settings,
          timerPresets,
          updatedAt: timestamp(state.settings.updatedAt),
        };
        result = settings;
        return { ...state, settings };
      }
      if (resource === 'timer' && method === 'POST') {
        if (itemId === 'start') {
          if (state.timer || state.conflictedTimers?.length)
            fail(409, 'Finish the current timer before starting another');
          const start = timerStart(body, state, now);
          const next = startTimer(state, text(body.activityId), text(body.note), start, {
            plannedEndAt: plannedEnd(body, start, now),
            taskId: linkedTaskId(body.taskId, tasks),
            ...(body.tags === undefined ? {} : { tags: body.tags as string[] }),
          });
          result = next.timer;
          return next;
        }
        if (!state.timer) return fail(409, 'No active timer');
        if (body.timerId !== state.timer.id)
          return fail(409, 'timerId does not match the active timer');
        if (itemId === 'configure') {
          if (
            state.timer.runningSince !== null &&
            state.timer.plannedEndAt != null &&
            state.timer.plannedEndAt <= now
          )
            fail(409, 'Timer has ended; read the saved record before editing');
          let next =
            body.startAt !== undefined || body.fromPreviousRecord === true
              ? adjustTimerStart(state, timerStart(body, state, now), now)
              : state;
          const timer = { ...next.timer! };
          if (body.endAt !== undefined) timer.plannedEndAt = plannedEnd(body, timer.startedAt, now);
          if (body.note !== undefined) timer.note = text(body.note);
          if (body.tags !== undefined) timer.tags = body.tags as string[];
          if (body.taskId !== undefined) {
            const taskId = linkedTaskId(body.taskId, tasks);
            if (taskId === undefined) delete timer.taskId;
            else timer.taskId = taskId;
          }
          result = timer;
          return { ...next, timer };
        }
        if (itemId === 'next') {
          const next = nextActivity(state, text(body.activityId), now);
          result = next.timer;
          return next;
        }
        if (itemId === 'pause' || itemId === 'resume') {
          const already =
            itemId === 'pause'
              ? state.timer.runningSince === null
              : state.timer.runningSince !== null;
          const next = already ? state : toggleTimer(state, now);
          result = next.timer;
          return next;
        }
        if (itemId === 'stop') {
          const next = finishTimer(state, now);
          result = next.records.at(-1);
          return next;
        }
        if (itemId === 'cancel') {
          result = { cancelled: state.timer.id };
          return { ...state, timer: null };
        }
        return fail(404, 'Timer action not found');
      }
      if (resource === 'activities') {
        const previous = itemId
          ? state.activities.find((row) => row.id === itemId && !row.deletedAt)
          : undefined;
        if (itemId && !previous) fail(404, 'Activity not found');
        if (previous) expected(body, previous);
        if ((!itemId && method !== 'POST') || (itemId && !['PATCH', 'DELETE'].includes(method)))
          fail(405, 'Method not allowed');
        if (method === 'DELETE') {
          const next = deleteActivity(state, itemId!, now);
          result = { deleted: itemId };
          return next;
        }
        if (body.archived !== undefined) fail(400, 'Use DELETE to remove an activity');
        const nature = text(body.nature, previous?.nature || 'positive') as Nature;
        if (!(nature in natureLabels)) fail(400, 'nature must be positive, neutral or negative');
        const item: Activity = {
          id: previous?.id || newId(),
          name: text(body.name, previous?.name),
          color: text(body.color, previous?.color || '#357a9e'),
          nature,
          archived: false,
          ...(previous?.order === undefined ? {} : { order: previous.order }),
          updatedAt: timestamp(previous?.updatedAt),
        };
        result = item;
        return {
          ...state,
          activities: previous
            ? state.activities.map((row) => (row.id === item.id ? item : row))
            : [...state.activities, item],
        };
      }
      if (resource === 'records') {
        const previous = itemId ? state.records.find((row) => row.id === itemId) : undefined;
        if (itemId && !previous) fail(404, 'Record not found');
        if (previous) expected(body, previous);
        if (action === 'fill' && previous) {
          const index = number(body.spanIndex);
          if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            !['up', 'down'].includes(text(body.direction))
          )
            fail(400, 'Valid spanIndex and direction up/down required');
          const dateUrl = new URL('http://127.0.0.1');
          dateUrl.searchParams.set('date', text(body.date));
          const next = fillAdjacentGap(
            state,
            previous.id,
            index,
            previous.updatedAt,
            range(dateUrl).date,
            body.direction as 'up' | 'down',
            now,
          );
          result = next.records.find((row) => row.id === previous.id);
          return next;
        }
        if ((!itemId && method !== 'POST') || (itemId && !['PATCH', 'DELETE'].includes(method)))
          fail(405, 'Method not allowed');
        const activityId = text(body.activityId, previous?.activityId),
          activity = state.activities.find((row) => row.id === activityId);
        if (!activity) return fail(400, 'Unknown activityId');
        if (!activeActivity(activity) && previous?.activityId !== activityId)
          return fail(400, 'Choose an available activity');
        const spans = body.spans === undefined ? previous?.spans : body.spans;
        if (!Array.isArray(spans) || !spans.length) fail(400, 'spans is required');
        const same = previous?.activityId === activityId;
        const taskId =
          method !== 'DELETE' && body.taskId !== undefined
            ? linkedTaskId(body.taskId, tasks)
            : previous?.taskId;
        const item: TimeRecord = {
          id: previous?.id || text(body.id) || newId(),
          ...(taskId === undefined ? {} : { taskId }),
          activityId,
          note: text(body.note, previous?.note),
          tags: (body.tags ?? previous?.tags ?? []) as string[],
          spans: spans as TimeRecord['spans'],
          nature: same ? previous.nature : activity.nature,
          deletedAt:
            method === 'DELETE'
              ? now
              : body.restore === true
                ? null
                : (previous?.deletedAt ?? null),
          updatedAt: timestamp(previous?.updatedAt),
        };
        if (!previous && state.records.some((row) => row.id === item.id))
          fail(409, 'Record ID already exists');
        if (
          item.spans.some((span) => !span || typeof span.end !== 'number' || span.end > now + 60000)
        )
          fail(400, 'Record timestamps cannot be in the future');
        result = item;
        return {
          ...state,
          records: previous
            ? state.records.map((row) => (row.id === item.id ? item : row))
            : [...state.records, item],
        };
      }
      if (resource === 'goals') {
        const list = state.goals;
        const previous = itemId ? list.find((row) => row.id === itemId) : undefined;
        if (itemId && !previous) fail(404, 'Entity not found');
        if (previous) expected(body, previous);
        if ((!itemId && method !== 'POST') || (itemId && !['PATCH', 'DELETE'].includes(method)))
          fail(405, 'Method not allowed');
        if (method === 'DELETE') {
          result = { deleted: itemId };
          return { ...state, goals: state.goals.filter((goal) => goal.id !== itemId) };
        }
        if (body.archived !== undefined) fail(400, 'Use DELETE to remove a goal');
        const old = previous as Goal | undefined;
        if (body.check !== undefined) {
          // Manual goals are checked per period by the user or the AI; nothing else changes.
          if (old?.kind !== 'manual') return fail(400, 'Only manual goals can be checked');
          const check = object(body.check);
          const day = text(check.period, dayKey(now));
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || dayKey(dayRange(day).start) !== day)
            fail(400, 'check.period must be a real YYYY-MM-DD date');
          const period = goalPeriodKey(old, day);
          const by = text(check.by, 'ai');
          if (by !== 'user' && by !== 'ai') fail(400, 'check.by must be user or ai');
          const item: Goal = {
            ...old,
            checks: {
              ...old.checks,
              [period]: { done: bool(check.done, true), by: by as 'user' | 'ai', at: now },
            },
            updatedAt: timestamp(old.updatedAt),
          };
          result = item;
          return { ...state, goals: state.goals.map((row) => (row.id === item.id ? item : row)) };
        }
        const kind = text(body.kind, old?.kind ?? 'time');
        const group = body.group === null ? '' : text(body.group, old?.group).trim();
        const base = {
          id: previous?.id || newId(),
          name: text(body.name, previous?.name),
          ...(group ? { group } : {}),
          period: text(body.period, old?.period || 'day') as Goal['period'],
          archived: false,
          ...(old?.order === undefined ? {} : { order: old.order }),
          updatedAt: timestamp(previous?.updatedAt),
        };
        let item: Goal;
        if (kind === 'tasks')
          item = {
            ...base,
            kind,
            taskTag: text(body.taskTag, old?.kind === 'tasks' ? old.taskTag : '').trim(),
          };
        else if (kind === 'manual')
          item = { ...base, kind, checks: old?.kind === 'manual' ? old.checks : {} };
        else if (kind === 'script') {
          // Scripts live in the app's library; the API only points a goal at one.
          const scriptId = text(body.scriptId, old?.kind === 'script' ? old.scriptId : '');
          if (!state.scripts?.some((row) => row.id === scriptId))
            return fail(400, 'scriptId must name a script in the library');
          item = {
            ...base,
            kind,
            scriptId,
            params:
              body.params === undefined
                ? old?.kind === 'script'
                  ? old.params
                  : {}
                : (object(body.params) as Extract<Goal, { kind: 'script' }>['params']),
          };
        } else if (kind === 'time') {
          const timeGoal = old?.kind === undefined ? old : undefined;
          // "target" accepts the editor text (">9h", "<2h", "8-16h", "<1-3h"), which also
          // sets the stages; otherwise minutes/comparison keep the stored stages.
          let target: Pick<Extract<Goal, { kind?: undefined }>, 'minutes' | 'comparison'>;
          let stages: number[];
          try {
            const parsed =
              body.target !== undefined
                ? parseGoalTarget(text(body.target))
                : {
                    minutes: number(body.minutes, timeGoal?.minutes ?? 30),
                    comparison: text(body.comparison, timeGoal?.comparison || 'atLeast') as
                      'atLeast' | 'atMost',
                    stages: timeGoal?.stages,
                  };
            target = { minutes: parsed.minutes, comparison: parsed.comparison };
            if (target.comparison !== 'atLeast' && target.comparison !== 'atMost')
              fail(400, 'comparison must be atLeast or atMost');
            // An explicit "stages" (minutes, or null to clear) overrides the target text.
            stages =
              body.stages === undefined
                ? goalStages(parsed.stages ?? [], target)
                : body.stages === null
                  ? []
                  : Array.isArray(body.stages) &&
                      body.stages.every((value) => typeof value === 'number')
                    ? goalStages(body.stages as number[], target)
                    : fail(400, 'stages must be an array of minutes or null');
          } catch (error) {
            if (error instanceof ApiError) throw error;
            return fail(400, error instanceof Error ? error.message : String(error));
          }
          // "rules" replaces every rule (missing keys mean "any"); a bare activityId is the
          // older single-activity form. validateState checks ids and contradictions.
          const rules: RecordRule[] =
            body.rules !== undefined
              ? Array.isArray(body.rules)
                ? body.rules.map((rule) => ({ ...emptyRule(), ...object(rule) }) as RecordRule)
                : fail(400, 'rules must be an array')
              : body.activityId !== undefined
                ? [{ ...emptyRule(), activities: [text(body.activityId)] }]
                : (timeGoal?.rules ?? fail(400, 'rules or activityId is required'));
          item = {
            ...base,
            rules,
            ...target,
            ...(stages.length ? { stages } : {}),
          };
        } else return fail(400, 'kind must be time, tasks, manual or script');
        result = item;
        return {
          ...state,
          goals: previous
            ? state.goals.map((row) => (row.id === item.id ? item : row))
            : [...state.goals, item],
        };
      }
      return fail(404, 'Route not found');
    });
    return { status: method === 'POST' && !itemId ? 201 : 200, body: result };
  } catch (error) {
    return {
      status:
        error instanceof ApiError ? error.status : ((error as { status?: number }).status ?? 400),
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
