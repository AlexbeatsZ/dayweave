import { mergeTaskEntity } from '../task-merge.js';
import { stateSchema, emptyState, type AppState } from '../model.js';
import { type Timer, type TimeRecord, validateState } from '../timelog/domain.js';
import { newTimeOverlaps, timeOccupancy } from '../timelog/occupancy.js';

export type Entity = Record<string, unknown>;
export type SyncDocument = Record<string, Entity>;
export type SyncConflict = {
  key: string;
  field: string;
  local: unknown;
  remote: unknown;
  reason: string;
  localPresent?: boolean;
};
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
export function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stable((value as Entity)[k]))
      .join(',') +
    '}'
  );
}
const entityKey = (collection: string, id: string) => collection + '/' + encodeURIComponent(id);
const ROOT_COLLECTIONS = [
  'tasks',
  'lists',
  'sessions',
  'planGroups',
  'repeatRules',
  'calendarEvents',
  'recurrences',
  'calendarSubscriptions',
] as const;
const TIMELOG_COLLECTIONS = [
  'activities',
  'goals',
  'scripts',
  'goalResults',
  'behaviorReviews',
] as const;
const SCHEDULE_COLLECTIONS = ['courses', 'events'] as const;
/** Removed collections older clients may still carry in a base; accepted and ignored. */
const LEGACY_COLLECTIONS = ['rewards', 'redemptions'];
const BASE_COLLECTIONS = new Set<string>([
  ...ROOT_COLLECTIONS,
  ...TIMELOG_COLLECTIONS,
  ...SCHEDULE_COLLECTIONS,
  'records',
  ...LEGACY_COLLECTIONS,
]);
/**
 * Keys a client's base document may contain: exactly what toDocument produces. Derived from
 * the same collection lists, so a new synced collection cannot be rejected by the hub.
 */
