// 示例：学习计时期间使用无关软件的总时长和次数，超过阈值就算失败。
// 软件来自自动记录（各设备采集后同步），按应用名包含关系匹配，例如 bilibili、tencent.mm、微信。

export const description = '学习时段内使用无关软件超过阈值就算失败。';

export const params = {
  study: { label: '学习活动', type: 'list', default: [], hint: '填写已有活动的名称或 ID' },
  apps: {
    label: '无关软件',
    type: 'list',
    default: ['bilibili', '抖音', 'aweme', '微信', 'tencent.mm', 'QQ'],
    hint: '应用名包含其中任一项即算无关',
  },
  maxMinutes: { label: '最多分钟', type: 'number', default: 10 },
  maxTimes: { label: '最多次数', type: 'number', default: 3 },
  gapMinutes: {
    label: '合并间隔（分钟）',
    type: 'number',
    default: 2,
    hint: '相隔不超过这么久的使用算同一次',
  },
};

export default async function judge(ctx) {
  const { study, apps, maxMinutes, maxTimes, gapMinutes } = ctx.params;
  if (!study.length) return { met: null, note: '请指定学习活动' };
  const studying = (await ctx.records({ activities: study })).flatMap((record) => record.spans);
  if (!studying.length) return { met: null, note: '没有学习记录' };
  const used = (await ctx.usage({ apps, kinds: ['app'] })).map(({ start, end }) => ({
    start,
    end,
  }));
  const distracted = ctx.util.intersect(used, studying);
  const minutes = ctx.util.minutes(distracted);
  const times = ctx.util.sessions(distracted, gapMinutes).length;
  ctx.log('学习分钟', ctx.util.minutes(studying), '无关分钟', minutes, '次数', times);
  return {
    met: minutes <= maxMinutes && times <= maxTimes,
    progress: 1 - Math.min(1, Math.max(minutes / maxMinutes, times / maxTimes) / 2),
    note: `学习时用无关软件 ${Math.round(minutes)} 分钟 · ${times} 次`,
  };
}
