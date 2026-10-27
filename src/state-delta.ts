import { z } from 'zod';
import { stateSchema, type AppState } from './model.js';
import { stable } from './sync/document.js';

const jsonObject = z.record(z.string().max(100), z.unknown());
export const deltaSchema = z
  .object({
    entities: z
      .array(
        z
          .object({
            collection: z.enum(['tasks', 'lists', 'sessions']),
            id: z.string().min(1).max(100),
            before: jsonObject.nullable(),
            after: jsonObject.nullable(),
          })
          .strict(),
      )
      .max(150000),
    settings: z.object({ before: jsonObject, after: jsonObject }).strict().optional(),
    modules: z.object({ before: z.unknown(), after: z.unknown() }).optional(),
    timer: z.object({ before: z.unknown(), after: z.unknown() }).strict().optional(),
  })
  .strict();
export type StateDelta = z.infer<typeof deltaSchema>;
export class StateConflict extends Error {
  constructor() {
    super('STATE_CONFLICT: 同一项数据已被其他操作修改，请导出未保存内容或重新读取。');
  }
}
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
type Row = Record<string, unknown> & { id: string };
function diffRows(before: Row[], after: Row[]) {
  const left = new Map(before.map((item) => [item.id, item]));
  const right = new Map(after.map((item) => [item.id, item]));
  return [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
    const previous = left.get(id) ?? null;
    const next = right.get(id) ?? null;
    return equal(previous, next) ? [] : [{ id, before: previous, after: next }];
  });
}

export function diffState(before: AppState, after: AppState): StateDelta {
  const delta: StateDelta = { entities: [] };
  for (const collection of ['tasks', 'lists', 'sessions'] as const) {
    delta.entities.push(
      ...diffRows(before[collection], after[collection]).map((change) => ({
        collection,
        ...change,
      })),
    );
  }
  if (!equal(before.settings, after.settings))
    delta.settings = { before: before.settings, after: after.settings };
  if (!equal(before.timer, after.timer)) delta.timer = { before: before.timer, after: after.timer };
  if (
    !equal(before.timelog, after.timelog) ||
    !equal(before.schedule, after.schedule) ||
    !equal(before.tagColors, after.tagColors)
  )
    delta.modules = {
      before: { timelog: before.timelog, schedule: before.schedule, tagColors: before.tagColors },
      after: { timelog: after.timelog, schedule: after.schedule, tagColors: after.tagColors },
    };
  return delta;
}

export function applyDelta(state: AppState, value: StateDelta, strict = true): AppState {
  const delta = deltaSchema.parse(value);
  const next = structuredClone(state);
  const patch = (
    current: Record<string, unknown>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    timestamps = true,
  ) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new Error('Invalid field');
      if (equal(before[key], after[key])) continue;
      if (timestamps && key === 'updatedAt' && typeof after[key] === 'number') {
        current[key] = Math.max(typeof current[key] === 'number' ? current[key] : 0, after[key]);
        continue;
      }
      if (timestamps && key === 'updatedAt' && typeof after[key] === 'string') {
        current[key] = [current[key], after[key]]
          .filter((x): x is string => typeof x === 'string')
          .sort()
          .at(-1);
        continue;
      }
      if (strict && !equal(current[key], before[key]) && !equal(current[key], after[key]))
        throw new StateConflict();
      if (Object.hasOwn(after, key)) current[key] = structuredClone(after[key]);
      else delete current[key];
    }
  };
  const applyChange = (
    rows: Array<Record<string, unknown>>,
    change: {
      id: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    },
  ) => {
    const index = rows.findIndex((item) => item.id === change.id);
    const current = rows[index];
    if (change.after === null) {
      if (current && strict && !equal(current, change.before)) throw new StateConflict();
      if (current) rows.splice(index, 1);
    } else if (change.before === null) {
      if (current && strict && !equal(current, change.after)) throw new StateConflict();
      if (!current) rows.push(structuredClone(change.after));
    } else {
      if (!current) {
        if (strict) throw new StateConflict();
        rows.push(structuredClone(change.after));
      } else patch(current, change.before, change.after);
    }
  };
  for (const change of delta.entities) applyChange(next[change.collection], change);
  if (delta.settings) patch(next.settings, delta.settings.before, delta.settings.after);
  if (delta.timer) {
    if (strict && !equal(next.timer, delta.timer.before) && !equal(next.timer, delta.timer.after))
      throw new StateConflict();
    next.timer = delta.timer.after as AppState['timer'];
  }
  if (delta.modules) {
    const schema = z.object({
      timelog: stateSchema.shape.timelog,
      schedule: stateSchema.shape.schedule,
      tagColors: stateSchema.shape.tagColors,
    });
    const before = schema.parse(delta.modules.before);
    const after = schema.parse(delta.modules.after);
    for (const module of ['timelog', 'schedule', 'tagColors'] as const) {
      const current = next[module] as unknown as Record<string, unknown>;
      const previous = before[module] as unknown as Record<string, unknown>;
      const changed = after[module] as unknown as Record<string, unknown>;
      const collections =
        module === 'timelog'
          ? ['activities', 'records', 'goals', 'rewards', 'redemptions']
          : module === 'schedule'
            ? ['courses', 'events']
            : [];
      for (const field of new Set([...Object.keys(previous), ...Object.keys(changed)])) {
        if (equal(previous[field], changed[field])) continue;
        if (collections.includes(field)) {
          const oldRows = previous[field] as Row[];
          const newRows = changed[field] as Row[];
          const rows = current[field] as Row[];
          if (equal(rows, oldRows) || equal(rows, newRows)) {
            current[field] = structuredClone(newRows);
            continue;
          }
          const oldIds = new Set(oldRows.map((row) => row.id));
          const newIds = new Set(newRows.map((row) => row.id));
          const reordered = !equal(
            oldRows.filter((row) => newIds.has(row.id)).map((row) => row.id),
            newRows.filter((row) => oldIds.has(row.id)).map((row) => row.id),
          );
          if (strict && reordered) throw new StateConflict();
          for (const change of diffRows(oldRows, newRows)) applyChange(rows, change);
          if (reordered) {
            const order = new Map(newRows.map((row, index) => [row.id, index]));
            rows.sort(
              (left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity),
            );
          }
        } else if (module === 'tagColors' || (module === 'timelog' && field === 'settings')) {
          patch(
            current[field] as Record<string, unknown>,
            previous[field] as Record<string, unknown>,
            changed[field] as Record<string, unknown>,
            module !== 'tagColors',
          );
        } else {
          patch(
            current,
            { [field]: previous[field] },
            Object.hasOwn(changed, field) ? { [field]: changed[field] } : {},
          );
        }
      }
    }
  }
  return stateSchema.parse(next);
}
