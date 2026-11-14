import {
  businessDateKey,
  businessDayStart,
  shiftDay as zoneShiftDay,
  weekday,
  zoneClock,
  dateTimeInput,
} from '../timezone.js';
import { byOrder, moveOrder } from '../order.js';
export type Nature = 'positive' | 'neutral' | 'negative';
export type Span = { start: number; end: number };
export type Activity = {
  deletedAt?: number;
  id: string;
  name: string;
  color: string;
  nature: Nature;
  archived: boolean;
  /** Manual drag order; rows without one follow ordered rows. */
  order?: number;
  updatedAt: number;
};
export type TimeRecord = {
  taskId?: string;
  id: string;
  activityId: string;
  note: string;
  tags: string[];
  spans: Span[];
  nature: Nature;
  deletedAt: number | null;
  updatedAt: number;
};
export type Timer = {
  plannedEndAt?: number | null;
  taskId?: string;
  id: string;
  activityId: string;
  note: string;
  tags: string[];
  runningSince: number | null;
  spans: Span[];
  nature: Nature;
  startedAt: number;
};
export type GoalCheck = { done: boolean; by: 'user' | 'ai'; at: number };
type GoalCommon = {
  id: string;
  name: string;
  /** Optional heading the goals page groups by. */
  group?: string;
  taskId?: string;
  period: 'day' | 'week';
  archived: boolean;
  /** Manual drag order inside the goals page; rows without one follow ordered rows. */
  order?: number;
  updatedAt: number;
};
/**
 * One way a record can count toward a time goal: any of `activities` (empty = any activity),
 * carrying every tag in `tags` and none in `excludeTags`. A goal's rules are alternatives,
 * so "#a or #b" is two rules; a rule with nothing chosen counts every record.
 */
export type RecordRule = { activities: string[]; tags: string[]; excludeTags: string[] };
export const emptyRule = (): RecordRule => ({ activities: [], tags: [], excludeTags: [] });
export function matchesRule(rule: RecordRule, record: Pick<TimeRecord, 'activityId' | 'tags'>) {
  return (
    (!rule.activities.length || rule.activities.includes(record.activityId)) &&
    rule.tags.every((tag) => record.tags.includes(tag)) &&
    !rule.excludeTags.some((tag) => record.tags.includes(tag))
  );
}
export const matchesRules = (
  rules: RecordRule[],
  record: Pick<TimeRecord, 'activityId' | 'tags'>,
) => rules.some((rule) => matchesRule(rule, record));
/** "学习或阅读，带 #英语，不带 #摸鱼"; activity names come from `activities`. */
export function describeRule(rule: RecordRule, activities: Pick<Activity, 'id' | 'name'>[]) {
  const parts = [
    rule.activities.length
      ? rule.activities
          .map((id) => activities.find((item) => item.id === id)?.name ?? '已删除活动')
          .join('或')
      : '任意活动',
    rule.tags.length && `带 ${rule.tags.map((tag) => `#${tag}`).join(' 和 ')}`,
    rule.excludeTags.length && `不带 ${rule.excludeTags.map((tag) => `#${tag}`).join('、')}`,
  ];
  return parts.filter(Boolean).join('，');
}
export const describeRules = (rules: RecordRule[], activities: Pick<Activity, 'id' | 'name'>[]) =>
  rules.map((rule) => describeRule(rule, activities)).join('；或 ');
/** Judged automatically from saved records matching any rule. `kind` is omitted for these. */
export type TimeGoal = GoalCommon & {
  kind?: undefined;
  rules: RecordRule[];
  minutes: number;
  /** A ceiling ("at most") or a floor ("at least"); judged only once the period has ended. */
  comparison: 'atLeast' | 'atMost';
  /**
   * Optional intermediate thresholds in minutes, ascending and excluding `minutes`. Each one
   * reached counts as a level (e.g. 8h, 9h, … below a 16h floor; 3h, 2.5h above a 2h ceiling).
   */
  stages?: number[];
};
/** Met when every task with the tag that is due in the period is completed. */
export type TaskGoal = GoalCommon & { kind: 'tasks'; taskTag: string };
/** Checked by the user or the AI, keyed by period (day or the week's Monday). */
export type ManualGoal = GoalCommon & { kind: 'manual'; checks: Record<string, GoalCheck> };
/** A value a script declares under `params` and each goal fills in. */
export type ScriptParam = string | number | boolean | string[];
/**
 * Judged by a user script from the library (see docs/goal-scripts.md). Results are computed
 * on each device and never stored, so two devices cannot conflict over them.
 */
export type ScriptGoal = GoalCommon & {
  kind: 'script';
  scriptId: string;
  params: Record<string, ScriptParam>;
};
/** A daily prompt the user answers by reflecting on a situation and their response. */
export type BehaviorRule = GoalCommon & {
  kind: 'behaviorRule';
  period: 'day';
  trigger: string;
  action: string;
};
/** Legacy single answer, still derived from the counters so older readers keep a valid row. */
export type BehaviorReviewStatus = 'notTriggered' | 'missed' | 'executed';
export type BehaviorReview = {
  id: string;
  ruleId: string;
  date: string;
  status: BehaviorReviewStatus;
  /** Times the situation occurred today; every executed response also counts as one. */
  triggered: number;
  executed: number;
  updatedAt: number;
};
export type BehaviorCounter = 'trigger' | 'action';
export const MAX_BEHAVIOR_TEXT = 500;
export const MAX_BEHAVIOR_COUNT = 10000;
const derivedBehaviorStatus = (triggered: number, executed: number): BehaviorReviewStatus =>
  triggered === 0 ? 'notTriggered' : executed < triggered ? 'missed' : 'executed';
