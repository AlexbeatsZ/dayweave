export const name = '减少 vibe coding 时间占用';
export const description =
  '每小时 :15 后，只统计指定工具的前台输入活跃时间，扣除例外后最多 5 分钟。';
export const params = {
  effectiveDate: { label: '生效业务日', type: 'text', default: '' },
  apps: {
    label: '专用应用',
    type: 'list',
    default: ['Codex', 'Codex.exe', 'ChatGPT', 'Claude Code'],
  },
  terminals: {
    label: '需要按标题识别的终端',
    type: 'list',
    default: [
      'Terminal',
      'iTerm2',
      'Ghostty',
      'Warp',
      'Alacritty',
      'kitty',
      'Windows Terminal',
      'WindowsTerminal',
      'WindowsTerminal.exe',
      'WezTerm',
      'Tabby',
    ],
  },
};

const evidenceList = '目标凭证';
const hour = 3600000;
const allowance = 300000;
const inList = (value, patterns) =>
  patterns.some((pattern) => pattern.toLowerCase() === value.trim().toLowerCase());

function exceptionWindow(task, dayStart) {
  try {
    const { kind, sentAt, start, end, approvedAt } = JSON.parse(task.notes);
    if (![sentAt, start, end].every(Number.isSafeInteger) || start >= end) return [];
    if (kind === 'emergency' && Math.max(start, sentAt) < end)
      return [{ start: Math.max(start, sentAt), end }];
    if (
      kind === 'planned' &&
      sentAt < dayStart &&
      Number.isSafeInteger(approvedAt) &&
      sentAt <= approvedAt &&
      approvedAt <= start &&
      task.createdAt <= start
    )
      return [{ start, end }];
  } catch {
    // A malformed task note carries no exception.
  }
  return [];
}

export default async function judge(ctx) {
  const { key, start, end, now } = ctx.period;
  const limit = Math.min(end, now);
  if ((ctx.params.effectiveDate && key < ctx.params.effectiveDate) || limit <= start) return null;
  const observations = await ctx.usage({
    kinds: ['app'],
    start,
    end: limit,
    includeForegroundOnly: true,
  });
  const tool = (row) =>
    row.platform !== 'android' &&
    (inList(row.app, ctx.params.apps) ||
      (inList(row.app, ctx.params.terminals) && /\b(codex|claude code)\b/i.test(row.title)));
  const requests = await ctx.tasks({ dueFrom: key, dueTo: key, completed: true });
  const exceptions = requests
    .filter((task) => task.list === evidenceList && task.title === 'vibe coding 例外')
    .flatMap((task) => exceptionWindow(task, start));
  const observed = observations.filter(tool);
  const active = ctx.util.subtract(
    observed.filter((row) => row.inputState === 'active'),
    exceptions,
  );
  const unknown = ctx.util.subtract(
    observed.filter((row) => row.inputState === 'unknown'),
    exceptions,
  );
  let hours = 0;
  let over = 0;
  let uncertain = false;
  let largest = 0;
  const localMinutes = Number(ctx.util.clock(start).slice(3, 5));
  for (let from = start - localMinutes * 60000; from < limit; from += hour) {
    const restricted = {
      start: Math.max(start, from + 15 * 60000),
      end: Math.min(limit, from + hour),
    };
    if (restricted.end <= restricted.start) continue;
    hours++;
    const used = Math.round(ctx.util.minutes(ctx.util.clip(active, restricted)) * 60000);
    largest = Math.max(largest, used);
    if (used > allowance) over++;
    else if (ctx.util.minutes(ctx.util.clip([...active, ...unknown], restricted)) > 5)
      uncertain = true;
  }
  const worst = Math.round(largest / 1000);
  const note = `单小时最多 ${Math.floor(worst / 60)} 分 ${worst % 60} 秒`;
  if (over)
    return { met: false, progress: (hours - over) / hours, note: `${note} · ${over} 小时超限` };
  if (
    uncertain ||
    !observations.some((row) => row.platform !== 'android' && row.inputState !== 'unknown')
  )
    return { met: null, progress: 0, note: '输入状态证据不足' };
  return { met: true, progress: 1, note };
}
