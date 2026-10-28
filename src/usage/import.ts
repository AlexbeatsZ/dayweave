import { usageEventSchema, type UsageEvent } from './domain.js';

export function parseUsageImport(value: unknown, received = Date.now()): UsageEvent[] {
  const rows: UsageEvent[] = [];
  const add = (input: unknown) => rows.push(usageEventSchema.parse(input));
  const parse = (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('不是有效的自动记录备份');
    if (Array.isArray(input)) {
      for (const row of input) parse(row);
      return;
    }
    const data = input as Record<string, any>;
    if (data.format === 'dayweave-usage' && data.version === 1) {
      for (const row of data.events) add(row);
      return;
    }
    if (data.source && data.deviceId && typeof data.start === 'number') {
      add(data);
      return;
    }
    if (data.device_id && data.app_name !== undefined && typeof data.timestamp === 'number') {
      add({
        id: `work-review:${data.device_id}:${data.id}`,
        deviceId: `work-review:${data.device_id}`,
        deviceName: data.device_name || data.device_id,
        platform: data.platform || 'desktop',
        source: 'work-review',
        kind: 'app',
        start: Math.round(data.timestamp * 1000),
        end: Math.round((data.timestamp + data.duration) * 1000),
        app: data.app_name,
        title: data.window_title || '',
        url: data.browser_url || '',
        category: data.category || '',
        revision: received,
      });
      return;
    }
    if (data.buckets) {
      for (const [bucketId, bucket] of Object.entries(data.buckets as Record<string, any>))
        parse({
          device_id: bucket.hostname || 'unknown',
          bucket: { id: bucketId, ...bucket },
          events: bucket.events,
        });
      return;
    }
    if (data.bucket && Array.isArray(data.events)) {
      const bucket = data.bucket;
      for (const event of data.events)
        parse({
          ...event,
          device_id: data.device_id,
          hostname: bucket.hostname,
          bucket_id: bucket.id,
          bucket_type: bucket.type,
          bucket_created: bucket.created || '',
          received_at: data.received_at,
        });
      return;
    }
    if (data.items && Array.isArray(data.items)) {
      parse(data.items);
      return;
    }
    if (data.bucket_id && data.data && data.id !== undefined) {
      const details = data.data,
        start = Date.parse(data.timestamp);
      const kind = /unlock/i.test(data.bucket_type || data.bucket_id)
        ? 'unlock'
        : /web|browser/i.test(data.bucket_type || data.bucket_id)
          ? 'web'
          : /media/i.test(data.bucket_type || data.bucket_id)
            ? 'media'
            : 'app';
      const sourceId = data.device_id || data.hostname || 'unknown';
      add({
        id: `activitywatch:${sourceId}:${data.bucket_id}:${data.bucket_created || ''}:${data.id}`,
        deviceId: `activitywatch:${sourceId}`,
        deviceName: data.hostname || sourceId,
        platform: 'android',
        source: 'activitywatch',
        kind,
        start,
        end: start + Math.round(Number(data.duration) * 1000),
        app: details.app || details.package || details.browser || '',
        title: details.title || '',
        url: details.url || '',
        category: details.category || '',
        revision: data.received_at ? Date.parse(data.received_at) : received,
      });
      return;
    }
    throw new Error(
      '不支持的格式：请选择 Dayweave 自动记录、Work Review JSON 或 ActivityWatch JSON 导出',
    );
  };
  parse(value);
  if (rows.length > 100000) throw new Error('单次最多导入十万条记录，请分批导入');
  const latest = new Map<string, UsageEvent>();
  for (const event of rows)
    if (!latest.has(event.id) || latest.get(event.id)!.revision <= event.revision)
      latest.set(event.id, event);
  return [...latest.values()];
}