const legacyBehaviorCounts = { notTriggered: [0, 0], missed: [1, 0], executed: [1, 1] } as const;
const behaviorReviewId = (ruleId: string, date: string) => `${ruleId}@${date}`;
const reviewIndexes = new WeakMap<BehaviorReview[], Map<string, BehaviorReview>>();
export function behaviorReview(state: State, ruleId: string, date: string) {
  const rows = state.behaviorReviews;
  if (!rows) return null;
  let index = reviewIndexes.get(rows);
  if (!index) {
    index = new Map(rows.map((row) => [row.id, row]));
    reviewIndexes.set(rows, index);
  }
  return index.get(behaviorReviewId(ruleId, date)) ?? null;
}
export type Goal = TimeGoal | TaskGoal | ManualGoal | ScriptGoal | BehaviorRule;
/** One JavaScript module in the synced script library. */
export type GoalScript = {
  id: string;
  name: string;
  code: string;
  order?: number;
  updatedAt: number;
};
/** What one script run returned for one period; `progress` (0–1) shades the heatmap. */
export type ScriptOutcome = {
  met: boolean | null;
  progress: number;
  note: string;
  error?: string;
};
/**
 * A script goal's result for one period. Only the sync hub (or an unpaired desktop) computes
 * and writes these; every other device just displays them, so all devices agree.
 */
export type GoalResult = ScriptOutcome & {
  /** `${goalId}@${period}` */
  id: string;
  goalId: string;
  /** Period key: the day, or the week's Monday. */
  period: string;
  /** What the result was computed from (see scriptBasis); a mismatch means it is outdated. */
  basis: string;
  updatedAt: number;
};
/** Periods of results kept per goal: the span of the statistics heatmap. */
export const RESULT_PERIODS = { day: 56, week: 14 } as const;
export const goalResultId = (goalId: string, period: string) => `${goalId}@${period}`;
/** Changes exactly when a script goal's result must be recomputed for every period. */
export function scriptBasis(state: Pick<State, 'scripts'>, goal: ScriptGoal) {
  const script = state.scripts?.find((row) => row.id === goal.scriptId);
  return JSON.stringify([goal.scriptId, script?.updatedAt ?? null, goal.period, goal.params]);
}
/** The distributed result for this period, or undefined while the hub has not (re)computed it. */
export function scriptResult(state: State, goal: ScriptGoal, key: string) {
  const result = state.goalResults?.find(
    (row) => row.id === goalResultId(goal.id, goalPeriodKey(goal, key)),
  );
  return result && result.basis === scriptBasis(state, goal) ? result : undefined;
}
export const MAX_SCRIPT_LENGTH = 200000;
/** The task fields a task-bound goal reads; tasks live outside the timelog module. */
export type GoalTask = {
  dates: Record<string, string | null>;
  history?: { at: string; done: boolean }[];
  tags: string[];
  completedAt: string | null;
  deletedAt: string | null;
};
export type State = {
  activities: Activity[];
  records: TimeRecord[];
  goals: Goal[];
  /** Goal script library; omitted while empty. */
  scripts?: GoalScript[];
  /** Script goal results written by the hub; omitted while empty. */
  goalResults?: GoalResult[];
  /** One independently synced row per rule and business day; absence means unanswered. */
  behaviorReviews?: BehaviorReview[];
  timer: Timer | null;
  conflictedTimers?: Timer[];
  settings: { weekStartsOn: 1; updatedAt: number; timerPresets?: number[] };
};
export type Backup = {
  format: 'open-timelog';
  version: 1;
  exportedAt: string;
  data: State;
};

export const natureLabels: Record<Nature, string> = {
  positive: '积极',
  neutral: '日常',
  negative: '消极',
};
export const colors = [
  '#357a9e',
  '#4d8b73',
  '#a98241',
  '#8e74a4',
  '#bc7267',
  '#598d9c',
  '#8f9851',
  '#bb7f9d',
];
export const newId = () => crypto.randomUUID();
export const timestamp = (previous = 0) => Math.max(Date.now(), previous + 1);
export function initialState(): State {
  const at = Date.now();
  return {
    activities: [],
    records: [],
    goals: [],
    timer: null,
    settings: { weekStartsOn: 1, updatedAt: at, timerPresets: [5, 30, 45, 60] },
  };
}
export const duration = (spans: Span[]) =>
  spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);
export function liveSpans(timer: Timer, now: number): Span[] {
  return timer.runningSince === null
    ? timer.spans
    : [
        ...timer.spans,
        {
          start: timer.runningSince,
          end: Math.max(timer.runningSince, Math.min(now, timer.plannedEndAt ?? Infinity)),
        },
      ];
}
export const activeActivity = (activity: Activity) => !activity.archived && !activity.deletedAt;
// Fingerprints of the retired presets. A matching name on a different ID is user data.
const oldPresets = new Map([
  ['study', ['学习', '#357a9e', 'positive']],
  ['work', ['工作', '#4d8b73', 'positive']],
  ['reading', ['阅读', '#8e74a4', 'positive']],
  ['exercise', ['运动', '#8f9851', 'positive']],
  ['life', ['日常生活', '#a98241', 'neutral']],
  ['scroll', ['无目的刷手机', '#bc7267', 'negative']],
]);

export function retireUnusedActivityPresets(state: State, listActivityIds: string[]): State {
  const unused = state.activities.filter((row) => {
    const preset = oldPresets.get(row.id);
    return (
      preset &&
      activeActivity(row) &&
      row.order === undefined &&
      row.name === preset[0] &&
      row.color.toLowerCase() === preset[1] &&
      row.nature === preset[2]
    );
  });
  if (!unused.length) return state;
  const used = new Set(listActivityIds);
  for (const row of state.records) used.add(row.activityId);
  for (const row of [state.timer, ...(state.conflictedTimers ?? [])])
    if (row) used.add(row.activityId);
  for (const goal of state.goals)
    if (goal.kind === undefined)
      for (const rule of goal.rules) for (const id of rule.activities) used.add(id);
  const retired = new Set(unused.filter((row) => !used.has(row.id)).map((row) => row.id));
  if (!retired.size) return state;
  return {
    ...state,
    // Keep an inactive identity so another device can still sync historical references.
    activities: state.activities.map((row) =>
      retired.has(row.id)
        ? {
            ...row,
            deletedAt: Math.max(1, row.updatedAt),
            updatedAt: Math.min(8.64e15, row.updatedAt + 1),
          }
        : row,
    ),
  };
}

