import { v5 as uuidv5 } from 'uuid';
import { businessDayStart, weekday } from './timezone.js';

const NAMESPACE = 'a6f235e3-802c-4aa1-972e-4f968b3510ee';
type Row = Record<string, any>;
/** Pure, deterministic, shared by file load, backup import and legacy sync baselines. */
export function migrateTaskState(input: unknown): unknown {
  if (!input || typeof input !== 'object' || (input as Row).version !== 1) return input;
  const state = structuredClone(input) as Row;
  if (!Array.isArray(state.tasks)) return input;
  const rows = new Map<string, Row>(state.tasks.map((row: Row) => [row.id, row]));
  if (rows.size !== state.tasks.length) throw new Error('旧数据存在重复任务 ID');
  const mapped = new Map<string, string>();
  const assigned = new Set<string>();
  const parents = new Map<string, string>();
  for (const row of state.tasks as Row[])
    if (row.parentId && rows.has(row.parentId)) parents.set(row.id, row.parentId);
  for (const row of state.tasks as Row[])
    if (row.spawnedId && rows.has(row.spawnedId)) {
      if (parents.has(row.spawnedId) && parents.get(row.spawnedId) !== row.id)
        throw new Error('重复任务链的父子引用不一致，请先修复原备份');
      parents.set(row.spawnedId, row.id);
    }
  const children = new Set(parents.values());
  const locate = (id: string): string => {
    const chain: string[] = [],
      visiting = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor && !mapped.has(cursor)) {
      if (visiting.has(cursor)) throw new Error('重复任务链存在循环，请先修复原备份');
      visiting.add(cursor);
      chain.push(cursor);
      cursor = parents.get(cursor);
    }
    for (const key of chain.reverse()) {
      const parent = parents.get(key),
        previous = parent && mapped.get(parent);
      const next = previous
        ? previous.replace(/-\d+$/, `-${Number(previous.match(/-(\d+)$/)![1]) + 1}`)
        : `${uuidv5(key, NAMESPACE)}-0`;
      if (assigned.has(next)) throw new Error('重复任务链存在分叉，请先修复原备份');
      assigned.add(next);
      mapped.set(key, next);
    }
    return mapped.get(id)!;
  };
  state.tasks.forEach((row: Row) => locate(row.id));
  const rules = new Map<string, Row>();
  const zone = state.settings?.timeZone ?? 'Asia/Shanghai';
  const dayStart = state.settings?.dayStartsAt ?? '00:00';
  for (const old of [...(state.tasks as Row[])].sort(
    (a, b) =>
      Number(mapped.get(a.id)!.match(/-(\d+)$/)![1]) -
      Number(mapped.get(b.id)!.match(/-(\d+)$/)![1]),
  )) {
    const id = mapped.get(old.id)!;
    if (old.repeat && old.repeat !== 'none') {
      const prefix = id.replace(/-\d+$/, '');
      const key = old.due ?? old.createdAt.slice(0, 10);
      const [hour, minute] = dayStart.split(':').map(Number);
      const cron = `${minute} ${hour} ${old.repeat === 'monthly' ? (old.repeatDay ?? Number(key.slice(-2))) : '*'} * ${old.repeat === 'weekly' ? weekday(key) % 7 : '*'}`;
      const existing = rules.get(prefix);
      const leaf = !children.has(old.id);
      const trigger = `${key}T${dayStart}`;
      const template = {
        title: old.title,
        notes: old.notes,
        estimatedMinutes: old.estimatedMinutes,
        difficulty: 'easy',
        ...(old.priority === undefined ? {} : { priority: old.priority }),
        listId: old.listId,
        tags: old.tags,
        subtasks: old.subtasks.map((row: Row) => ({
          id: row.id,
          title: row.title,
          done: false,
          completedAt: null,
          deletedAt: null,
          history: [],
        })),
        pinned: old.pinned,
        order: old.order,
      };
      if (!existing)
        rules.set(prefix, {
          prefix,
          cron,
          dateOffsets: [0],
          template,
          startAt: new Date(businessDayStart(key, zone, dayStart)).toISOString(),
          generatedThrough: null,
          occurrences: { [trigger]: id },
          enabled: !old.deletedAt,
          createdAt: old.createdAt,
          updatedAt: old.updatedAt,
        });
      else {
        existing.occurrences[trigger] = id;
        if (leaf)
          Object.assign(existing, { cron, enabled: !old.deletedAt, updatedAt: old.updatedAt });
      }
    }
  }
  for (const old of state.tasks as Row[]) {
    const rule = rules.get(mapped.get(old.id)!.replace(/-\d+$/, ''));
    if (rule) {
      if (old.due) rule.occurrences[`${old.due}T${dayStart}`] = mapped.get(old.id);
      if (!children.has(old.id)) rule.enabled = !old.deletedAt && old.repeat !== 'none';
    }
  }
  state.tasks = state.tasks.map((old: Row) => {
    const {
      due,
      planGroupId,
      repeat,
      repeatDay,
      parentId,
      spawnedId,
      priority,
      quadrant,
      effort,
      ...rest
    } = old;
    return {
      ...rest,
      id: mapped.get(old.id),
      dates: due ? { [due]: planGroupId ?? null } : {},
      difficulty: 'easy',
      ...(priority === undefined ? {} : { priority }),
      subtasks: old.subtasks.map((row: Row) => ({
        ...row,
        done: old.completedAt ? true : row.done,
        completedAt: null,
        deletedAt: null,
        history: [],
      })),
    };
  });
  const relink = (row: Row | null | undefined) => {
    if (row?.taskId && mapped.has(row.taskId)) row.taskId = mapped.get(row.taskId);
  };
  state.sessions?.forEach(relink);
  relink(state.timer);
  state.timelog?.records?.forEach(relink);
  relink(state.timelog?.timer);
  state.timelog?.conflictedTimers?.forEach(relink);
  state.repeatRules = [...rules.values()];
  state.version = 2;
  return state;
}
