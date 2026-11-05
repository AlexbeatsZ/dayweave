import { z } from 'zod';
import { mergeTaskEntity } from './task-merge.js';
import { migrateTaskState } from './task-migration.js';
import { validateCron } from './task-cron.js';
import {
  activeTask,
  finiteTaskDates,
  normalizeTask,
  setTaskDone,
  taskCompleted,
  taskCompletedOnDay,
} from './task-domain.js';
export {
  taskPrefix,
  taskSequence,
  finiteTaskDates,
  activeTask,
  changeSubtask,
  taskDaySubtasks,
  subtaskDay,
  taskCompleted,
  taskDoneOn,
  taskCompletedOnDay,
  taskDateLabel,
} from './task-domain.js';
import {
  initialState,
  validateState,
  mergeBackup,
  parseBackup,
  activeActivity,
  startTimer,
  newId,
  duration,
} from './timelog/domain.js';
import { moveOrder } from './order.js';
import { scheduleSchema, emptySchedule, mergeSchedule, zoneSchema } from './schedule.js';
import {
  businessDateKey,
  weekday,
  shiftDay as shiftCalendarDay,
  DAY_START_PATTERN,
} from './timezone.js';

export const idSchema = z.string().min(1).max(100);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d, 12);
    return (
      y >= 2000 &&
      y <= 2200 &&
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    );
  }, '日期无效');
const instant = z.string().datetime();
export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
export const listSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(60),
    color: colorSchema,
    activityId: idSchema.nullable().optional(),
    order: z.number().finite(),
  })
  .strict();
export const completionEventSchema = z
  .object({ id: idSchema, at: instant, done: z.boolean() })
  .strict();
export const completionHistorySchema = z
  .array(completionEventSchema)
  .max(100000)
  .default(() => []);
export const subtaskSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(500),
    done: z.boolean(),
    completedAt: instant.nullable().default(null),
    deletedAt: instant.nullable().default(null),
    history: completionHistorySchema,
  })
  .strict();
export const datesSchema = z
  .record(z.union([dateSchema, z.literal('∞')]), idSchema.nullable())
  .refine((dates) => !('∞' in dates) || dates['∞'] === null, '∞ 不能设置时段');
export const taskSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(50000),
    estimatedMinutes: z.number().finite().nonnegative().nullable().optional(),
    actualMinutes: z.number().finite().nonnegative().nullable().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
    listId: idSchema,
    dates: datesSchema,
    tags: z.array(z.string().trim().min(1).max(40)).max(30),
    subtasks: z.array(subtaskSchema).max(200),
    pinned: z.boolean(),
    order: z.number().finite(),
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant.nullable(),
    deletedAt: instant.nullable(),
    history: completionHistorySchema,
  })
  .strict();