export function startTimer(
  state: State,
  activityId: string,
  note: string,
  now: number,
  options: { plannedEndAt?: number | null; taskId?: string; tags?: string[] } = {},
): State {
  if (state.timer || state.conflictedTimers?.length)
    throw new Error('已有计时，请先保存当前计时。');
  if (
    options.plannedEndAt != null &&
    (!Number.isFinite(options.plannedEndAt) || options.plannedEndAt - now < 1000)
  )
    throw new Error('倒计时至少需要一秒。');
  const activity = state.activities.find((item) => item.id === activityId && activeActivity(item));
  if (!activity) throw new Error('请选择可用的活动。');
  return {
    ...state,
    timer: {
      id: newId(),
      activityId,
      note: note.trim(),
      tags: [],
      runningSince: now,
      spans: [],
      nature: activity.nature,
      startedAt: now,
      ...options,
    },
  };
}
export function toggleTimer(state: State, now: number): State {
  if (!state.timer) return state;
  if (
    state.timer.runningSince !== null &&
    state.timer.plannedEndAt != null &&
    now >= state.timer.plannedEndAt
  )
    return finishTimer(state, state.timer.plannedEndAt);
  const timer = state.timer;
  if (timer.runningSince !== null && now < timer.runningSince)
    throw new Error('系统时间早于计时开始时间，请校准时间后继续。');
  return {
    ...state,
    timer:
      timer.runningSince === null
        ? {
            ...timer,
            runningSince: now,
            ...(timer.plannedEndAt != null
              ? {
                  plannedEndAt:
                    timer.plannedEndAt + now - (timer.spans.at(-1)?.end ?? timer.startedAt),
                }
              : {}),
          }
        : {
            ...timer,
            runningSince: null,
            spans: liveSpans(timer, now).filter((span) => span.end > span.start),
          },
  };
}
export function finishTimer(state: State, now: number): State {
  if (!state.timer) return state;
  if (state.timer.runningSince !== null && now < state.timer.runningSince)
    throw new Error('系统时间早于计时开始时间，请校准时间后保存。');
  const spans = liveSpans(state.timer, now).filter((span) => span.end > span.start);
  if (duration(spans) < 1000) throw new Error('计时不足一秒，请稍后保存。');
  const { id, taskId, activityId, note, tags, nature } = state.timer;
  return {
    ...state,
    timer: null,
    records: [
      ...state.records,
      {
        id,
        ...(taskId ? { taskId } : {}),
        activityId,
        note,
        tags,
        spans,
        nature,
        updatedAt: now,
        deletedAt: null,
      },
    ],
  };
}

export function finishDueTimer(state: State, now = Date.now()): State {
  const timer = state.timer;
  return timer?.runningSince != null && timer.plannedEndAt != null && now >= timer.plannedEndAt
    ? finishTimer(state, timer.plannedEndAt)
    : state;
}
export function countdownRemaining(timer: Timer, now: number): number {
  const at = timer.runningSince === null ? (timer.spans.at(-1)?.end ?? timer.startedAt) : now;
  return Math.max(0, (timer.plannedEndAt ?? at) - at);
}
export function adjustTimerStart(state: State, startAt: number, now = Date.now()): State {
  const timer = state.timer;
  if (!timer) throw new Error('计时已结束。');
  if (!Number.isFinite(startAt) || startAt < 946684800000 || startAt > now)
    throw new Error('开始时间不能晚于现在。');
  if (timer.plannedEndAt != null && startAt > timer.plannedEndAt - 1000)
    throw new Error('开始时间必须早于结束时间。');
  if (timer.spans.length) {
    if (startAt >= timer.spans[0].end)
      throw new Error('新开始时间必须早于首段结束时间，暂停间隔会保留。');
    return {
      ...state,
      timer: {
        ...timer,
        startedAt: startAt,
        spans: timer.spans.map((span, index) => (index === 0 ? { ...span, start: startAt } : span)),
      },
    };
  }
  if (timer.runningSince === null && startAt > timer.startedAt)
    throw new Error('开始时间不能晚于暂停时间。');
  return {
    ...state,
    timer: {
      ...timer,
      startedAt: startAt,
      runningSince: timer.runningSince === null ? null : startAt,
      spans:
        timer.runningSince === null && startAt < timer.startedAt
          ? [{ start: startAt, end: timer.startedAt }]
          : [],
    },
  };
}
export function nextActivity(state: State, activityId: string, at = Date.now()): State {
  if (!state.timer) throw new Error('没有进行中的活动。');
  const ended = finishTimer(state, at);
  return startTimer(ended, activityId, '', at);
}
export function deleteActivity(state: State, id: string, at = Date.now()): State {
  if ([state.timer, ...(state.conflictedTimers ?? [])].some((timer) => timer?.activityId === id))
    throw new Error('请先结束这个活动的计时。');
  const referenced = state.records.some((record) => record.activityId === id);
  return {
    ...state,
    goals: state.goals.flatMap((goal): Goal[] => {
      if (goal.kind !== undefined || !goal.rules.some((rule) => rule.activities.includes(id)))
        return [goal];
      // A rule that named only this activity is dropped instead of widening to every
      // activity; a goal left without rules goes with the activity, as before.
      const rules = goal.rules.flatMap((rule) => {
        const activities = rule.activities.filter((item) => item !== id);
        return rule.activities.length && !activities.length ? [] : [{ ...rule, activities }];
      });
      return rules.length ? [{ ...goal, rules, updatedAt: timestamp(goal.updatedAt) }] : [];
    }),
    activities: referenced
      ? state.activities.map((activity) =>
          activity.id === id
            ? { ...activity, deletedAt: at, updatedAt: timestamp(activity.updatedAt) }
            : activity,
        )
      : state.activities.filter((activity) => activity.id !== id),
  };
}

