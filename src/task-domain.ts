import type { Task } from './model.js';
import { businessDateKey } from './timezone.js';

export const taskPrefix = (id: string) => id.replace(/-\d+$/, '');
export const taskSequence = (id: string) => Number(id.match(/-(\d+)$/)?.[1] ?? 0);
export const finiteTaskDates = (task: Pick<Task, 'dates'>) =>
  Object.keys(task.dates)
    .filter((key) => key !== '∞')
    .sort();
export const activeTask = (task: Task, today: string) =>
  !task.deletedAt &&
  !taskCompleted(task) &&
  ('∞' in task.dates || finiteTaskDates(task).some((date) => date >= today));

/** A task repeats precisely when its ID has a higher-numbered sibling. */
export function repeatingTaskIds(tasks: readonly Task[]) {
  const last = new Map<string, number>();
  for (const task of tasks) {
    const prefix = taskPrefix(task.id);
    last.set(prefix, Math.max(last.get(prefix) ?? 0, taskSequence(task.id)));
  }
  return new Set(
    tasks
      .filter((task) => taskSequence(task.id) < last.get(taskPrefix(task.id))!)
      .map((task) => task.id),
  );
}

/** Keep one actual, eligible instance per series, then retain the caller's display order. */
export function taskOverview(
  tasks: readonly Task[],
  today: string,
  repeating: ReadonlySet<string>,
) {
  const first = new Map<string, Task>();
  for (const task of tasks) {
    if (!activeTask(task, today)) continue;
    const prefix = taskPrefix(task.id);
    if (repeating.has(task.id) && !finiteTaskDates(task).some((date) => date >= today)) continue;
    const previous = first.get(prefix);
    if (!previous || taskSequence(task.id) < taskSequence(previous.id)) first.set(prefix, task);
  }
  return tasks.filter((task) => first.get(taskPrefix(task.id)) === task);
}
export const liveSubtasks = (task: Task) => task.subtasks.filter((row) => !row.deletedAt);
export const taskCompleted = (task: Pick<Task, 'completedAt' | 'subtasks'>) =>
  !!task.completedAt ||
  (task.subtasks.some((row) => !row.deletedAt) &&
    task.subtasks.filter((row) => !row.deletedAt).every((row) => row.done));
export function taskDoneOn(task: Pick<Task, 'completedAt' | 'history'>, day: string) {
  const events = task.history.filter((event) => businessDateKey(Date.parse(event.at)) <= day);
  return (
    events.at(-1)?.done ??
    (!!task.completedAt && businessDateKey(Date.parse(task.completedAt)) <= day)
  );
}
export function taskCompletedOnDay(task: Pick<Task, 'completedAt' | 'history'>, day: string) {
  const events = task.history.filter((event) => businessDateKey(Date.parse(event.at)) === day);
  return (
    events.at(-1)?.done ??
    (!!task.completedAt && businessDateKey(Date.parse(task.completedAt)) === day)
  );
}
export function taskDateLabel(task: Task, format: (day: string) => string) {
  const days = finiteTaskDates(task);
  return (
    (days.length <= 3
      ? days.map(format).join('、')
      : `${format(days[0])} — ${format(days.at(-1)!)} · ${days.length} 天`) +
    ('∞' in task.dates ? ' ∞' : '')
  );
}

/** Apply an actual transition once. Unknown legacy times stay unknown until a new action. */
export function setSubtaskDone(row: Task['subtasks'][number], done: boolean, at: string) {
  if (row.done === done) return row;
  return {
    ...row,
    done,
    completedAt: done ? at : null,
    history: [...row.history, { id: crypto.randomUUID(), at, done }],
  };
}
export function normalizeTask(
  task: Task,
  previous?: Task,
  at = new Date().toISOString(),
  recordNew = false,
): Task {
  const rows = [
    ...task.subtasks,
    ...(previous?.subtasks
      .filter((old) => !task.subtasks.some((row) => row.id === old.id))
      .map((row) => ({ ...row, deletedAt: at })) ?? []),
  ];
  const subtasks = rows.map((input) => {
    let row = input;
    const before = previous?.subtasks.find((old) => old.id === row.id);
    if (before)
      row = {
        ...row,
        history: [
          ...new Map(
            [...before.history, ...row.history].map((event) => [event.id, event]),
          ).values(),
        ],
        completedAt:
          row.done === before.done ? (row.completedAt ?? before.completedAt) : row.completedAt,
      };
    if (before && before.done !== row.done && row.history.length === before.history.length)
      return setSubtaskDone({ ...row, done: before.done }, row.done, at);
    if (!before && row.done && !row.completedAt && !row.history.length && (previous || recordNew))
      return { ...row, completedAt: at, history: [{ id: crypto.randomUUID(), at, done: true }] };
    return row.done ? row : { ...row, completedAt: null };
  });
  const live = subtasks.filter((row) => !row.deletedAt);
  if (!live.length) return { ...task, subtasks };
  const allDone = live.every((row) => row.done);
  // Never invent a timestamp when normalizing imported legacy completion.
  const latest = live
    .map((row) => row.completedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  const completedAt = allDone ? (task.completedAt ?? latest ?? null) : null;
  const changed = previous && taskCompleted(previous) !== allDone;
  const history = task.history ?? [];
  return {
    ...task,
    subtasks,
    completedAt,
    history:
      changed &&
      completedAt !== null &&
      !history.some((event) => event.at === completedAt && event.done === allDone)
        ? [...history, { id: crypto.randomUUID(), at: completedAt, done: allDone }]
        : changed && !allDone && history.length === previous.history.length
          ? [...history, { id: crypto.randomUUID(), at, done: false }]
          : history,
  };
}
export function setTaskDone(task: Task, done: boolean, at = new Date().toISOString()): Task {
  return {
    ...task,
    completedAt: done ? at : null,
    updatedAt: at,
    history: [...task.history, { id: crypto.randomUUID(), at, done }],
    subtasks: task.subtasks.map((row) => (row.deletedAt ? row : setSubtaskDone(row, done, at))),
  };
}
export function changeSubtask(
  task: Task,
  id: string,
  patch: Partial<Task['subtasks'][number]>,
  at = new Date().toISOString(),
) {
  return normalizeTask(
    {
      ...task,
      updatedAt: at,
      subtasks: task.subtasks.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    },
    task,
    at,
  );
}
/** Facts for a date, independently of a subtask's later current state. */
export function subtaskDay(row: Task['subtasks'][number], day: string) {
  const events = row.history.filter((event) => businessDateKey(Date.parse(event.at)) === day);
  return (
    events.at(-1)?.done ??
    (row.completedAt && businessDateKey(Date.parse(row.completedAt)) === day ? true : null)
  );
}
export function taskDaySubtasks(task: Task, day: string, today: string) {
  if (day < today) return task.subtasks.filter((row) => subtaskDay(row, day) !== null);
  return task.subtasks.filter(
    (row) =>
      !row.deletedAt &&
      (!row.done ||
        subtaskDay(row, day) !== null ||
        (day === today && !row.completedAt && !row.history.length)),
  );
}
