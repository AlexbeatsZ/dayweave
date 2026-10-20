import { buildTimeline, fillAdjacentGap, lastRecordEnd } from './timeline.js';
import {
  balance,
  dayKey,
  dayRange,
  finishTimer,
  goalProgress,
  liveSpans,
  duration,
  makeBackup,
  newId,
  natureLabels,
  startTimer,
  stats,
  timestamp,
  toggleTimer,
  type Activity,
  type Goal,
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

export async function handleApi(
  request: ApiRequest,
  storage: {
    readState: () => Promise<State>;
    mutateState: (fn: (state: State) => State) => Promise<State>;
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
      if (resource === 'stats' && !itemId) {
        const period = range(url);
        return {
          status: 200,
          body: { date: period.date, ...stats(state, period), balance: balance(state) },
        };
      }
      if (resource === 'activities') {
        const items = state.activities;
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
        const items = state.goals.map((goal) => ({
          ...goal,
          progressMinutes: goalProgress(state, goal, date),
        }));
        const item = itemId && items.find((row) => row.id === itemId);
        if (itemId && !item) fail(404, 'Goal not found');
        return { status: 200, body: item || { items, total: items.length, date } };
      }
      return fail(404, 'Route not found');
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) return fail(405, 'Method not allowed');
    const body = object(request.body);
    let result: unknown;
    await mutateState((state) => {
      const now = Date.now();
      if (resource === 'timer' && method === 'POST') {
        if (itemId === 'start') {
          const start = bool(body.fromPreviousRecord) ? lastRecordEnd(state, now) : now;
          if (!start) fail(409, 'No previous record to continue from');
          const next = startTimer(state, text(body.activityId), text(body.note), start);
          result = next.timer;
          return next;
        }
        if (!state.timer) return fail(409, 'No active timer');
        if (body.timerId !== state.timer.id)
          return fail(409, 'timerId does not match the active timer');
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
        const previous = itemId ? state.activities.find((row) => row.id === itemId) : undefined;
        if (itemId && !previous) fail(404, 'Activity not found');
        if (previous) expected(body, previous);
        if ((!itemId && method !== 'POST') || (itemId && !['PATCH', 'DELETE'].includes(method)))
          fail(405, 'Method not allowed');
        const nature = text(body.nature, previous?.nature || 'positive') as Nature;
        if (!(nature in natureLabels)) fail(400, 'nature must be positive, neutral or negative');
        const raw = number(body.pointsPerHour, previous?.pointsPerHour ?? 20);
        const item: Activity = {
          id: previous?.id || newId(),
          name: text(body.name, previous?.name),
          color: text(body.color, previous?.color || '#357a9e'),
          nature,
          pointsPerHour:
            nature === 'neutral' ? 0 : nature === 'negative' ? -Math.abs(raw) : Math.abs(raw),
          archived: method === 'DELETE' ? true : bool(body.archived, previous?.archived),
          updatedAt: timestamp(previous?.updatedAt),
        };
        if (state.timer?.activityId === item.id && item.archived)
          fail(409, 'Save the active timer before archiving its activity');
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
        const spans = body.spans === undefined ? previous?.spans : body.spans;
        if (!Array.isArray(spans) || !spans.length) fail(400, 'spans is required');
        const same = previous?.activityId === activityId;
        const item: TimeRecord = {
          id: previous?.id || text(body.id) || newId(),
          ...(previous?.taskId ? { taskId: previous.taskId } : {}),
          activityId,
          note: text(body.note, previous?.note),
          tags: (body.tags ?? previous?.tags ?? []) as string[],
          spans: spans as TimeRecord['spans'],
          pointsPerHour: same ? previous.pointsPerHour : activity.pointsPerHour,
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
        const base = {
          id: previous?.id || newId(),
          name: text(body.name, previous?.name),
          archived: method === 'DELETE' ? true : bool(body.archived, previous?.archived),
          updatedAt: timestamp(previous?.updatedAt),
        };
        const old = previous as Goal | undefined;
        const item: Goal = {
          ...base,
          activityId: text(body.activityId, old?.activityId),
          minutes: number(body.minutes, old?.minutes ?? 30),
          period: text(body.period, old?.period || 'day') as Goal['period'],
        };
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