export const dayKey = (date: Date | number) => businessDateKey(Number(date));
export const dayStart = (key: string) => businessDayStart(key);
export const shiftDay = (key: string, offset: number) => zoneShiftDay(key, offset);
export function dayRange(key: string): Span {
  return { start: dayStart(key), end: dayStart(shiftDay(key, 1)) };
}
/** The trigger button counts an occurrence; the action button counts an occurrence handled well. */
export function countBehavior(
  state: State,
  ruleId: string,
  date: string,
  counter: BehaviorCounter,
  now = Date.now(),
): State {
  const goal = state.goals.find((row) => row.id === ruleId);
  if (goal?.kind !== 'behaviorRule' || goal.archived)
    throw new Error('行为规则已变化，请重新打开。');
  if (date !== dayKey(now) || now < dayStart(date) || now >= dayRange(date).end)
    throw new Error('只能在当天结算前记录行为回顾。');
  const prior = behaviorReview(state, ruleId, date);
  const triggered = (prior?.triggered ?? 0) + 1,
    executed = (prior?.executed ?? 0) + (counter === 'action' ? 1 : 0);
  if (triggered > MAX_BEHAVIOR_COUNT) throw new Error('今日计数已达上限。');
  const row: BehaviorReview = {
    id: behaviorReviewId(ruleId, date),
    ruleId,
    date,
    status: derivedBehaviorStatus(triggered, executed),
    triggered,
    executed,
    updatedAt: now,
  };
  const reviews = state.behaviorReviews ?? [];
  return {
    ...state,
    behaviorReviews: prior
      ? reviews.map((item) => (item.id === row.id ? row : item))
      : [...reviews, row],
  };
}
export function weekRange(key: string): Span {
  const start = shiftDay(key, 1 - weekday(key));
  return { start: dayStart(start), end: dayStart(shiftDay(start, 7)) };
}
export function clipped(spans: Span[], range: Span): Span[] {
  return spans
    .map((span) => ({
      start: Math.max(span.start, range.start),
      end: Math.min(span.end, range.end),
    }))
    .filter((span) => span.end > span.start);
}
export const recordsIn = (state: State, range: Span) =>
  state.records.filter((item) => !item.deletedAt && clipped(item.spans, range).length > 0);
export function unionDuration(spans: Span[]): number {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  let sum = 0,
    end = -Infinity;
  for (const span of sorted) {
    sum += Math.max(0, span.end - Math.max(end, span.start));
    end = Math.max(end, span.end);
  }
  return sum;
}
export function stats(state: State, range: Span) {
  const records = recordsIn(state, range);
  const tracked = unionDuration(records.flatMap((record) => clipped(record.spans, range)));
  const byNature = (nature: Nature) =>
    unionDuration(
      records
        .filter((record) => record.nature === nature)
        .flatMap((record) => clipped(record.spans, range)),
    );
  return {
    tracked,
    positive: byNature('positive'),
    negative: byNature('negative'),
    neutral: byNature('neutral'),
    count: records.length,
  };
}
export const goalRange = (goal: Pick<Goal, 'period'>, key: string) =>
  goal.period === 'week' ? weekRange(key) : dayRange(key);
/** The day, or the week's Monday, that names the period containing `key`. */
export const goalPeriodKey = (goal: Pick<Goal, 'period'>, key: string) =>
  goal.period === 'week' ? shiftDay(key, 1 - weekday(key)) : key;
/** Minutes covered by matching records in `range`; overlapping records count once. */
export function matchedMinutes(state: State, rules: RecordRule[], range: Span): number {
  return (
    unionDuration(
      recordsIn(state, range)
        .filter((item) => matchesRules(rules, item))
        .flatMap((item) => clipped(item.spans, range)),
    ) / 60000
  );
}
export const goalProgress = (state: State, goal: TimeGoal, key: string) =>
  matchedMinutes(state, goal.rules, goalRange(goal, key));
export const formatDuration = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return minutes < 60
    ? `${minutes} 分钟`
    : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
};
export const formatClock = (ms: number) => {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};
export const formatTime = (at: number) => zoneClock(at);
/**
 * A period is judged only after it ends, so a ceiling is not met early and a stray
 * long record can still be corrected before the result counts.
 */
export function goalStatus(
  state: State,
  goal: Goal,
  key: string,
  now = Date.now(),
  tasks: GoalTask[] = [],
) {
  const settled = now >= goalRange(goal, key).end;
  if (goal.kind === 'behaviorRule') {
    const review = behaviorReview(state, goal.id, key);
    return {
      reviewStatus: review?.status ?? null,
      triggered: review?.triggered ?? 0,
      executed: review?.executed ?? 0,
      progress: 0,
      target: 0,
      settled,
      met: null,
      within: false,
      reached: 0,
      levels: 0,
    };
  }
  let progress: number, target: number, within: boolean;
  if (goal.kind === 'script') {
    const outcome = scriptResult(state, goal, key);
    progress = outcome && !outcome.error ? outcome.progress : 0;
    target = 1;
    within = outcome?.met === true;
    return {
      progress,
      target,
      settled,
      // A script that has not answered yet, failed or returned null is undecided, not missed.
      met: settled && outcome && !outcome.error && outcome.met !== null ? within : null,
      within,
      reached: Number(within),
      levels: 1,
    };
  }
  if (goal.kind === 'tasks') {
    const first = goalPeriodKey(goal, key),
      last = goal.period === 'week' ? shiftDay(first, 6) : first;
    const due = tasks.filter(
      (task) =>
        !task.deletedAt &&
        Object.keys(task.dates).some((date) => date !== '∞' && date >= first && date <= last) &&
        task.tags.includes(goal.taskTag),
    );
    progress = due.filter((task) => {
      const events = task.history?.filter((event) => dayKey(Date.parse(event.at)) <= last);
      return (
        events?.at(-1)?.done ?? (!!task.completedAt && dayKey(Date.parse(task.completedAt)) <= last)
      );
    }).length;
    target = due.length;
    within = target > 0 && progress === target;
  } else if (goal.kind === 'manual') {
    progress = goal.checks[goalPeriodKey(goal, key)]?.done ? 1 : 0;
    target = 1;
    within = progress === 1;
  } else {
    progress = goalProgress(state, goal, key);
    target = goal.minutes;
    within = goal.comparison === 'atMost' ? progress <= goal.minutes : progress >= goal.minutes;
  }
  // Stages only grade time goals; the final target alone decides `met`.
  const thresholds = goal.kind === undefined ? [...(goal.stages ?? []), goal.minutes] : [target];
  const reached =
    goal.kind === undefined
      ? thresholds.filter((value) =>
          goal.comparison === 'atMost' ? progress <= value : progress >= value,
        ).length
      : Number(within);
  return {
    progress,
    target,
    settled,
    met: settled ? within : null,
    within,
    reached,
    levels: thresholds.length,
  };
}
const MAX_STAGES = 50;
/** Sorted, deduplicated stage minutes on the correct side of the final target. */
export function goalStages(
  values: number[],
  goal: Pick<TimeGoal, 'minutes' | 'comparison'>,
): number[] {
  const stages = [...new Set(values.map((value) => Math.round(value)))]
    .filter((value) => value !== goal.minutes)
    .sort((a, b) => a - b);
  if (stages.length > MAX_STAGES) throw new Error(`阶段最多 ${MAX_STAGES} 个。`);
  for (const value of stages) {
    if (!Number.isFinite(value) || value < 1 || value > 1000000) throw new Error('阶段时间无效。');
    if (goal.comparison === 'atLeast' ? value > goal.minutes : value < goal.minutes)
      throw new Error(
        goal.comparison === 'atLeast'
          ? '阶段须小于目标时间。'
          : '「不超过」目标的阶段须大于目标时间。',
      );
  }
  return stages;
}
/** Moves one row among `visible` ids and writes `order` to every row of `rows`. */
export function reorderRows<T extends { id: string; order?: number; updatedAt: number }>(
  rows: T[],
  visible: string[],
  source: string,
  target: string,
): T[] {
  const order = moveOrder(
    rows.map((row) => row.id),
    visible,
    source,
    target,
  );
  if (!order) return rows;
  return rows
    .map((row) =>
      row.order === order.get(row.id)
        ? row
        : { ...row, order: order.get(row.id)!, updatedAt: timestamp(row.updatedAt) },
    )
    .sort(byOrder);
}
/**
 * Goals as the page shows them: user groups in first-seen order, manual order inside each
 * group. Goals never ordered by hand keep the older rule of daily before weekly.
 */
