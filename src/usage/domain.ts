import { z } from 'zod';

export const usageEventSchema = z
  .object({
    id: z.string().min(1).max(600),
    deviceId: z.string().min(1).max(200),
    deviceName: z.string().min(1).max(200),
    platform: z.string().max(40),
    source: z.enum(['activitywatch', 'work-review', 'dayweave']),
    kind: z.enum(['app', 'web', 'unlock', 'media']),
    start: z.number().int().nonnegative().max(32503680000000),
    end: z.number().int().nonnegative().max(32503680000000),
    app: z.string().max(512),
    title: z.string().max(16384).default(''),
    url: z.string().max(16384).default(''),
    category: z.string().max(128).default(''),
    revision: z.number().int().nonnegative(),
    deleted: z.boolean().default(false),
  })
  .refine(
    (event) => event.end >= event.start && event.end - event.start <= 366 * 86400000,
    '自动记录的时间范围无效',
  );
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type UsageQuery = {
  start: number;
  end: number;
  deviceId?: string;
  search?: string;
  before?: number;
  limit?: number;
};
export type UsagePage = { events: UsageEvent[]; next?: number; complete: boolean };
export type UsageDevice = { id: string; name: string; platform: string; lastEvent: number };
export const usageSettingsSchema = z.object({
  enabled: z.boolean(),
  sampleSeconds: z.number().int().min(2).max(300),
  idleMinutes: z.number().int().min(1).max(120),
  browser: z.boolean(),
  excludedApps: z.array(z.string().trim().min(1).max(512)).max(200),
  excludedDomains: z.array(z.string().trim().min(1).max(512)).max(200),
  excludedKeywords: z.array(z.string().trim().min(1).max(512)).max(200),
});
export type UsageSettings = z.infer<typeof usageSettingsSchema>;
export const defaultUsageSettings = (): UsageSettings => ({
  enabled: false,
  sampleSeconds: 10,
  idleMinutes: 5,
  browser: false,
  excludedApps: ['1Password', 'Bitwarden', 'Keychain'],
  excludedDomains: [],
  excludedKeywords: ['bank', 'login', 'password', '密码', '银行', '支付'],
});
export type UsageStatus = {
  settings: UsageSettings;
  capture: string;
  error: string;
  pending: number;
  count: number;
  lastSync?: number;
  devices: UsageDevice[];
};
export interface UsageBridge {
  query(query: UsageQuery): Promise<UsagePage>;
  status(): Promise<UsageStatus>;
  configure(settings: UsageSettings): Promise<UsageStatus>;
  import(events: UsageEvent[]): Promise<number>;
  sync(): Promise<void>;
  permission?(kind: 'usage' | 'browser' | 'battery'): Promise<void>;
}
export const usageQuerySchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    deviceId: z.string().max(200).optional(),
    search: z.string().max(512).optional(),
    before: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .refine(
    (query) => query.end > query.start && query.end - query.start <= 366 * 86400000,
    '请选择一年以内的时间范围',
  );

export function unionDuration(spans: { start: number; end: number }[]) {
  let end = -Infinity,
    total = 0;
  for (const span of spans.slice().sort((left, right) => left.start - right.start)) {
    total += Math.max(0, span.end - Math.max(span.start, end));
    end = Math.max(end, span.end);
  }
  return total;
}
export function usageSummary(events: UsageEvent[], range: { start: number; end: number }) {
  const live = events.filter(
    (event) => !event.deleted && event.end >= range.start && event.start < range.end,
  );
  const apps = live
    .filter((event) => event.kind === 'app')
    .map((event) => ({
      ...event,
      start: Math.max(range.start, event.start),
      end: Math.min(range.end, event.end),
    }));
  const groups = (key: (event: UsageEvent) => string, rows = apps) => {
    const grouped = new Map<string, UsageEvent[]>();
    for (const event of rows) {
      const name = key(event);
      const items = grouped.get(name) ?? [];
      items.push(event);
      grouped.set(name, items);
    }
    return [...grouped]
      .map(([name, items]) => ({ name, duration: unionDuration(items), count: items.length }))
      .sort((left, right) => right.duration - left.duration || left.name.localeCompare(right.name));
  };
  const devices = groups((event) => event.deviceId);
  const totals = (key: (event: UsageEvent) => string, rows = apps) => {
    const values = new Map<string, number>();
    for (const group of groups((event) => `${event.deviceId}\u0000${key(event)}`, rows)) {
      const name = group.name.slice(group.name.indexOf('\u0000') + 1);
      values.set(name, (values.get(name) ?? 0) + group.duration);
    }
    return [...values]
      .map(([name, duration]) => ({ name, duration }))
      .sort((left, right) => right.duration - left.duration);
  };
  return {
    active: unionDuration(apps),
    deviceTime: devices.reduce((sum, device) => sum + device.duration, 0),
    devices,
    apps: totals((event) => event.app || '未知应用'),
    categories: totals((event) => event.category || '未分类'),
    unlocks: live.filter((event) => event.kind === 'unlock' && event.start >= range.start).length,
    websites: totals(
      (event) => {
        try {
          return new URL(event.url.includes('://') ? event.url : `https://${event.url}`).hostname;
        } catch {
          return event.url || '未知网站';
        }
      },
      live
        .filter((event) => event.kind === 'web' || (event.kind === 'app' && event.url))
        .map((event) => ({
          ...event,
          start: Math.max(range.start, event.start),
          end: Math.min(range.end, event.end),
        })),
    ),
  };
}
