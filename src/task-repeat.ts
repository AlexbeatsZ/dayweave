import { CronExpressionParser } from 'cron-parser';
import { newTask, type AppState, type RepeatRule, type Task, taskTemplateSchema } from './model.js';
import { taskPrefix, finiteTaskDates } from './task-domain.js';
import { businessDateKey, businessDayStart, shiftDay, zoneClock, zoneDateKey } from './timezone.js';
import { cronZone, validateCron } from './task-cron.js';
import { generateRecurrences } from './event-domain.js';
import { nextInstanceId, cronToRecurrence, recurrenceDates } from './recurrence.js';
import { wallTime } from './timezone.js';
export { validateCron } from './task-cron.js';
const triggerKey = (at: number, zone: string) => `${zoneDateKey(at, zone)}T${zoneClock(at, zone)}`;

export function configureRepeat(
  state: AppState,
  task: Task,
  cron: string | null,
  offsets = [0],
): AppState {
  const prefix = taskPrefix(task.id),
    at = new Date().toISOString();
  const previous = state.repeatRules.find((row) => row.prefix === prefix);
  if (!cron)
    return previous?.enabled
      ? {
          ...state,
          repeatRules: state.repeatRules.map((row) =>
            row.prefix === prefix ? { ...row, enabled: false, updatedAt: at } : row,
          ),
        }
      : state;
  validateCron(cron);
  const dateOffsets = [...new Set(offsets)].sort((a, b) => a - b);
  if (
    previous?.enabled &&
    previous.cron === cron &&
    JSON.stringify(previous.dateOffsets) === JSON.stringify(dateOffsets)
  )
    return state;
  const day = finiteTaskDates(task)[0] ?? businessDateKey();
  const start = previous
    ? Date.now()
    : businessDayStart(day, state.settings.timeZone, state.settings.dayStartsAt);
  const rule: RepeatRule = {
    prefix,
    cron,
    dateOffsets,
    template:
      previous?.template ??
      taskTemplateSchema.parse(
        Object.fromEntries(
          Object.keys(taskTemplateSchema.shape).map((key) => [
            key,
            key === 'subtasks'
              ? task.subtasks
                  .filter((row) => !row.deletedAt)
                  .map((row) => ({ ...row, done: false, completedAt: null, history: [] }))
              : task[key as keyof Task],
          ]),
        ),
      ),
    enabled: true,
    startAt: new Date(start).toISOString(),
    generatedThrough: null,
    occurrences: { ...previous?.occurrences },
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
  };
  // The task configured by the user is already this first occurrence, if its day matches.
  if (!previous) {
    const iterator = CronExpressionParser.parse(cron, {
      currentDate: new Date(start - 1),
      tz: cronZone(state.settings.timeZone),
    });
    const first = iterator.next().getTime();
    if (businessDateKey(first, state.settings.timeZone, state.settings.dayStartsAt) === day)
      rule.occurrences[triggerKey(first, state.settings.timeZone)] = task.id;
  }
  return {
    ...state,
    repeatRules: [...state.repeatRules.filter((row) => row.prefix !== prefix), rule],
    recurrences: state.recurrences.map((row) =>
      row.prefix === prefix ? { ...row, enabled: false, updatedAt: at } : row,
    ),
  };
}

/** Called only by the elected hub, inside its existing StateService transaction. */
export function generateRepeatedTasks(
  state: AppState,
  through?: string,
  at = Date.now(),
): AppState {
  const zone = state.settings.timeZone,
    start = state.settings.dayStartsAt;
  const today = businessDateKey(at, zone, start);
  const target = through ?? shiftDay(today, 14);
  if (target > shiftDay(today, 366)) throw new Error('最多提前生成一年内的重复任务');
  const end = businessDayStart(shiftDay(target, 1), zone, start) - 1;
  const tasks = [...state.tasks];
  let generated = 0;
  const rules = state.repeatRules.map((rule) => {
    if (!rule.enabled || (rule.generatedThrough && Date.parse(rule.generatedThrough) >= end))
      return rule;
    validateCron(rule.cron);
    const from = Math.max(
      Date.parse(rule.startAt) - 1,
      rule.generatedThrough
        ? Date.parse(rule.generatedThrough)
        : businessDayStart(today, zone, start) - 1,
    );
    if (from >= end || generated >= 256) return rule;
    const recurrence = cronToRecurrence(
      rule.cron,
      zoneDateKey(Date.parse(rule.startAt), zone),
      zone,
      start,
    );
    const rruleDates = recurrence
      ? recurrenceDates(recurrence, shiftDay(target, 1))
          .map((value) => wallTime(value.slice(0, 10), value.slice(11), zone))
          .filter((instant) => instant > from)
      : [];
    let index = 0;
    const iterator = recurrence
      ? { next: () => ({ getTime: () => rruleDates[index++] ?? Infinity }) }
      : CronExpressionParser.parse(rule.cron, {
          currentDate: new Date(from),
          tz: cronZone(zone),
        });
    const occurrences = { ...rule.occurrences };
    let cursor = from;
    while (generated < 256) {
      const instant = iterator.next().getTime();
      if (instant > end) {
        cursor = end;
        break;
      }
      cursor = instant;
      const trigger = triggerKey(instant, zone);
      if (occurrences[trigger]) continue;
      const day = businessDateKey(instant, zone, start);
      const id = nextInstanceId(rule.prefix, [
        ...tasks.map((task) => task.id),
        ...state.calendarEvents.map((event) => event.id),
        ...Object.values(occurrences),
        ...state.recurrences.flatMap((row) => Object.values(row.occurrences)),
      ]);
      const task = newTask(rule.template.title, {
        ...rule.template,
        id,
        dates: Object.fromEntries(rule.dateOffsets.map((offset) => [shiftDay(day, offset), null])),
        subtasks: rule.template.subtasks
          .filter((row) => !row.deletedAt)
          .map((row) => ({
            ...row,
            id: crypto.randomUUID(),
            done: false,
            completedAt: null,
            deletedAt: null,
            history: [],
          })),
      });
      tasks.push(task);
      occurrences[trigger] = id;
      generated++;
    }
    return {
      ...rule,
      ...(recurrence
        ? { recurrence, migrationWarning: undefined }
        : {
            recurrence: undefined,
            migrationWarning: '此 Cron 暂无已验证的等价 RRULE，继续保留原规则并由兼容引擎执行',
          }),
      occurrences,
      generatedThrough: new Date(cursor).toISOString(),
      updatedAt: new Date(at).toISOString(),
    };
  });
  return generateRecurrences({ ...state, tasks, repeatRules: rules }, through, at);
}
