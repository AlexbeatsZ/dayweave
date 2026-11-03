import { z } from 'zod';
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
export const taskSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(50000),
    estimatedMinutes: z.number().finite().nonnegative().nullable().optional(),
    actualMinutes: z.number().finite().nonnegative().nullable().optional(),
    listId: idSchema,
    due: dateSchema.nullable(),
    /** Eisenhower quadrant chosen by the user or the AI; never derived from dates. */
    quadrant: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
      .nullable()
      .optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30),
    /** Section of the daily plan; only meaningful while it names a live group of the same day. */
    planGroupId: idSchema.optional(),
    subtasks: z
      .array(
        z
          .object({ id: idSchema, title: z.string().trim().min(1).max(500), done: z.boolean() })
          .strict(),
      )
      .max(200),
    repeat: z.enum(['none', 'daily', 'weekly', 'monthly']),
    repeatDay: z.number().int().min(1).max(31),
    spawnedId: idSchema.nullable(),
    parentId: idSchema.nullable(),
    pinned: z.boolean(),
    order: z.number().finite(),
    createdAt: instant,
    updatedAt: instant,
    completedAt: instant.nullable(),
    deletedAt: instant.nullable(),
  })
  .strict();
/** A section of one day's plan, such as "午饭前"; tasks still belong to the day through `due`. */
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
/** Priority was replaced by estimated minutes and an explicit quadrant; older data drops it. */
function withoutLegacyTaskFields(value: unknown) {
  if (!value || typeof value !== 'object' || !('priority' in value)) return value;
  const { priority: _priority, ...task } = value as Record<string, unknown>;
  return task;
}
export const stateSchema = z
  .object({
    version: z.literal(1),
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
    tasks: z.array(z.preprocess(withoutLegacyTaskFields, taskSchema)).max(50000),
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
  | 'quadrants'
  | 'calendar'
  | 'focus'
  | 'stats'
  | 'completed'
  | 'trash'
  | `list:${string}`
  | `tag:${string}`;
export const quadrantLabels = {
  1: '重要且紧急',
  2: '重要不紧急',
  3: '紧急不重要',
  4: '不重要不紧急',
} as const;
export type Quadrant = keyof typeof quadrantLabels;
/** Task size shown in lists, derived only from the estimate. */
export function effortTier(minutes: number | null | undefined): '小' | '中' | '大' | null {
  if (minutes == null || minutes <= 0) return null;
  return minutes <= 30 ? '小' : minutes <= 120 ? '中' : '大';
}
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
    version: 1,
    timelog: initialState(),
    schedule: emptySchedule(),
    lists: [{ id: 'inbox', name: '未分组', color: '#7e8b8b', order: 0 }],
    tagColors: { tasks: {}, records: {} },
    tasks: [],
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
  adoptPlanGroup = false,
): AppState {
  const ids = visibleIds.filter((id) =>
    state.tasks.some((task) => task.id === id && !task.deletedAt && !task.completedAt),
  );
  const from = ids.indexOf(source),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return state;
  // A drop across the pinned boundary moves into the target group. Keeping the
  // old flag would make selectTasks immediately put the source back again.
  const targetTask = state.tasks.find((task) => task.id === target)!;
  const targetPinned = targetTask.pinned;
  ids.splice(from, 1);
  ids.splice(to, 0, source);
  const selected = new Set(ids),
    rows = [...state.tasks].sort((a, b) => a.order - b.order);
  let position = 0;
  const order = new Map(
    rows.map((task, index) => [selected.has(task.id) ? ids[position++] : task.id, index + 1]),
  );
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      const pinned = task.id === source ? targetPinned : task.pinned;
      // In the daily plan a drop next to a task of another section moves into that section.
      const planGroupId =
        adoptPlanGroup && task.id === source ? targetTask.planGroupId : task.planGroupId;
      if (
        task.order === order.get(task.id) &&
        task.pinned === pinned &&
        task.planGroupId === planGroupId
      )
        return task;
      const { planGroupId: _previous, ...rest } = task;
      return {
        ...rest,
        ...(planGroupId ? { planGroupId } : {}),
        order: order.get(task.id)!,
        pinned,
        updatedAt: now(),
      };
    }),
  };
}
/** Live sections of one day's plan in display order. */
export function dayPlanGroups(state: Pick<AppState, 'planGroups'>, date: string): PlanGroup[] {
  return state.planGroups
    .filter((group) => !group.deletedAt && group.date === date)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}