export function isDocumentKey(key: string): boolean {
  if (key === 'schedule' || key === 'preferences' || key === 'focus') return true;
  const slash = key.indexOf('/');
  return (
    slash > 0 &&
    key.indexOf('/', slash + 1) < 0 &&
    slash < key.length - 1 &&
    BASE_COLLECTIONS.has(key.slice(0, slash))
  );
}
export function toDocument(state: AppState): SyncDocument {
  const doc: SyncDocument = {};
  for (const collection of ROOT_COLLECTIONS)
    for (const row of state[collection])
      doc[entityKey(collection, 'prefix' in row ? row.prefix : row.id)] = { ...row };
  for (const collection of TIMELOG_COLLECTIONS)
    for (const row of state.timelog[collection] ?? [])
      doc[entityKey(collection, row.id)] = { ...row };
  for (const collection of SCHEDULE_COLLECTIONS)
    for (const row of state.schedule[collection]) doc[entityKey(collection, row.id)] = { ...row };
  for (const row of state.timelog.records)
    doc[entityKey('records', row.id)] = {
      id: row.id,
      activityId: row.activityId,
      note: row.note,
      tags: row.tags,
      nature: row.nature,
      deletedAt: row.deletedAt,
      updatedAt: row.updatedAt,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      timing: {
        startAt: row.spans[0].start,
        endAt: row.spans.at(-1)!.end,
        runningSince: null,
        spans: row.spans,
      },
    };
  for (const row of [state.timelog.timer, ...(state.timelog.conflictedTimers ?? [])])
    if (row)
      doc[entityKey('records', row.id)] = {
        id: row.id,
        activityId: row.activityId,
        note: row.note,
        tags: row.tags,
        nature: row.nature,
        deletedAt: null,
        updatedAt: row.startedAt,
        ...(row.taskId ? { taskId: row.taskId } : {}),
        timing: {
          startAt: row.startedAt,
          ...(row.plannedEndAt === undefined ? {} : { plannedEndAt: row.plannedEndAt }),
          endAt: null,
          runningSince: row.runningSince,
          spans: row.spans,
        },
      };
  doc.schedule = {
    semesterStart: state.schedule.semesterStart,
    totalWeeks: state.schedule.totalWeeks,
    timeZone: state.schedule.timeZone,
    displayDays: state.schedule.displayDays,
    periods: state.schedule.periods,
    holidays: state.schedule.holidays,
  };
  doc.preferences = {
    taskTagColors: state.tagColors.tasks,
    recordTagColors: state.tagColors.records,
    timeZone: state.settings.timeZone,
    ...(state.settings.calendarFeed ? { calendarFeed: state.settings.calendarFeed } : {}),
    ...(state.settings.dayStartsAt ? { dayStartsAt: state.settings.dayStartsAt } : {}),
    timerPresets: state.timelog.settings.timerPresets ?? [5, 30, 45, 60],
    timerPresetsUpdatedAt: state.timelog.settings.updatedAt,
  };
  if (state.timer) doc.focus = { ...state.timer };
  return doc;
}
export function fromDocument(doc: SyncDocument, local: AppState): AppState {
  const next = structuredClone(local);
  const rows = (name: string) =>
    Object.entries(doc)
      .filter(([k]) => k.startsWith(name + '/'))
      .map(([, row]) => structuredClone(row));
  next.tasks = rows('tasks') as AppState['tasks'];
  next.lists = rows('lists') as AppState['lists'];
  next.sessions = rows('sessions') as AppState['sessions'];
  next.planGroups = rows('planGroups') as AppState['planGroups'];
  next.repeatRules = rows('repeatRules') as AppState['repeatRules'];
  next.calendarEvents = rows('calendarEvents') as AppState['calendarEvents'];
  next.recurrences = rows('recurrences') as AppState['recurrences'];
  next.calendarSubscriptions = rows('calendarSubscriptions') as AppState['calendarSubscriptions'];
  if (!next.lists.some((x) => x.id === 'inbox'))
    next.lists.unshift({ id: 'inbox', name: '未分组', color: '#7e8b8b', order: 0 });
  for (const task of next.tasks)
    if (!next.lists.some((l) => l.id === task.listId)) task.listId = 'inbox';
  const timers: Timer[] = [],
    records: TimeRecord[] = [];
  for (const row of rows('records')) {
    const t = row.timing as {
      startAt: number;
      plannedEndAt?: number | null;
      endAt: number | null;
      runningSince: number | null;
      spans: TimeRecord['spans'];
    };
    const common = {
      id: row.id as string,
      activityId: row.activityId as string,
      note: row.note as string,
      tags: row.tags as string[],
      nature: row.nature as TimeRecord['nature'],
      ...(row.taskId ? { taskId: row.taskId as string } : {}),
    };
    if (t.endAt === null && !row.deletedAt)
      timers.push({
        ...common,
        startedAt: t.startAt,
        ...(t.plannedEndAt === undefined ? {} : { plannedEndAt: t.plannedEndAt }),
        runningSince: t.runningSince,
        spans: t.spans,
      });
    else if (t.spans.length)
      records.push({
        ...common,
        spans: t.spans,
        updatedAt: row.updatedAt as number,
        deletedAt: row.deletedAt as number | null,
      });
  }
  timers.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  next.timelog = validateState({
    ...next.timelog,
    activities: rows('activities'),
    // rewards/* and redemptions/* from older devices are ignored; points were removed.
    goals: rows('goals'),
    scripts: rows('scripts'),
    goalResults: rows('goalResults'),
    behaviorReviews: rows('behaviorReviews'),
    records,
    timer: timers[0] ?? null,
    settings: {
      ...next.timelog.settings,
      ...(doc.preferences?.timerPresets === undefined
        ? {}
        : {
            timerPresets: doc.preferences.timerPresets,
            updatedAt: doc.preferences.timerPresetsUpdatedAt ?? next.timelog.settings.updatedAt,
          }),
    },
    conflictedTimers: timers.slice(1),
  });
  next.schedule = {
    ...next.schedule,
    ...doc.schedule,
    courses: rows('courses'),
    events: rows('events'),
  } as AppState['schedule'];
  next.tagColors = {
    tasks: (doc.preferences?.taskTagColors ?? next.tagColors.tasks) as Record<string, string>,
    records: (doc.preferences?.recordTagColors ?? next.tagColors.records) as Record<string, string>,
  };
  const {
    taskTagColors: _taskColors,
    recordTagColors: _recordColors,
    timerPresets: _presets,
    timerPresetsUpdatedAt: _presetsAt,
    ...preferences
  } = doc.preferences ?? {};
  next.settings = { ...next.settings, ...preferences };
  if (!('dayStartsAt' in preferences)) delete next.settings.dayStartsAt;
  next.timer = (doc.focus ?? null) as AppState['timer'];
  // Running record remains authoritative when a stale offline focus timer arrives.
  if (next.timelog.timer) next.timer = null;
  return stateSchema.parse(next);
}
export function mergeDocuments(base: SyncDocument, local: SyncDocument, remote: SyncDocument) {
  const doc = structuredClone(remote),
    conflicts: SyncConflict[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    const before = base[key],
      after = local[key],
      current = remote[key];
    if (equal(before, after)) continue;
    if (equal(current, after)) continue;
    if ((key.startsWith('tasks/') || key.startsWith('calendarEvents/')) && after && current) {
      doc[key] = mergeTaskEntity(before, after, current);
      continue;
    }
    if (equal(current, before)) {
      if (after === undefined) delete doc[key];
      else doc[key] = structuredClone(after);
      continue;
    }
    if (after === undefined || current === undefined) {
      conflicts.push({
        key,
        field: '*',
        local: after ?? null,
        remote: current ?? null,
        reason: '对象已在另一设备修改或删除',
      });
      continue;
    }
    const result = { ...current };
    for (const field of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
      if (['__proto__', 'constructor', 'prototype'].includes(field))
        throw new Error('同步字段无效');
      const a = after[field],
        b = before?.[field],
        r = current[field];
      if (equal(a, b) || equal(a, r)) continue;
      if (field === 'updatedAt') {
        result[field] =
          typeof a === 'number' && typeof r === 'number'
            ? Math.max(a, r)
            : ([a, r]
                .filter((v) => typeof v === 'string')
                .sort()
                .at(-1) ?? a);
        continue;
      }
      if (key.startsWith('records/') && field === 'timing') {
        const incoming = a as { endAt: number | null },
          existing = r as { endAt: number | null };
        if (existing.endAt !== null && incoming.endAt === null) continue;
        if (existing.endAt === null && incoming.endAt !== null) {
          result[field] = structuredClone(a);
          continue;
        }
      }
      if (equal(r, b)) {
        if (a === undefined) delete result[field];
        else result[field] = structuredClone(a);
      } else
        conflicts.push({
          key,
          field,
          local: a ?? null,
          localPresent: Object.hasOwn(after, field),
          remote: r ?? null,
          reason: '同一字段在离线期间分别修改',
        });
    }
    doc[key] = result;
  }
  return { doc, conflicts };
}