export const taskTemplateSchema = taskSchema.pick({
  title: true,
  notes: true,
  estimatedMinutes: true,
  difficulty: true,
  listId: true,
  tags: true,
  subtasks: true,
  pinned: true,
  order: true,
});
export const repeatRuleSchema = z
  .object({
    prefix: idSchema,
    cron: z
      .string()
      .trim()
      .min(9)
      .max(120)
      .refine((value) => {
        try {
          validateCron(value);
          return true;
        } catch {
          return false;
        }
      }, 'Cron 无效，请使用五字段表达式'),
    dateOffsets: z.array(z.number().int().min(0).max(365)).min(1).max(366),
    template: taskTemplateSchema,
    startAt: instant,
    generatedThrough: instant.nullable(),
    occurrences: z.record(z.string().max(40), idSchema),
    enabled: z.boolean(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
/** A section of one day's plan, such as "午饭前"; each task date maps to its own section. */
export const planGroupSchema = z
  .object({
    id: idSchema,
    date: dateSchema,
    title: z.string().trim().min(1).max(60),
    minutes: z.number().int().min(1).max(1440).nullable(),
    until: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    note: z.string().max(2000),
    order: z.number().finite(),
    createdAt: instant,
    updatedAt: instant,
    deletedAt: instant.nullable(),
  })
  .strict();
export const focusSessionSchema = z
  .object({
    id: idSchema,
    taskId: idSchema.nullable(),
    title: z.string().max(500),
    minutes: z.number().int().min(1).max(180),
    completedAt: instant,
  })
  .strict();
export const timerSchema = z
  .object({
    id: idSchema,
    taskId: idSchema.nullable(),
    title: z.string().max(500),
    kind: z.enum(['focus', 'break']),
    duration: z.number().int().min(60).max(10800),
    remaining: z.number().int().min(0).max(10800),
    endAt: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export const stateFields = z
  .object({
    version: z.literal(2),
    timelog: z
      .unknown()
      .default(initialState)
      .transform((v) => validateState(v)),
    schedule: scheduleSchema.default(emptySchedule),
    lists: z.array(listSchema).min(1).max(200),
    tagColors: z
      .object({
        tasks: z.record(z.string().min(1).max(40), colorSchema),
        records: z.record(z.string().min(1).max(40), colorSchema),
      })
      .strict()
      .default(() => ({ tasks: {}, records: {} })),
    tasks: z.array(taskSchema).max(50000),
    repeatRules: z
      .array(repeatRuleSchema)
      .max(5000)
      .default(() => []),
    planGroups: z
      .array(planGroupSchema)
      .max(20000)
      .default(() => []),
    sessions: z.array(focusSessionSchema).max(100000),
    timer: timerSchema.nullable(),
    settings: z
      .object({
        theme: z.enum(['light', 'dark', 'system']),
        timeZone: zoneSchema.default('Asia/Shanghai'),
        /** Absent means midnight; omitted rather than defaulted so older peers keep syncing. */
        dayStartsAt: z
          .string()
          .regex(DAY_START_PATTERN)
          .refine((value) => value <= '06:00', '一天的开始时间须在 00:00 到 06:00 之间')
          .optional(),
        focusMinutes: z.number().int().min(1).max(180),
        breakMinutes: z.number().int().min(1).max(60),
        showCompleted: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const unique = (values: string[], path: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', path: [path], message: '存在重复 ID' });
    };
    unique(
      state.lists.map((x) => x.id),
      'lists',
    );
    unique(
      state.tasks.map((x) => x.id),
      'tasks',
    );
    unique(
      state.repeatRules.map((row) => row.prefix),
      'repeatRules',
    );
    unique(
      state.sessions.map((x) => x.id),
      'sessions',
    );
    unique(
      state.planGroups.map((x) => x.id),
      'planGroups',
    );
    const lists = new Set(state.lists.map((x) => x.id));
    if (!lists.has('inbox'))
      ctx.addIssue({ code: 'custom', path: ['lists'], message: '缺少默认分组' });
    for (const task of state.tasks) {
      if (!lists.has(task.listId))
        ctx.addIssue({ code: 'custom', path: ['tasks'], message: '任务引用了不存在的清单' });
      unique(
        task.subtasks.map((x) => x.id),
        'tasks',
      );
    }
  });

/** Invalid/deleted cross-day slots lose only the reference, never the date. */
export const stateSchema = z.preprocess(migrateTaskState, stateFields).transform((state) => {
  const groups = new Map(
    state.planGroups.filter((row) => !row.deletedAt).map((row) => [row.id, row]),
  );
  return {
    ...state,
    tasks: state.tasks.map((task) =>
      normalizeTask({
        ...task,
        dates: Object.fromEntries(
          Object.entries(task.dates).map(([day, group]) => [
            day,
            group && groups.get(group)?.date === day ? group : null,
          ]),
        ),
      }),
    ),
  };
});
export type RepeatRule = z.infer<typeof repeatRuleSchema>;
export type AppState = z.infer<typeof stateSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskList = z.infer<typeof listSchema>;
export type PlanGroup = z.infer<typeof planGroupSchema>;
export type Timer = z.infer<typeof timerSchema>;
export type View =
  | 'timetable'
  | 'timelog'
  | 'today'
  | 'upcoming'
  | 'all'
  | 'inbox'
  | 'calendar'
  | 'focus'
  | 'stats'
  | 'completed'
  | 'trash'
  | `list:${string}`
  | `tag:${string}`;
export const difficultyLabels = { easy: '简单', medium: '中等', hard: '困难' } as const;
export type TaskDifficulty = keyof typeof difficultyLabels;
const difficultyRank = { easy: 0, medium: 1, hard: 2 } as const;
export const colors = ['#326559', '#5274a3', '#ad6a48', '#9671a5', '#b18a32', '#bb6475'];
export const uid = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();

/** The business day: before `settings.dayStartsAt` it is still the previous date. */
export function dateKey(date = new Date()): string {
  return businessDateKey(date.getTime());
}
export function civilDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function shiftDate(key: string, days: number): string {
  return shiftCalendarDay(key, days);
}
export function formatDate(key: string | null): string {
  if (!key) return '无日期';
  const today = dateKey();
  if (key === today) return '今天';
  if (key === shiftDate(today, 1)) return '明天';
  if (key === shiftDate(today, -1)) return '昨天';
  return fromDateKey(key).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}
export function emptyState(): AppState {
  return {
    version: 2,
    timelog: initialState(),
    schedule: emptySchedule(),
    lists: [{ id: 'inbox', name: '未分组', color: '#7e8b8b', order: 0 }],
    tagColors: { tasks: {}, records: {} },
    tasks: [],
    repeatRules: [],
    planGroups: [],
    sessions: [],
    timer: null,
    settings: {
      timeZone: 'Asia/Shanghai',
      theme: 'system',
      focusMinutes: 25,
      breakMinutes: 5,
      showCompleted: false,
    },
  };
}
/** Default list mapping is shared by UI and AI; activity identity is always persisted. */
export const defaultTaskActivity = (name: string) =>
  (({ 学习: '学习', 工作: '实操', 生活: '日常' }) as Record<string, string>)[name];
export function reorderTasks(
  state: AppState,
  visibleIds: string[],
  source: string,
  target: string,
  planDate?: string,
): AppState {
  const ids = [...new Set(visibleIds)].filter((id) =>
    state.tasks.some((task) => task.id === id && !task.deletedAt && !taskCompleted(task)),
  );
  const order = moveOrder(
    [...state.tasks].sort((a, b) => a.order - b.order).map((task) => task.id),
    ids,
    source,
    target,
  );
  if (!order) return state;
  // A drop across the pinned boundary moves into the target group. Keeping the
  // old flag would make selectTasks immediately put the source back again.
  const targetTask = state.tasks.find((task) => task.id === target)!;
  const targetPinned = targetTask.pinned;
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      const pinned = task.id === source ? targetPinned : task.pinned;
      const dates =
        planDate && task.id === source
          ? { ...task.dates, [planDate]: targetTask.dates[planDate] ?? null }
          : task.dates;
      if (task.order === order.get(task.id) && task.pinned === pinned && dates === task.dates)
        return task;
      return { ...task, dates, order: order.get(task.id)!, pinned, updatedAt: now() };
    }),
  };
}
/** Live sections of one day's plan in display order. */
export function dayPlanGroups(state: Pick<AppState, 'planGroups'>, date: string): PlanGroup[] {
  return state.planGroups
    .filter((group) => !group.deletedAt && group.date === date)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}
/** A slot belongs to exactly the requested business date. */
export function taskPlanGroup(
  state: Pick<AppState, 'planGroups'>,
  task: Task,
  date: string,
): PlanGroup | null {
  const id = task.dates[date];
  return (
    state.planGroups.find((row) => row.id === id && !row.deletedAt && row.date === date) ?? null
  );
}
export function newPlanGroup(
  date: string,
  input: Partial<Pick<PlanGroup, 'title' | 'minutes' | 'until' | 'note' | 'order'>>,
): PlanGroup {
  const at = now();
  return planGroupSchema.parse({
    id: uid(),
    date,
    title: input.title ?? '',
    minutes: input.minutes ?? null,
    until: input.until ?? null,
    note: input.note ?? '',
    order: input.order ?? Date.now(),
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  });
}
/** Removing a section keeps its tasks on the same day, outside any section. */
export function deletePlanGroup(state: AppState, id: string): AppState {
  const group = state.planGroups.find((row) => row.id === id && !row.deletedAt);
  if (!group) return state;
  const at = now();
  return {
    ...state,
    planGroups: state.planGroups.map((row) =>
      row.id === id ? { ...row, deletedAt: at, updatedAt: at } : row,
    ),
    tasks: state.tasks.map((task) =>
      Object.values(task.dates).includes(id)
        ? {
            ...task,
            dates: Object.fromEntries(
              Object.entries(task.dates).map(([day, group]) => [day, group === id ? null : group]),
            ),
            updatedAt: at,
          }
        : task,
    ),
  };
}
export function startTaskTimer(
  state: AppState,
  taskId: string,
  at = Date.now(),
  activityId?: string,
): AppState {
  const task = state.tasks.find(
    (task) => task.id === taskId && !task.deletedAt && !taskCompleted(task),
  );
  if (!task) throw new Error('未找到进行中的任务。');
  const list = state.lists.find((list) => list.id === task.listId);
  const mapped = activityId ?? list?.activityId;
  const expected = defaultTaskActivity(list?.name ?? '');
  let timelog = state.timelog;
  let activity = mapped
    ? timelog.activities.find((activity) => activity.id === mapped && activeActivity(activity))
    : timelog.activities.find(
        (activity) => activeActivity(activity) && activity.name === (expected ?? '学习'),
      );
  if (mapped && !activity) throw new Error('清单绑定的活动已删除，请在清单设置中重新选择。');
  if (!activity && expected) {
    activity = {
      id: newId(),
      name: expected,
      color: list?.color ?? '#76b9ed',
      nature: expected === '日常' ? 'neutral' : 'positive',
      archived: false,
      updatedAt: at,
    };
    timelog = { ...timelog, activities: [...timelog.activities, activity] };
  }
  activity ??= timelog.activities.find(activeActivity);
  if (!activity) throw new Error('请先添加一个计时活动。');
  return {
    ...state,
    timelog: startTimer(timelog, activity.id, task.title, at, { taskId: task.id, tags: task.tags }),
  };
}
export function newTask(title: string, partial: Partial<z.input<typeof taskSchema>> = {}): Task {
  return taskSchema.parse({
    id: `${uid()}-0`,
    title: title.trim(),
    notes: '',
    listId: 'inbox',
    dates: {},
    difficulty: 'easy',
    tags: [],
    subtasks: [],
    pinned: false,
    order: Date.now(),
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    deletedAt: null,
    ...partial,
  });
}
/** A copy has a fresh series identity and no completion or repetition metadata. */
export function copyTask(task: Task): Task {
  return newTask(task.title, {
    notes: task.notes,
    dates: { ...task.dates },
    listId: task.listId,
    tags: [...task.tags],
    difficulty: task.difficulty,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: null,
    pinned: task.pinned,
    subtasks: task.subtasks
      .filter((row) => !row.deletedAt)
      .map((row) => ({ id: uid(), title: row.title, done: false })),
  });
}

/** Saved task-linked records are a reference value, never a replacement for an explicit actual time. */
export function recordedTaskMinutes(state: Pick<AppState, 'timelog'>, taskId: string): number {
  return state.timelog.records.reduce(
    (minutes, record) =>
      record.taskId === taskId && !record.deletedAt
        ? minutes + duration(record.spans) / 60000
        : minutes,
    0,
  );
}

export const formatTaskMinutes = (minutes: number) => `${Number(minutes.toFixed(1))} 分钟`;
export function toggleTask(state: AppState, id: string): AppState {
  const task = state.tasks.find((row) => row.id === id && !row.deletedAt);
  if (!task) return state;
  return {
    ...state,
    tasks: state.tasks.map((row) => (row.id === id ? setTaskDone(row, !taskCompleted(row)) : row)),
  };
}
/** New task drafts and edits use the same transition logic as API writes. */
export function normalizeTaskChanges(next: AppState, previous: AppState): AppState {
  const old = new Map(previous.tasks.map((row) => [row.id, row]));
  return {
    ...next,
    tasks: next.tasks.map((row) => normalizeTask(row, old.get(row.id), now(), true)),
  };
}
export function selectTasks(
  state: AppState,
  view: View,
  query = '',
  sort: 'manual' | 'date' | 'difficulty' = 'manual',
  today = dateKey(),
): Task[] {
  const search = query.trim().toLocaleLowerCase();
  return state.tasks
    .filter((t) => {
      if (
        search &&
        !`${t.title} ${t.notes} ${t.tags.map((x) => `#${x}`).join(' ')} ${t.subtasks.map((x) => x.title).join(' ')}`
          .toLocaleLowerCase()
          .includes(search)
      )
        return false;
      if (view === 'trash') return !!t.deletedAt;
      if (t.deletedAt) return false;
      if (view === 'completed') return taskCompleted(t);
      if (search) return true;
      if (taskCompleted(t) && view !== 'today' && view !== 'upcoming') return false;
      if (view === 'today') return Object.hasOwn(t.dates, today);
      if (view === 'upcoming') {
        const monday = shiftDate(today, 1 - weekday(today));
        return finiteTaskDates(t).some((date) => date >= monday && date <= shiftDate(monday, 6));
      }
      if (view === 'inbox') return Object.keys(t.dates).length === 0;
      if (view.startsWith('list:')) return t.listId === view.slice(5);
      if (view.startsWith('tag:')) return t.tags.includes(view.slice(4));
      return activeTask(t, today);
    })
    .sort((a, b) => {
      if (view === 'completed') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
      if (view === 'trash') return (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');
      const complete = Number(taskCompleted(a)) - Number(taskCompleted(b));
      if (complete) return complete;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'date' || view === 'upcoming')
        return (
          (finiteTaskDates(a)[0] ?? '9999').localeCompare(finiteTaskDates(b)[0] ?? '9999') ||
          a.order - b.order
        );
      if (sort === 'difficulty')
        return difficultyRank[b.difficulty] - difficultyRank[a.difficulty] || a.order - b.order;
      return a.order - b.order;
    });
}

/**
 * A full-state import (the AI's read-modify-write, or a Dayweave backup) merges history only.
 * Running timers stay those of this state: the incoming copy is a snapshot of them, and a
 * concurrent start or stop is already caught by the caller's revision check.
 */
function mergeAroundTimers(local: AppState['timelog'], incoming: AppState['timelog']) {
  const idle = (state: AppState['timelog']) => ({ ...state, timer: null, conflictedTimers: [] });
  return {
    ...mergeBackup(idle(local), idle(incoming)),
    timer: local.timer,
    ...(local.conflictedTimers?.length ? { conflictedTimers: local.conflictedTimers } : {}),
  };
}
export function mergeImport(local: AppState, incoming: unknown): AppState {
  if (
    incoming &&
    typeof incoming === 'object' &&
    'format' in incoming &&
    incoming.format === 'open-timelog'
  ) {
    const backup = parseBackup(JSON.stringify(incoming));
    return { ...local, timelog: mergeBackup(local.timelog, backup.data) };
  }
  const imported = stateSchema.parse(incoming);
  const lists = new Map(local.lists.map((x) => [x.id, x]));
  for (const list of imported.lists) if (!lists.has(list.id)) lists.set(list.id, list);
  const tasks = new Map(local.tasks.map((x) => [x.id, x]));
  for (const task of imported.tasks) {
    const current = tasks.get(task.id);
    tasks.set(
      task.id,
      !current
        ? task
        : (mergeTaskEntity(
            undefined,
            current.updatedAt < task.updatedAt ? task : current,
            current.updatedAt < task.updatedAt ? current : task,
          ) as Task),
    );
  }
  const planGroups = new Map(local.planGroups.map((x) => [x.id, x]));
  for (const group of imported.planGroups)
    if (!planGroups.has(group.id) || planGroups.get(group.id)!.updatedAt < group.updatedAt)
      planGroups.set(group.id, group);
  const sessions = new Map(local.sessions.map((x) => [x.id, x]));
  for (const session of imported.sessions)
    if (!sessions.has(session.id)) sessions.set(session.id, session);
  const repeatRules = new Map(local.repeatRules.map((rule) => [rule.prefix, rule]));
  for (const rule of imported.repeatRules) {
    const current = repeatRules.get(rule.prefix);
    if (!current) {
      repeatRules.set(rule.prefix, rule);
      continue;
    }
    const preferred = current.updatedAt < rule.updatedAt ? rule : current;
    const other = preferred === rule ? current : rule;
    const sameSchedule =
      preferred.cron === other.cron &&
      preferred.startAt === other.startAt &&
      JSON.stringify(preferred.dateOffsets) === JSON.stringify(other.dateOffsets);
    repeatRules.set(rule.prefix, {
      ...preferred,
      occurrences: { ...other.occurrences, ...preferred.occurrences },
      generatedThrough: sameSchedule
        ? ([preferred.generatedThrough, other.generatedThrough]
            .filter((value) => value !== null)
            .sort()
            .at(-1) ?? null)
        : preferred.generatedThrough,
    });
  }
  return stateSchema.parse({
    ...local,
    timelog:
      incoming && typeof incoming === 'object' && 'timelog' in incoming
        ? mergeAroundTimers(local.timelog, imported.timelog)
        : local.timelog,
    schedule:
      incoming && typeof incoming === 'object' && 'schedule' in incoming
        ? mergeSchedule(local.schedule, imported.schedule)
        : local.schedule,
    lists: [...lists.values()],
    tagColors: {
      tasks: { ...imported.tagColors.tasks, ...local.tagColors.tasks },
      records: { ...imported.tagColors.records, ...local.tagColors.records },
    },
    tasks: [...tasks.values()],
    planGroups: [...planGroups.values()],
    sessions: [...sessions.values()],
    repeatRules: [...repeatRules.values()],
  });
}
export function statistics(state: AppState, today = dateKey()) {
  const live = state.tasks.filter((t) => !t.deletedAt);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6));
  const completionDay = (value: string) => dateKey(new Date(value));
  return days.map((day) => ({
    day,
    completed: live.filter((t) => taskCompletedOnDay(t, day)).length,
    minutes: state.sessions
      .filter((s) => completionDay(s.completedAt) === day)
      .reduce((sum, s) => sum + s.minutes, 0),
  }));
}
