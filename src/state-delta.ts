import { z } from 'zod';
import { stateSchema, type AppState } from './model.js';

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
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffState(before: AppState, after: AppState): StateDelta {
  const delta: StateDelta = { entities: [] };
  for (const collection of ['tasks', 'lists', 'sessions'] as const) {
    const left = new Map(before[collection].map((item) => [item.id, item]));
    const right = new Map(after[collection].map((item) => [item.id, item]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const previous = left.get(id) ?? null,
        next = right.get(id) ?? null;
      if (!equal(previous, next))
        delta.entities.push({ collection, id, before: previous, after: next });
    }
  }
  if (!equal(before.settings, after.settings))
    delta.settings = { before: before.settings, after: after.settings };
  if (!equal(before.timer, after.timer)) delta.timer = { before: before.timer, after: after.timer };
  if (!equal(before.timelog, after.timelog) || !equal(before.schedule, after.schedule))
    delta.modules = {
      before: { timelog: before.timelog, schedule: before.schedule },
      after: { timelog: after.timelog, schedule: after.schedule },
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
  ) => {
    for (const key of Object.keys(after)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new Error('Invalid field');
      if (equal(before[key], after[key])) continue;
      if (key === 'updatedAt') {
        current[key] = [current[key], after[key]]
          .filter((x): x is string => typeof x === 'string')
          .sort()
          .at(-1);
        continue;
      }
      if (strict && !equal(current[key], before[key]) && !equal(current[key], after[key]))
        throw new StateConflict();
      current[key] = after[key];
    }
  };
  for (const change of delta.entities) {
    const rows = next[change.collection] as unknown as Array<Record<string, unknown>>;
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
  }
  if (delta.settings) patch(next.settings, delta.settings.before, delta.settings.after);
  if (delta.timer) {
    if (strict && !equal(next.timer, delta.timer.before) && !equal(next.timer, delta.timer.after))
      throw new StateConflict();
    next.timer = delta.timer.after as AppState['timer'];
  }
  if (delta.modules) {
    const b = delta.modules.before as Pick<AppState, 'timelog' | 'schedule'>,
      a = delta.modules.after as Pick<AppState, 'timelog' | 'schedule'>;
    for (const k of ['timelog', 'schedule'] as const)
      if (!equal(b[k], a[k])) {
        if (strict && !equal(next[k], b[k]) && !equal(next[k], a[k])) throw new StateConflict();
        (next as unknown as Record<string, unknown>)[k] = structuredClone(a[k]);
      }
  }
  return stateSchema.parse(next);
}