export function sortGoals<T extends Goal>(goals: T[]): T[] {
  const sorted = goals
    .map((goal, index) => ({ goal, index }))
    .sort(
      (a, b) =>
        byOrder(a.goal, b.goal) ||
        (a.goal.order === undefined
          ? Number(a.goal.period === 'week') - Number(b.goal.period === 'week')
          : 0) ||
        a.index - b.index,
    )
    .map((item) => item.goal);
  const groups = [...new Set(sorted.map((goal) => goal.group ?? ''))];
  return groups.flatMap((group) => sorted.filter((goal) => (goal.group ?? '') === group));
}
const HOUR_UNIT = /^(?:h|小时|时)$/;
const AMOUNT = /^(?:(\d+(?:\.\d+)?)(?:h|小时|时))?(?:(\d+(?:\.\d+)?)(?:m|min|分钟|分)?)?$/;
const TARGET_HINT = '目标时间示例：9h、<2h、1h30m、8-16h、<1-3h（纯数字按分钟）。';
/**
 * Target time with optional stages in one field: "9h" is a single target; "8-16h" means
 * ≥8h, ≥9h … ≥16h and "<1-3h" ≤1h, ≤2h, ≤3h (one stage per unit). Lists like "8,10,16h"
 * name thresholds directly. The strictest threshold is the goal; the rest become stages.
 * A trailing unit applies to bare numbers; without one they are minutes.
 */
export function parseGoalTarget(text: string): Pick<TimeGoal, 'minutes' | 'comparison' | 'stages'> {
  const normalized = text.trim().toLowerCase();
  const prefix = normalized.match(/^(>=|<=|≥|≤|>|<)?\s*/)!;
  const comparison: TimeGoal['comparison'] = /[<≤]/.test(prefix[1] ?? '') ? 'atMost' : 'atLeast';
  const parts = normalized
    .slice(prefix[0].length)
    .replace(/\s+/g, '')
    .split(/[,，、;；]+/)
    .filter(Boolean);
  const unitOf = (part: string) => part.match(/(h|小时|时|m|min|分钟|分)$/)?.[1];
  const tail = parts.length ? unitOf(parts[parts.length - 1]) : undefined;
  const defaultUnit = tail && HOUR_UNIT.test(tail) ? 60 : 1;
  const amount = (value: string) => {
    if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * defaultUnit;
    const match = value.match(AMOUNT);
    if (!match || !(match[1] || match[2])) throw new Error(TARGET_HINT);
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  };
  const values: number[] = [];
  for (const part of parts) {
    const range = part.match(
      /^(\d+(?:\.\d+)?)([a-z\u4e00-\u9fff]*)[-~–—到至](\d+(?:\.\d+)?)([a-z\u4e00-\u9fff]*)$/,
    );
    if (!range) {
      values.push(amount(part));
      continue;
    }
    // "8-16h": the unit after the range applies to both ends and sets the step.
    const unitScale = (unit: string) => {
      if (!unit) return defaultUnit;
      if (HOUR_UNIT.test(unit)) return 60;
      if (/^(?:m|min|分钟|分)$/.test(unit)) return 1;
      throw new Error(TARGET_HINT);
    };
    const step = unitScale(range[4] || range[2]);
    const [low, high] = [
      Number(range[1]) * unitScale(range[2] || range[4]),
      Number(range[3]) * step,
    ].sort((a, b) => a - b);
    if ((high - low) / step > MAX_STAGES) throw new Error(`阶段最多 ${MAX_STAGES} 个。`);
    for (let value = low; value < high - 1e-9; value += step) values.push(value);
    values.push(high);
  }
  const thresholds = [...new Set(values.map((value) => Math.round(value)))].sort((a, b) => a - b);
  if (
    !thresholds.length ||
    thresholds.some((value) => !Number.isFinite(value) || value < 1 || value > 1000000)
  )
    throw new Error(TARGET_HINT);
  const minutes = comparison === 'atMost' ? thresholds[0] : thresholds[thresholds.length - 1];
  const stages = goalStages(thresholds, { minutes, comparison });
  return { minutes, comparison, ...(stages.length ? { stages } : {}) };
}
/** Editable form ("<1-3h", "8,10,16h") or display form ("≤ 1 小时 30 分钟"). */
export function goalTargetText(
  goal: Pick<TimeGoal, 'minutes' | 'comparison' | 'stages'>,
  display = false,
) {
  if (display)
    return (goal.comparison === 'atMost' ? '≤ ' : '≥ ') + formatDuration(goal.minutes * 60000);
  const sign = goal.comparison === 'atMost' ? '<' : '';
  const thresholds = [...(goal.stages ?? []), goal.minutes].sort((a, b) => a - b);
  if (thresholds.length === 1) {
    const hours = Math.floor(goal.minutes / 60),
      minutes = goal.minutes % 60;
    return sign + (hours ? `${hours}h${minutes ? `${minutes}m` : ''}` : String(minutes));
  }
  const unit = thresholds.every((value) => value % 60 === 0) ? 60 : 1;
  const parts: string[] = [];
  for (let index = 0; index < thresholds.length;) {
    let end = index;
    while (end + 1 < thresholds.length && thresholds[end + 1] === thresholds[end] + unit) end++;
    parts.push(
      end - index >= 2
        ? `${thresholds[index] / unit}-${thresholds[end] / unit}`
        : thresholds
            .slice(index, end + 1)
            .map((value) => String(value / unit))
            .join(','),
    );
    index = end + 1;
  }
  return sign + parts.join(',') + (unit === 60 ? 'h' : '');
}
export const localDateTime = (at: number) => dateTimeInput(at);

