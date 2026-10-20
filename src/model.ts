import { z } from 'zod';
import { initialState, validateState, mergeBackup, parseBackup } from './timelog/domain.js';
import { scheduleSchema, emptySchedule, mergeSchedule, zoneSchema } from './schedule.js';
import { zoneDateKey, shiftDay as shiftCalendarDay } from './timezone.js';

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
    order: z.number().finite(),
  })
  .strict();
export const taskSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(50000),
    listId: idSchema,
    due: dateSchema.nullable(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    tags: z.array(z.string().trim().min(1).max(40)).max(30),
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
export const stateSchema = z
  .object({
    version: z.literal(1),
    timelog: z
      .unknown()
      .default(initialState)
      .transform((v) => validateState(v)),
    schedule: scheduleSchema.default(emptySchedule),
    lists: z.array(listSchema).min(1).max(200),
    tasks: z.array(taskSchema).max(50000),
    sessions: z.array(focusSessionSchema).max(100000),
    timer: timerSchema.nullable(),
    settings: z
      .object({
        theme: z.enum(['light', 'dark', 'system']),
        timeZone: zoneSchema.default('Asia/Shanghai'),
        focusMinutes: z.number().int().min(1).max(180),
        breakMinutes: z.number().int().min(1).max(60),
        showCompleted: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (state.timer && (state.timelog.timer || state.timelog.conflictedTimers?.length))
      ctx.addIssue({
        code: 'custom',
        path: ['timer'],
        message: '请先结束当前计时再开始另一个计时',
      });
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
    const lists = new Set(state.lists.map((x) => x.id));
    if (!lists.has('inbox'))
      ctx.addIssue({ code: 'custom', path: ['lists'], message: '缺少收集箱' });
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
export const priorityLabels = { 1: '高优先级', 2: '中优先级', 3: '低优先级', 4: '无优先级' };
export const colors = ['#326559', '#5274a3', '#ad6a48', '#9671a5', '#b18a32', '#bb6475'];
export const uid = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();

export function dateKey(date = new Date()): string {
  return zoneDateKey(date.getTime());
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
    lists: [{ id: 'inbox', name: '收集箱', color: '#7e8b8b', order: 0 }],
    tasks: [],
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
export function newTask(title: string, partial: Partial<Task> = {}): Task {
  return taskSchema.parse({
    id: uid(),
    title: title.trim(),
    notes: '',
    listId: 'inbox',
    due: null,
    priority: 4,
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
      listId: task.listId,
      due: nextRepeatDate(task),
      priority: task.priority,
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
export function quadrant(task: Task, today = dateKey()): number {
  return (task.priority <= 2 ? 0 : 2) + (isUrgent(task, today) ? 0 : 1);
}
export function selectTasks(
  state: AppState,
  view: View,
  query = '',
  sort: 'manual' | 'date' | 'priority' = 'manual',
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
      if (t.completedAt && !state.settings.showCompleted) return false;
      if (search) return true;
      if (view === 'today') return !!t.due && t.due <= today;
      if (view === 'upcoming') return !!t.due && t.due >= today && t.due <= shiftDate(today, 6);
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
      if (sort === 'priority') return a.priority - b.priority || a.order - b.order;
      return a.order - b.order;
    });
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
  const sessions = new Map(local.sessions.map((x) => [x.id, x]));
  for (const session of imported.sessions)
    if (!sessions.has(session.id)) sessions.set(session.id, session);
  return stateSchema.parse({
    ...local,
    timelog:
      incoming && typeof incoming === 'object' && 'timelog' in incoming
        ? mergeBackup(local.timelog, imported.timelog)
        : local.timelog,
    schedule:
      incoming && typeof incoming === 'object' && 'schedule' in incoming
        ? mergeSchedule(local.schedule, imported.schedule)
        : local.schedule,
    lists: [...lists.values()],
    tasks: [...tasks.values()],
    sessions: [...sessions.values()],
  });
}
export function remainingSeconds(timer: Timer, clock = Date.now()): number {
  return timer.endAt === null
    ? timer.remaining
    : Math.max(0, Math.ceil((timer.endAt - clock) / 1000));
}
export function finishTimer(state: AppState, clock = Date.now()): AppState {
  const timer = state.timer;
  if (!timer || timer.endAt === null || remainingSeconds(timer, clock) > 0) return state;
  const session = {
    id: timer.id,
    taskId: timer.taskId,
    title: timer.title,
    minutes: Math.round(timer.duration / 60),
    completedAt: new Date(timer.endAt).toISOString(),
  };
  return {
    ...state,
    timer: null,
    sessions:
      timer.kind === 'focus' && !state.sessions.some((s) => s.id === timer.id)
        ? [...state.sessions, session]
        : state.sessions,
  };
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
