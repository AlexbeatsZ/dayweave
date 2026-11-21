export const name = '每日三次规划';
export const description = '按早上、午间、晚上的实际规划确认时间各计三分之一。';
export const params = {
  effectiveDate: { label: '生效业务日', type: 'text', default: '' },
};

const phases = [
  ['早上', '09:00'],
  ['午间', '13:00'],
  ['晚上', '19:00'],
];
const evidenceList = '目标凭证';

function confirmation(task, stage) {
  if (task.list !== evidenceList || task.title !== `${stage}规划`) return null;
  const note = task.notes.trim();
  if (!note) return null;
  if (!note.startsWith('{')) return task.completedAt;
  try {
    const { confirmedAt, plan } = JSON.parse(note);
    return Number.isSafeInteger(confirmedAt) && typeof plan === 'string' && plan.trim()
      ? confirmedAt
      : null;
  } catch {
    return null;
  }
}

export default async function judge(ctx) {
  const { key, now, start } = ctx.period;
  if (ctx.params.effectiveDate && key < ctx.params.effectiveDate) return null;
  const tasks = await ctx.tasks({ dueFrom: key, dueTo: key, completed: true });
  let count = 0;
  const labels = phases.map(([label, wall]) => {
    const deadline = ctx.util.at(key, wall);
    const observed = tasks.some((task) => {
      const confirmed = confirmation(task, label);
      return confirmed !== null && confirmed >= start && confirmed <= now && confirmed < deadline;
    });
    if (observed) count++;
    return `${label}${observed ? '已完成' : now >= deadline ? '已过截止' : '待完成'}`;
  });
  return { met: count === 3, progress: count / 3, note: `${count}/3 · ${labels.join(' · ')}` };
}