function obj(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} 格式错误。`);
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${label} 必须是长度不超过 ${max} 的文本。`);
  return value;
}
function num(value: unknown, label: string, min = 0, max = 8.64e15): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${label} 数值无效。`);
  return value;
}
const bool = (value: unknown) => {
  if (typeof value !== 'boolean') throw new Error('布尔值无效。');
  return value;
};
const id = (value: unknown) => {
  const result = str(value, 'ID', 100);
  if (!result.trim()) throw new Error('ID 不能为空。');
  return result;
};
const name = (value: unknown) => {
  const result = str(value, '名称', 80).trim();
  if (!result) throw new Error('名称不能为空。');
  return result;
};
const nature = (value: unknown): Nature => {
  if (value !== 'positive' && value !== 'neutral' && value !== 'negative')
    throw new Error('活动性质无效。');
  return value;
};
const orderField = (value: unknown) =>
  value === undefined ? {} : { order: num(value, '排序', -1e9, 1e9) };
function list<T>(value: unknown, label: string, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 列表无效或过大。`);
  return value.map(parse);
}
function spans(value: unknown, allowEmpty = false): Span[] {
  const result = list(value, '时间片段', 10000, (item) => {
    const o = obj(item, '时间片段');
    const start = num(o.start, '开始时间'),
      end = num(o.end, '结束时间');
    if (end <= start) throw new Error('结束时间必须晚于开始时间。');
    return { start, end };
  });
  if (!allowEmpty && !result.length) throw new Error('记录缺少时间片段。');
  for (let i = 1; i < result.length; i++)
    if (result[i].start < result[i - 1].end) throw new Error('记录内的时间片段重叠或未排序。');
  return result;
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('存在重复 ID。');
  return items;
}
function presetMinutes(value: unknown) {
  const minutes = num(value, '分钟', 1, 10080);
  if (!Number.isInteger(minutes)) throw new Error('倒计时预设须为整数分钟。');
  return minutes;
}
export function validateState(value: unknown): State {
  const root = obj(value, '数据');
  const activities = unique(
    list(root.activities, '活动', 2000, (value): Activity => {
      const o = obj(value, '活动');
      const color = str(o.color, '颜色', 7);
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('颜色格式错误。');
      return {
        id: id(o.id),
        name: name(o.name),
        color,
        nature: nature(o.nature),
        archived: bool(o.archived),
        ...(o.deletedAt === undefined ? {} : { deletedAt: num(o.deletedAt, '删除时间') }),
        ...orderField(o.order),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  ).sort(byOrder);
  const activityIds = new Set(activities.map((item) => item.id));
  const activityId = (value: unknown) => {
    const result = id(value);
    if (!activityIds.has(result)) throw new Error('记录引用了不存在的活动。');
    return result;
  };
  const tags = (value: unknown) => list(value, '标签', 16, (item) => str(item, '标签', 40));
  const atLeastOne = (rules: RecordRule[]) => {
    if (!rules.length) throw new Error('计时目标至少需要一条计入规则。');
    return rules;
  };
  const recordRule = (value: unknown): RecordRule => {
    const o = obj(value, '计入规则');
    const names = (item: unknown) => [
      ...new Set(list(item, '标签', 50, (tag) => str(tag, '标签', 40).trim()).filter(Boolean)),
    ];
    const rule: RecordRule = {
      activities: [...new Set(list(o.activities ?? [], '活动', 200, activityId))],
      tags: names(o.tags ?? []),
      excludeTags: names(o.excludeTags ?? []),
    };
    if (rule.tags.some((tag) => rule.excludeTags.includes(tag)))
      throw new Error('同一标签不能既包含又排除。');
    return rule;
  };
  const records = unique(
    list(root.records, '记录', 100000, (value): TimeRecord => {
      const o = obj(value, '记录');
      return {
        id: id(o.id),
        activityId: activityId(o.activityId),
        ...(o.taskId === undefined ? {} : { taskId: id(o.taskId) }),
        note: str(o.note, '描述'),
        tags: tags(o.tags),
        spans: spans(o.spans),
        nature: nature(o.nature),
        deletedAt: o.deletedAt === null ? null : num(o.deletedAt, '删除时间'),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
  const goals = unique(
    list(root.goals, '目标', 2000, (value): Goal => {
      const o = obj(value, '目标');
      if (o.period !== 'day' && o.period !== 'week') throw new Error('目标周期错误。');
      const common = {
        id: id(o.id),
        name: name(o.name),
        ...(o.group === undefined ? {} : { group: name(o.group) }),
        ...(o.taskId === undefined ? {} : { taskId: id(o.taskId) }),
        period: o.period,
        archived: bool(o.archived),
        ...orderField(o.order),
        updatedAt: num(o.updatedAt, '更新时间'),
      } as const;
      if (o.kind === 'tasks') {
        const taskTag = str(o.taskTag, '标签', 40).trim();
        if (!taskTag) throw new Error('请填写绑定的待办标签。');
        return { ...common, kind: 'tasks', taskTag };
      }
      if (o.kind === 'manual') {
        const checks = obj(o.checks, '勾选记录');
        if (Object.keys(checks).length > 2000) throw new Error('勾选记录过多。');
        return {
          ...common,
          kind: 'manual',
          checks: Object.fromEntries(
            Object.entries(checks).map(([key, value]): [string, GoalCheck] => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('勾选周期错误。');
              const check = obj(value, '勾选');
              if (check.by !== 'user' && check.by !== 'ai') throw new Error('勾选来源错误。');
              return [key, { done: bool(check.done), by: check.by, at: num(check.at, '勾选时间') }];
            }),
          ),
        };
      }
      if (o.kind === 'behaviorRule') {
        if (common.period !== 'day') throw new Error('行为规则只支持每日回顾。');
        const trigger = str(o.trigger, '触发条件', MAX_BEHAVIOR_TEXT).trim();
        const action = str(o.action, '目标行为', MAX_BEHAVIOR_TEXT).trim();
        if (!trigger || !action) throw new Error('请填写触发条件和目标行为。');
        return { ...common, kind: 'behaviorRule', period: 'day', trigger, action };
      }
      if (o.kind === 'script') {
        const params = obj(o.params ?? {}, '脚本参数');
        if (Object.keys(params).length > 50) throw new Error('脚本参数过多。');
        return {
          ...common,
          kind: 'script',
          scriptId: id(o.scriptId),
          params: Object.fromEntries(
            Object.entries(params).map(([key, value]): [string, ScriptParam] => {
              if (!/^[A-Za-z_$][\w$]{0,39}$/.test(key)) throw new Error('脚本参数名无效。');
              if (Array.isArray(value))
                return [key, list(value, '脚本参数', 200, (item) => str(item, '脚本参数', 500))];
              if (typeof value === 'number') return [key, num(value, '脚本参数', -1e12, 1e12)];
              if (typeof value === 'boolean') return [key, value];
              return [key, str(value, '脚本参数', 2000)];
            }),
          ),
        };
      }
      if (o.kind !== undefined) throw new Error('目标类型错误。');
      const target = {
        minutes: num(o.minutes, '目标分钟', 1, 1000000),
        // Goals saved before the comparison existed were all floors.
        comparison: o.comparison === 'atMost' ? 'atMost' : 'atLeast',
      } as const;
      const stages =
        o.stages === undefined
          ? []
          : goalStages(
              list(o.stages, '阶段', MAX_STAGES, (value) => num(value, '阶段分钟', 1, 1000000)),
              target,
            );
      return {
        ...common,
        // Goals saved before rules existed counted exactly one activity.
        rules:
          o.rules === undefined
            ? [{ ...emptyRule(), activities: [activityId(o.activityId)] }]
            : atLeastOne(list(o.rules, '计入规则', 20, recordRule)),
        ...target,
        ...(stages.length ? { stages } : {}),
      };
    }),
  ).sort(byOrder);
  // Points, rewards and redemptions were removed; older data carrying them is read and dropped.
  const parseTimer = (value: unknown): Timer => {
    const o = obj(value, '计时');
    const timer: Timer = {
      id: id(o.id),
      activityId: activityId(o.activityId),
      ...(o.taskId === undefined ? {} : { taskId: id(o.taskId) }),
      note: str(o.note, '描述'),
      tags: tags(o.tags),
      spans: spans(o.spans, true),
      runningSince: o.runningSince === null ? null : num(o.runningSince, '计时起点'),
      startedAt: num(o.startedAt, '开始时间'),
      ...(o.plannedEndAt === undefined
        ? {}
        : { plannedEndAt: o.plannedEndAt === null ? null : num(o.plannedEndAt, '计划结束时间') }),
      nature: nature(o.nature),
    };
    if (records.some((record) => record.id === timer!.id)) throw new Error('计时与记录 ID 重复。');
    if (
      timer.plannedEndAt != null &&
      timer.plannedEndAt <=
        Math.max(timer.startedAt, timer.runningSince ?? 0, ...timer.spans.map((span) => span.end))
    )
      throw new Error('结束时间必须晚于开始与已有片段。');
    if (timer.plannedEndAt != null && duration(liveSpans(timer, timer.plannedEndAt)) < 1000)
      throw new Error('倒计时至少需要一秒。');
    if (
      timer.spans.some((span) => span.start < timer!.startedAt) ||
      (timer.runningSince !== null &&
        timer.runningSince < Math.max(timer.startedAt, ...timer.spans.map((span) => span.end)))
    )
      throw new Error('计时片段顺序错误。');
    return timer;
  };
  const scripts = unique(
    list(root.scripts ?? [], '脚本', 200, (value): GoalScript => {
      const o = obj(value, '脚本');
      return {
        id: id(o.id),
        name: name(o.name),
        code: str(o.code, '脚本代码', MAX_SCRIPT_LENGTH),
        ...orderField(o.order),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  ).sort(byOrder);
  const goalResults = unique(
    list(root.goalResults ?? [], '目标结果', 20000, (value): GoalResult => {
      const o = obj(value, '目标结果');
      if (o.met !== true && o.met !== false && o.met !== null) throw new Error('目标结果无效。');
      const goalId = id(o.goalId);
      const period = str(o.period, '周期', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) throw new Error('目标结果周期错误。');
      if (o.id !== goalResultId(goalId, period)) throw new Error('目标结果 ID 错误。');
      return {
        id: o.id,
        goalId,
        period,
        met: o.met,
        progress: num(o.progress, '进度', 0, 1),
        note: str(o.note, '说明', 200),
        ...(o.error === undefined ? {} : { error: str(o.error, '错误', 2000) }),
        basis: str(o.basis, '计算依据', 20000),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
  const goalIds = new Set(goals.map((goal) => goal.id));
  const behaviorReviews = unique(
    list(root.behaviorReviews ?? [], '行为回顾', 100000, (value): BehaviorReview => {
      const o = obj(value, '行为回顾');
      const ruleId = id(o.ruleId);
      const date = str(o.date, '行为回顾日期', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || shiftDay(date, 0) !== date)
        throw new Error('行为回顾日期无效。');
      if (o.id !== behaviorReviewId(ruleId, date)) throw new Error('行为回顾 ID 无效。');
      let triggered: number, executed: number;
      if (o.triggered === undefined && o.executed === undefined) {
        const status = o.status;
        if (status !== 'notTriggered' && status !== 'missed' && status !== 'executed')
          throw new Error('执行状态无效。');
        [triggered, executed] = legacyBehaviorCounts[status];
      } else {
        triggered = num(o.triggered, '触发次数');
        executed = num(o.executed, '执行次数');
        if (
          !Number.isInteger(triggered) ||
          !Number.isInteger(executed) ||
          executed < 0 ||
          executed > triggered ||
          triggered > MAX_BEHAVIOR_COUNT
        )
          throw new Error('行为回顾次数无效。');
      }
      return {
        id: o.id,
        ruleId,
        date,
        status: derivedBehaviorStatus(triggered, executed),
        triggered,
        executed,
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  ).filter((row) => goalIds.has(row.ruleId));
  const timer = root.timer === null ? null : parseTimer(root.timer);
  const conflictedTimers = unique(list(root.conflictedTimers ?? [], '同时计时', 100, parseTimer));
  if (conflictedTimers.some((item) => item.id === timer?.id)) throw new Error('计时 ID 重复。');
  const settings = obj(root.settings, '设置');
  if (settings.weekStartsOn !== 1) throw new Error('不支持的周起始设置。');
  return {
    activities,
    records,
    goals,
    ...(scripts.length ? { scripts } : {}),
    ...(goalResults.length ? { goalResults } : {}),
    ...(behaviorReviews.length ? { behaviorReviews } : {}),
    timer,
    ...(conflictedTimers.length ? { conflictedTimers } : {}),
    settings: {
      weekStartsOn: 1,
      updatedAt: num(settings.updatedAt, '设置更新时间'),
      timerPresets:
        settings.timerPresets === undefined
          ? [5, 30, 45, 60]
          : [
              ...new Set(
                list(settings.timerPresets, '倒计时预设', 30, (value) => presetMinutes(value)),
              ),
            ],
    },
  };
}
export const makeBackup = (state: State): Backup => ({
  format: 'open-timelog',
  version: 1,
  exportedAt: new Date().toISOString(),
  data: state,
});
export function parseBackup(text: string): Backup {
  if (text.length > 10 * 1024 * 1024) throw new Error('备份超过 10 MB，请拆分后导入。');
  const o = obj(JSON.parse(text), '备份');
  if (o.format !== 'open-timelog' || o.version !== 1)
    throw new Error('请选择时迹 v1 JSON 备份。UpTimer 原生备份尚不支持直接导入。');
  const exportedAt = str(o.exportedAt, '导出时间', 100);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error('备份时间无效。');
  return {
    format: 'open-timelog',
    version: 1,
    exportedAt,
    data: validateState(o.data),
  };
}
function mergeList<T extends { id: string; updatedAt: number }>(local: T[], incoming: T[]): T[] {
  const items = new Map(local.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = items.get(item.id);
    if (!previous || item.updatedAt > previous.updatedAt) items.set(item.id, item);
    else if (
      item.updatedAt === previous.updatedAt &&
      JSON.stringify(item) !== JSON.stringify(previous)
    )
      throw new Error('备份存在同一版本的不同内容，已取消导入。请保留两份备份。');
  }
  return [...items.values()];
}
export function mergeBackup(local: State, incoming: State): State {
  local = validateState(local);
  incoming = validateState(incoming);
  if (
    local.timer ||
    incoming.timer ||
    local.conflictedTimers?.length ||
    incoming.conflictedTimers?.length
  )
    throw new Error('请先在原设备保存计时，再导出并合并备份。');
  return validateState({
    activities: mergeList(local.activities, incoming.activities),
    records: mergeList(local.records, incoming.records),
    goals: mergeList(local.goals, incoming.goals),
    scripts: mergeList(local.scripts ?? [], incoming.scripts ?? []),
    goalResults: mergeList(local.goalResults ?? [], incoming.goalResults ?? []),
    behaviorReviews: mergeList(local.behaviorReviews ?? [], incoming.behaviorReviews ?? []),
    timer: null,
    settings:
      incoming.settings.updatedAt > local.settings.updatedAt ? incoming.settings : local.settings,
  });
}
const csvCell = (value: string | number) => {
  const text = String(value);
  return `"${(/^[\s]*[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
};
export function toCsv(state: State): string {
  const rows: (string | number)[][] = [
    ['记录ID', '活动', '性质', '开始时间', '结束时间', '有效秒数', '描述', '标签'],
  ];
  for (const record of state.records.filter((item) => !item.deletedAt)) {
    rows.push([
      record.id,
      state.activities.find((item) => item.id === record.activityId)?.name || '',
      natureLabels[record.nature],
      new Date(record.spans[0].start).toISOString(),
      new Date(record.spans.at(-1)!.end).toISOString(),
      duration(record.spans) / 1000,
      record.note,
      record.tags.join(', '),
    ]);
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function toMarkdown(state: State, key: string): string {
  const range = dayRange(key),
    summary = stats(state, range);
  const safe = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', '<br>');
  return (
    `# ${key} 时间回顾\n\n记录 ${formatDuration(summary.tracked)} · 积极 ${formatDuration(summary.positive)}\n\n| 时间 | 活动 | 时长 | 描述 |\n| --- | --- | --- | --- |\n` +
    recordsIn(state, range)
      .sort((a, b) => a.spans[0].start - b.spans[0].start)
      .map((record) => {
        const parts = clipped(record.spans, range);
        return `| ${formatTime(parts[0].start)}–${formatTime(parts.at(-1)!.end)} | ${safe(state.activities.find((item) => item.id === record.activityId)?.name || '')} | ${formatDuration(duration(parts))} | ${safe(record.note)} |`;
      })
      .join('\n') +
    '\n'
  );
}
