// 示例：当天在打上「决定休息」标签的记录之前，不能有娱乐活动。
// 没有决定休息的记录时，整天都算“休息之前”。

export const description = '决定休息之前出现娱乐活动就算失败。';

export const params = {
  restTag: { label: '休息标签', type: 'text', default: '决定休息' },
  fun: {
    label: '娱乐活动',
    type: 'list',
    default: [],
    hint: '活动名，逗号分隔；留空则把所有“消极”性质的活动当作娱乐',
  },
  graceMinutes: { label: '允许分钟', type: 'number', default: 0 },
};

export default async function judge(ctx) {
  const { restTag, fun, graceMinutes } = ctx.params;
  const rest = await ctx.records({ tags: [restTag] });
  const cut = rest.length ? rest[0].start : ctx.period.end;
  const before = { start: ctx.period.start, end: cut };
  const entertainment = fun.length
    ? await ctx.records({ activities: fun, ...before })
    : await ctx.records({ nature: 'negative', ...before });
  const spent = ctx.util.minutes(entertainment.flatMap((record) => record.spans));
  ctx.log('决定休息', rest.length ? ctx.util.clock(cut) : '无', '之前娱乐分钟', spent);
  if (!rest.length && !ctx.period.settled && spent <= graceMinutes)
    return { met: null, note: '还没有决定休息' };
  return {
    met: spent <= graceMinutes,
    note: spent
      ? `休息前娱乐 ${Math.round(spent)} 分钟（${[...new Set(entertainment.map((r) => r.activity))].join('、')}）`
      : rest.length
        ? `${ctx.util.clock(cut)} 决定休息，之前没有娱乐`
        : '全天没有娱乐',
  };
}
