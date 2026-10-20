import {
  zoneDateKey,
  dayStart as zoneDayStart,
  shiftDay as zoneShiftDay,
  weekday,
  zoneClock,
  dateTimeInput,
} from '../timezone.js';
export type Nature = 'positive' | 'neutral' | 'negative';
export type Span = { start: number; end: number };
export type Activity = {
  id: string;
  name: string;
  color: string;
  nature: Nature;
  pointsPerHour: number;
  archived: boolean;
  updatedAt: number;
};
export type TimeRecord = {
  taskId?: string;
  id: string;
  activityId: string;
  note: string;
  tags: string[];
  spans: Span[];
  pointsPerHour: number;
  nature: Nature;
  deletedAt: number | null;
  updatedAt: number;
};
export type Timer = {
  taskId?: string;
  id: string;
  activityId: string;
  note: string;
  tags: string[];
  runningSince: number | null;
  spans: Span[];
  pointsPerHour: number;
  nature: Nature;
  startedAt: number;
};
export type Goal = {
  id: string;
  name: string;
  activityId: string;
  minutes: number;
  period: 'day' | 'week';
  archived: boolean;
  updatedAt: number;
};
export type Reward = {
  id: string;
  name: string;
  cost: number;
  archived: boolean;
  updatedAt: number;
};
export type Redemption = {
  id: string;
  rewardId: string;
  name: string;
  cost: number;
  at: number;
  updatedAt: number;
};
export type State = {
  activities: Activity[];
  records: TimeRecord[];
  goals: Goal[];
  rewards: Reward[];
  redemptions: Redemption[];
  timer: Timer | null;
  conflictedTimers?: Timer[];
  settings: { weekStartsOn: 1; updatedAt: number };
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
    activities: [
      {
        id: 'study',
        name: '学习',
        nature: 'positive',
        pointsPerHour: 20,
        color: colors[0],
        archived: false,
        updatedAt: at,
      },
      {
        id: 'work',
        name: '工作',
        nature: 'positive',
        pointsPerHour: 15,
        color: colors[1],
        archived: false,
        updatedAt: at,
      },
      {
        id: 'reading',
        name: '阅读',
        nature: 'positive',
        pointsPerHour: 15,
        color: colors[3],
        archived: false,
        updatedAt: at,
      },
      {
        id: 'exercise',
        name: '运动',
        nature: 'positive',
        pointsPerHour: 25,
        color: colors[6],
        archived: false,
        updatedAt: at,
      },
      {
        id: 'life',
        name: '日常生活',
        nature: 'neutral',
        pointsPerHour: 0,
        color: colors[2],
        archived: false,
        updatedAt: at,
      },
      {
        id: 'scroll',
        name: '无目的刷手机',
        nature: 'negative',
        pointsPerHour: -10,
        color: colors[4],
        archived: false,
        updatedAt: at,
      },
    ],
    records: [],
    goals: [],
    rewards: [],
    redemptions: [],
    timer: null,
    settings: { weekStartsOn: 1, updatedAt: at },
  };
}
export const duration = (spans: Span[]) =>
  spans.reduce((sum, span) => sum + Math.max(0, span.end - span.start), 0);
export function liveSpans(timer: Timer, now: number): Span[] {
  return timer.runningSince === null
    ? timer.spans
    : [...timer.spans, { start: timer.runningSince, end: Math.max(timer.runningSince, now) }];
}
export function startTimer(state: State, activityId: string, note: string, now: number): State {
  if (state.timer || state.conflictedTimers?.length)
    throw new Error('已有计时，请先保存当前计时。');
  const activity = state.activities.find((item) => item.id === activityId && !item.archived);
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
      pointsPerHour: activity.pointsPerHour,
      nature: activity.nature,
      startedAt: now,
    },
  };
}
export function toggleTimer(state: State, now: number): State {
  if (!state.timer) return state;
  const timer = state.timer;
  if (timer.runningSince !== null && now < timer.runningSince)
    throw new Error('系统时间早于计时开始时间，请校准时间后继续。');
  return {
    ...state,
    timer:
      timer.runningSince === null
        ? { ...timer, runningSince: now }
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
  const { id, taskId, activityId, note, tags, pointsPerHour, nature } = state.timer;
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
        pointsPerHour,
        nature,
        updatedAt: now,
        deletedAt: null,
      },
    ],
  };
}

