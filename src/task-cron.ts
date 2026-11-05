import { CronExpressionParser } from 'cron-parser';

export const cronZone = (zone: string) => (/^[+-]/.test(zone) ? `UTC${zone}` : zone);
/** Deterministic five-field Cron, using cron-parser's timezone and DST implementation. */
export function validateCron(cron: string) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || !/^[\d\s*,/\-]+$/.test(cron))
    throw new Error('请输入五字段 Cron：分 时 日 月 星期');
  if (fields[2] !== '*' && fields[4] !== '*') throw new Error('月日与星期不能同时指定');
  const iterator = CronExpressionParser.parse(cron, { currentDate: new Date(0), tz: 'UTC' });
  iterator.next();
  return cron;
}
