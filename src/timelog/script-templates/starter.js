// 时织目标脚本：一个 JavaScript 模块，周期结束后其结果就是目标的判定。完整说明见 docs/goal-scripts.md。
//
// ctx.period  { key, kind: 'day'|'week', start, end, settled, now, timeZone, dayStartsAt, days[] }
// ctx.params  本目标填写的参数（见下方 params 声明）
// 数据（都是 await，时间均为毫秒时间戳，默认范围是本周期，可传 start/end，单次最多 62 天）：
//   await ctx.records({ activities, tags, excludeTags, nature, start, end })  计时记录，已裁剪到范围
//   await ctx.usage({ apps, search, kinds, devices, start, end })             自动记录（软件/网页/解锁）
//   await ctx.tasks({ tag, dueFrom, dueTo, completed })                       待办
//   await ctx.slots({ from, to })                                             日计划时段
//   await ctx.classes({ start, end })                                         课表
//   await ctx.activities()   await ctx.goals()                                活动、其他目标的状态
// ctx.util    union/intersect/subtract/clip/minutes/overlaps/sessions/clock/date/at/matches
// ctx.log(…)  试运行时显示
// 返回 true / false / null（无法判定），或 { met, progress: 0~1, note: '显示在卡片上的说明' }

export const description = '统计本周期的计时总分钟，达到阈值即成功。';

export const params = {
  minutes: { label: '至少分钟', type: 'number', default: 60 },
};

export default async function judge(ctx) {
  const records = await ctx.records();
  const total = ctx.util.minutes(records.flatMap((record) => record.spans));
  ctx.log('记录条数', records.length, '总分钟', Math.round(total));
  return {
    met: total >= ctx.params.minutes,
    progress: total / ctx.params.minutes,
    note: `已计时 ${Math.round(total)} 分钟`,
  };
}