export const dayKey = (date: Date | number) => zoneDateKey(Number(date));
export const dayStart = (key: string) => zoneDayStart(key);
export const shiftDay = (key: string, offset: number) => zoneShiftDay(key, offset);
export function dayRange(key: string): Span {
  return { start: dayStart(key), end: dayStart(shiftDay(key, 1)) };
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
export const recordPoints = (record: Pick<TimeRecord, 'spans' | 'pointsPerHour'>, range?: Span) =>
  (duration(range ? clipped(record.spans, range) : record.spans) / 3_600_000) *
  record.pointsPerHour;
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
    points: records.reduce((sum, record) => sum + recordPoints(record, range), 0),
    count: records.length,
  };
}
export function balance(state: State): number {
  return (
    state.records
      .filter((item) => !item.deletedAt)
      .reduce((sum, record) => sum + recordPoints(record), 0) -
    state.redemptions.reduce((sum, item) => sum + item.cost, 0)
  );
}
export function redeem(state: State, rewardId: string, now: number): State {
  const reward = state.rewards.find((item) => item.id === rewardId && !item.archived);
  if (!reward) throw new Error('这个奖励已归档。');
  if (balance(state) + 1e-9 < reward.cost) throw new Error('积分还不够，继续积累吧。');
  return {
    ...state,
    redemptions: [
      ...state.redemptions,
      {
        id: newId(),
        rewardId,
        name: reward.name,
        cost: reward.cost,
        at: now,
        updatedAt: now,
      },
    ],
  };
}
export function goalProgress(state: State, goal: Goal, key: string): number {
  const range = goal.period === 'week' ? weekRange(key) : dayRange(key);
  return (
    unionDuration(
      recordsIn(state, range)
        .filter((item) => item.activityId === goal.activityId)
        .flatMap((item) => clipped(item.spans, range)),
    ) / 60000
  );
}
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
export const formatPoints = (points: number) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(
    Math.abs(points) < 0.005 ? 0 : points,
  );
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
        pointsPerHour: num(o.pointsPerHour, '积分速率', -100000, 100000),
        archived: bool(o.archived),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
  const activityIds = new Set(activities.map((item) => item.id));
  const activityId = (value: unknown) => {
    const result = id(value);
    if (!activityIds.has(result)) throw new Error('记录引用了不存在的活动。');
    return result;
  };
  const tags = (value: unknown) => list(value, '标签', 16, (item) => str(item, '标签', 40));
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
        pointsPerHour: num(o.pointsPerHour, '积分速率', -100000, 100000),
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
      return {
        id: id(o.id),
        name: name(o.name),
        activityId: activityId(o.activityId),
        ...(o.taskId === undefined ? {} : { taskId: id(o.taskId) }),
        minutes: num(o.minutes, '目标分钟', 1, 1000000),
        period: o.period,
        archived: bool(o.archived),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
  const rewards = unique(
    list(root.rewards, '奖励', 2000, (value): Reward => {
      const o = obj(value, '奖励');
      return {
        id: id(o.id),
        name: name(o.name),
        cost: num(o.cost, '积分', 0.01, 100000000),
        archived: bool(o.archived),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
  const rewardIds = new Set(rewards.map((item) => item.id));
  const redemptions = unique(
    list(root.redemptions, '兑换', 100000, (value): Redemption => {
      const o = obj(value, '兑换');
      const rewardId = id(o.rewardId);
      if (!rewardIds.has(rewardId)) throw new Error('兑换引用了不存在的奖励。');
      return {
        id: id(o.id),
        rewardId,
        name: name(o.name),
        cost: num(o.cost, '积分', 0.01, 100000000),
        at: num(o.at, '兑换时间'),
        updatedAt: num(o.updatedAt, '更新时间'),
      };
    }),
  );
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
      pointsPerHour: num(o.pointsPerHour, '积分速率', -100000, 100000),
      nature: nature(o.nature),
    };
    if (records.some((record) => record.id === timer!.id)) throw new Error('计时与记录 ID 重复。');
    if (
      timer.spans.some((span) => span.start < timer!.startedAt) ||
      (timer.runningSince !== null &&
        timer.runningSince < Math.max(timer.startedAt, ...timer.spans.map((span) => span.end)))
    )
      throw new Error('计时片段顺序错误。');
    return timer;
  };
  const timer = root.timer === null ? null : parseTimer(root.timer);
  const conflictedTimers = unique(list(root.conflictedTimers ?? [], '同时计时', 100, parseTimer));
  if (conflictedTimers.some((item) => item.id === timer?.id)) throw new Error('计时 ID 重复。');
  const settings = obj(root.settings, '设置');
  if (settings.weekStartsOn !== 1) throw new Error('不支持的周起始设置。');
  return {
    activities,
    records,
    goals,
    rewards,
    redemptions,
    timer,
    ...(conflictedTimers.length ? { conflictedTimers } : {}),
    settings: {
      weekStartsOn: 1,
      updatedAt: num(settings.updatedAt, '设置更新时间'),
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
    rewards: mergeList(local.rewards, incoming.rewards),
    redemptions: mergeList(local.redemptions, incoming.redemptions),
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
    ['记录ID', '活动', '性质', '开始时间', '结束时间', '有效秒数', '积分', '描述', '标签'],
  ];
  for (const record of state.records.filter((item) => !item.deletedAt)) {
    rows.push([
      record.id,
      state.activities.find((item) => item.id === record.activityId)?.name || '',
      natureLabels[record.nature],
      new Date(record.spans[0].start).toISOString(),
      new Date(record.spans.at(-1)!.end).toISOString(),
      duration(record.spans) / 1000,
      Number(recordPoints(record).toFixed(4)),
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
    `# ${key} 时间回顾\n\n记录 ${formatDuration(summary.tracked)} · 积极 ${formatDuration(summary.positive)} · 积分 ${formatPoints(summary.points)}\n\n| 时间 | 活动 | 时长 | 描述 |\n| --- | --- | --- | --- |\n` +
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