/** Preserve the hub's accepted history and put colliding edits in the existing conflict journal. */
export function reconcileTimeOverlaps(
  merged: SyncDocument,
  authoritative: AppState,
  local: AppState,
  conflicts: SyncConflict[],
): AppState {
  const candidate = fromDocument(merged, local);
  const before = timeOccupancy(authoritative.timelog);
  const after = timeOccupancy(candidate.timelog);
  const overlaps = () =>
    new Map([...newTimeOverlaps(before, after)].map((error) => [error.detail.recordId, error]));
  let rejected = overlaps();
  if (!rejected.size) return candidate;
  const baseline = toDocument(authoritative);
  const doc = { ...merged };
  // Restoring a prior interval may expose another collision with a remaining edit.
  // Each pass restores an additional ID to its authoritative occupancy.
  while (rejected.size) {
    for (const [id, error] of rejected) {
      const key = entityKey('records', id);
      const existing = baseline[key];
      conflicts.push({
        key,
        field: '*',
        local: doc[key],
        remote: existing ?? null,
        reason: error.message,
      });
      if (existing) {
        doc[key] = existing;
        const activity = entityKey('activities', existing.activityId as string);
        doc[activity] ??= baseline[activity];
      } else delete doc[key];
      const previous = before.get(id);
      if (previous) after.set(id, previous);
      else after.delete(id);
    }
    rejected = overlaps();
  }
  return fromDocument(doc, local);
}