/** A task is in a section only while that section is live and on the task's own day. */
export function taskPlanGroup(state: Pick<AppState, 'planGroups'>, task: Task): PlanGroup | null {
  if (!task.planGroupId || !task.due) return null;
  return (
    state.planGroups.find(
      (group) => group.id === task.planGroupId && !group.deletedAt && group.date === task.due,
    ) ?? null
  );
}
/** Changing a task's day leaves its old section; every editor and the API use this. */
export function withTaskDay(task: Task, due: string | null, planGroupId?: string | null): Task {
  const { planGroupId: previous, ...rest } = task;
  const group = planGroupId === undefined ? (due === task.due ? previous : undefined) : planGroupId;
  return { ...rest, due, ...(group ? { planGroupId: group } : {}) };
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
      task.planGroupId === id ? { ...withTaskDay(task, task.due, null), updatedAt: at } : task,
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
    (task) => task.id === taskId && !task.deletedAt && !task.completedAt,
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
export function newTask(title: string, partial: Partial<Task> = {}): Task {
  return taskSchema.parse({
    id: uid(),
    title: title.trim(),
    notes: '',
    listId: 'inbox',
    due: null,
    tags: [],
    subtasks: [],
    repeat: 'none',
    repeatDay: Number((partial.due ?? dateKey()).slice(-2)),
    spawnedId: null,
    parentId: null,
    pinned: false,
    order: Date.now(),
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
    deletedAt: null,
    ...partial,
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
export function nextRepeatDate(task: Pick<Task, 'due' | 'repeat' | 'repeatDay'>): string {
  const due = task.due ?? dateKey();
  if (task.repeat === 'daily') return shiftDate(due, 1);
  if (task.repeat === 'weekly') return shiftDate(due, 7);
  const date = fromDateKey(due);
  const target = new Date(date.getFullYear(), date.getMonth() + 1, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(task.repeatDay, last));
  return civilDateKey(target);
}
export function toggleTask(state: AppState, id: string): AppState {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.deletedAt) return state;
  const completedAt = task.completedAt ? null : now();
  let spawned: Task | null = null;
  if (
    completedAt &&
    task.repeat !== 'none' &&
    !task.spawnedId &&
    !state.tasks.some((t) => t.parentId === id)
  ) {
    spawned = newTask(task.title, {
      notes: task.notes,
      ...(task.estimatedMinutes === undefined ? {} : { estimatedMinutes: task.estimatedMinutes }),
      listId: task.listId,
      due: nextRepeatDate(task),
      ...(task.quadrant == null ? {} : { quadrant: task.quadrant }),
      tags: [...task.tags],
      subtasks: task.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
      repeat: task.repeat,
      repeatDay: task.repeatDay,
      pinned: task.pinned,
      parentId: id,
    });
  }
  return {
    ...state,
    tasks: [
      ...state.tasks.map((t) =>
        t.id === id
          ? { ...t, completedAt, updatedAt: now(), spawnedId: spawned?.id ?? t.spawnedId }
          : t,
      ),
      ...(spawned ? [spawned] : []),
    ],
  };
}
export function isUrgent(task: Task, today = dateKey()): boolean {
  return !!task.due && task.due <= today;
}
export function selectTasks(
  state: AppState,
  view: View,
  query = '',
  sort: 'manual' | 'date' | 'effort' = 'manual',
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
      if (view === 'completed') return !!t.completedAt;
      if (t.completedAt && view !== 'today' && view !== 'upcoming') return false;
      if (search) return true;
      if (view === 'today') return !!t.due && t.due <= today && (!t.completedAt || t.due === today);
      if (view === 'upcoming') {
        const monday = shiftDate(today, 1 - weekday(today));
        return !!t.due && t.due >= monday && t.due <= shiftDate(monday, 6);
      }
      if (view === 'inbox') return !t.due;
      if (view.startsWith('list:')) return t.listId === view.slice(5);
      if (view.startsWith('tag:')) return t.tags.includes(view.slice(4));
      return true;
    })
    .sort((a, b) => {
      if (view === 'completed') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
      if (view === 'trash') return (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');
      const complete = Number(!!a.completedAt) - Number(!!b.completedAt);
      if (complete) return complete;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'date' || view === 'upcoming')
        return (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order;
      if (sort === 'effort')
        return (b.estimatedMinutes ?? -1) - (a.estimatedMinutes ?? -1) || a.order - b.order;
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
  for (const task of imported.tasks)
    if (!tasks.has(task.id) || tasks.get(task.id)!.updatedAt < task.updatedAt)
      tasks.set(task.id, task);
  const planGroups = new Map(local.planGroups.map((x) => [x.id, x]));
  for (const group of imported.planGroups)
    if (!planGroups.has(group.id) || planGroups.get(group.id)!.updatedAt < group.updatedAt)
      planGroups.set(group.id, group);
  const sessions = new Map(local.sessions.map((x) => [x.id, x]));
  for (const session of imported.sessions)
    if (!sessions.has(session.id)) sessions.set(session.id, session);
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
  });
}
export function statistics(state: AppState, today = dateKey()) {
  const live = state.tasks.filter((t) => !t.deletedAt);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6));
  const completionDay = (value: string) => dateKey(new Date(value));
  return days.map((day) => ({
    day,
    completed: live.filter((t) => t.completedAt && completionDay(t.completedAt) === day).length,
    minutes: state.sessions
      .filter((s) => completionDay(s.completedAt) === day)
      .reduce((sum, s) => sum + s.minutes, 0),
  }));
}
