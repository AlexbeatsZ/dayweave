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
  const segments = [];
  const hasInputEvidence = observations.some(
    (row) => row.platform !== 'android' && row.inputState !== 'unknown',
  );
  let passed = 0;
  let over = 0;
  let uncertain = false;
  let largest = 0;
  const localMinutes = Number(ctx.util.clock(start).slice(3, 5));
  const first = start - localMinutes * 60000;
  for (let index = 0; index < 24; index++) {
    const from = first + index * hour;
    const label = ctx.util.clock(from);
    if (from >= limit && from > now) {
      segments.push({ label, status: 'pending' });
      continue;
    }
    const restricted = {
      start: Math.max(start, from + 15 * 60000),
      end: Math.min(limit, from + hour),
    };
    const used = Math.round(ctx.util.minutes(ctx.util.clip(active, restricted)) * 60000);
    largest = Math.max(largest, used);
    let status;
    if (used > allowance) {
      over++;
      status = 'missed';
    } else if (now < from + hour) {
      status = 'current';
    } else if (
      !hasInputEvidence ||
      ctx.util.minutes(ctx.util.clip([...active, ...unknown], restricted)) > 5
    ) {
      uncertain = true;
      status = 'unknown';
    } else {
      passed++;
      status = 'met';
    }
    segments.push({ label, status });
  }

  const worst = Math.round(largest / 1000);
  const count = `${passed}/24 小时达标`;
  const extra = over ? ` · ${over} 小时超限` : uncertain ? ' · 部分时段证据不足' : '';
  return {
    met: over ? false : uncertain || !hasInputEvidence ? null : true,
    progress: passed / segments.length,
    note: `${count} · 单小时最多 ${Math.floor(worst / 60)} 分 ${worst % 60} 秒${extra}`,
    segments,
  };
}