// Keep edits made while the HTTP request was in flight; send them on the next exchange.
export function overlayNewEdits(
  sent: SyncDocument,
  current: SyncDocument,
  received: SyncDocument,
  conflicts: SyncConflict[] = [],
): SyncDocument {
  const result = structuredClone(received);
  for (const key of new Set([...Object.keys(sent), ...Object.keys(current)])) {
    if (equal(sent[key], current[key])) continue;
    if (!current[key]) {
      if (received[key] && !equal(sent[key], received[key]))
        conflicts.push({
          key,
          field: '*',
          local: null,
          remote: received[key],
          reason: '同步期间删除的对象已在另一设备修改',
        });
      else delete result[key];
      continue;
    }
    if (sent[key] && !result[key]) {
      conflicts.push({
        key,
        field: '*',
        local: structuredClone(current[key]),
        remote: null,
        reason: '同步期间对象已在另一设备删除',
      });
      continue;
    }
    if (!sent[key]) {
      result[key] = structuredClone(current[key]);
      continue;
    }
    if ((key.startsWith('tasks/') || key.startsWith('calendarEvents/')) && result[key]) {
      result[key] = mergeTaskEntity(sent[key], current[key], result[key]);
      continue;
    }
    for (const field of new Set([...Object.keys(sent[key]), ...Object.keys(current[key])]))
      if (!equal(sent[key][field], current[key][field])) {
        if (
          key.startsWith('records/') &&
          field === 'timing' &&
          (result[key][field] as { endAt: number | null })?.endAt !== null &&
          (current[key][field] as { endAt: number | null })?.endAt === null
        )
          continue;
        if (current[key][field] === undefined) delete result[key][field];
        else result[key][field] = structuredClone(current[key][field]);
      }
  }
  return result;
}

/** Upgrade a persisted v1 sync baseline with the same migration as its complete state. */
export function migrateLegacyDocument(doc: SyncDocument): SyncDocument {
  if (!Object.entries(doc).some(([key, row]) => key.startsWith('tasks/') && 'due' in row))
    return doc;
  // fromDocument runs the common state migration, including all linked records/timers.
  const legacy = { ...emptyState(), version: 1 } as unknown as AppState;
  return toDocument(fromDocument(doc, legacy));
}

export function migrateLegacyConflicts(
  old: SyncDocument,
  conflicts: SyncConflict[],
): SyncConflict[] {
  const migrated = migrateLegacyDocument(old);
  if (stable(migrated) === stable(old)) return conflicts;
  const previousTasks = Object.entries(old).filter(([key]) => key.startsWith('tasks/'));
  const nextTasks = Object.entries(migrated).filter(([key]) => key.startsWith('tasks/'));
  const identities = new Map(previousTasks.map(([key], index) => [key, nextTasks[index]?.[0]]));
  return conflicts.map((conflict) => {
    const key = identities.get(conflict.key);
    if (!key) return conflict;
    if (conflict.field === '*' && conflict.local === null) return { ...conflict, key };
    const candidate = structuredClone(old);
    candidate[conflict.key] =
      conflict.field === '*'
        ? (structuredClone(conflict.local) as Entity)
        : { ...candidate[conflict.key], [conflict.field]: conflict.local };
    if (conflict.localPresent === false && conflict.field !== '*')
      delete candidate[conflict.key][conflict.field];
    return {
      ...conflict,
      key,
      field: '*',
      local: migrateLegacyDocument(candidate)[key],
      remote: migrated[key],
      reason: `${conflict.reason}（旧任务模型候选已迁移）`,
    };
  });
}
