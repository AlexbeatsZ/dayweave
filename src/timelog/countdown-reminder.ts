import type { State } from './domain.js';

export type CountdownReminder = { id: string; at: number; activity: string };

export function countdownReminder(state: State): CountdownReminder | null {
  const timer = state.timer;
  if (timer?.runningSince == null || timer.plannedEndAt == null) return null;
  return {
    id: timer.id,
    at: timer.plannedEndAt,
    activity: state.activities.find((activity) => activity.id === timer.activityId)?.name ?? '活动',
  };
}

/** Match the deadline of the last saved timer, including completion received by sync. */
export function countdownCompleted(
  reminder: CountdownReminder | null,
  state: State,
  now = Date.now(),
): reminder is CountdownReminder {
  return (
    reminder !== null &&
    now >= reminder.at &&
    state.timer?.id !== reminder.id &&
    state.records.some(
      (record) =>
        record.id === reminder.id && !record.deletedAt && record.spans.at(-1)?.end === reminder.at,
    )
  );
}
