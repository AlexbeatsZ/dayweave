import { stateSchema, type AppState } from '../model.js';
import { type Timer, type TimeRecord, validateState } from '../timelog/domain.js';

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
export function toDocument(state: AppState): SyncDocument {
  const doc: SyncDocument = {};
  for (const collection of ['tasks', 'lists', 'sessions'] as const)
    for (const row of state[collection]) doc[entityKey(collection, row.id)] = { ...row };
  for (const collection of ['activities', 'goals', 'rewards', 'redemptions'] as const)
    for (const row of state.timelog[collection]) doc[entityKey(collection, row.id)] = { ...row };
  for (const collection of ['courses', 'events'] as const)
    for (const row of state.schedule[collection]) doc[entityKey(collection, row.id)] = { ...row };
  for (const row of state.timelog.records)
    doc[entityKey('records', row.id)] = {
      id: row.id,
      activityId: row.activityId,
      note: row.note,
      tags: row.tags,
      pointsPerHour: row.pointsPerHour,
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
        pointsPerHour: row.pointsPerHour,
        nature: row.nature,
        deletedAt: null,
        updatedAt: row.startedAt,
        ...(row.taskId ? { taskId: row.taskId } : {}),
        timing: {
          startAt: row.startedAt,
          endAt: null,
          runningSince: row.runningSince,
          spans: row.spans,
        },
      };
  doc.schedule = {
    semesterStart: state.schedule.semesterStart,
    totalWeeks: state.schedule.totalWeeks,
    timeZone: state.schedule.timeZone,
    holidays: state.schedule.holidays,
  };
  doc.preferences = { timeZone: state.settings.timeZone };
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
  if (!next.lists.some((x) => x.id === 'inbox'))
    next.lists.unshift({ id: 'inbox', name: '收集箱', color: '#7e8b8b', order: 0 });
  for (const task of next.tasks)
    if (!next.lists.some((l) => l.id === task.listId)) task.listId = 'inbox';
  const timers: Timer[] = [],
    records: TimeRecord[] = [];
  for (const row of rows('records')) {
    const t = row.timing as {
      startAt: number;
      endAt: number | null;
      runningSince: number | null;
      spans: TimeRecord['spans'];
    };
    const common = {
      id: row.id as string,
      activityId: row.activityId as string,
      note: row.note as string,
      tags: row.tags as string[],
      pointsPerHour: row.pointsPerHour as number,
      nature: row.nature as TimeRecord['nature'],
      ...(row.taskId ? { taskId: row.taskId as string } : {}),
    };
    if (t.endAt === null && !row.deletedAt)
      timers.push({
        ...common,
        startedAt: t.startAt,
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
    goals: rows('goals'),
    rewards: rows('rewards'),
    redemptions: rows('redemptions'),
    records,
    timer: timers[0] ?? null,
    conflictedTimers: timers.slice(1),
  });
  next.schedule = {
    ...next.schedule,
    ...doc.schedule,
    courses: rows('courses'),
    events: rows('events'),
  } as AppState['schedule'];
  next.settings = { ...next.settings, ...doc.preferences };
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
