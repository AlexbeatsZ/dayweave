import { useEffect, useState } from 'react';
import {
  defaultUsageSettings,
  usageEventSchema,
  usageQuerySchema,
  usageSettingsSchema,
  type UsageBridge,
  type UsageEvent,
  type UsageQuery,
  type UsageSettings,
  type UsageStatus,
} from './domain';

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('dayweave-usage', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('events', { keyPath: 'id' });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
function requestValue<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function browserRows() {
  const database = await openDatabase();
  return requestValue(database.transaction('events').objectStore('events').getAll()) as Promise<
    UsageEvent[]
  >;
}
async function browserStatus(): Promise<UsageStatus> {
  const database = await openDatabase();
  const settings = usageSettingsSchema.parse(
    (await requestValue(database.transaction('meta').objectStore('meta').get('settings'))) ??
      defaultUsageSettings(),
  );
  const events = await browserRows(),
    devices = new Map<string, UsageStatus['devices'][number]>();
  for (const event of events)
    if (!event.deleted) {
      const previous = devices.get(event.deviceId);
      if (!previous || previous.lastEvent < event.end)
        devices.set(event.deviceId, {
          id: event.deviceId,
          name: event.deviceName,
          platform: event.platform,
          lastEvent: event.end,
        });
    }
  return {
    settings,
    count: events.filter((event) => !event.deleted).length,
    pending: 0,
    capture: '历史记录',
    error: '',
    devices: [...devices.values()],
  };
}
const browserBridge: UsageBridge = {
  async query(value: UsageQuery) {
    const query = usageQuerySchema.parse(value);
    const events = (await browserRows())
      .filter(
        (event) =>
          !event.deleted &&
          event.start < query.end &&
          event.end >= query.start &&
          (!query.deviceId || query.deviceId === event.deviceId) &&
          (!query.search ||
            `${event.app} ${event.title} ${event.url}`
              .toLowerCase()
              .includes(query.search.toLowerCase())),
      )
      .sort((left, right) => right.start - left.start || left.id.localeCompare(right.id));
    const offset = query.before ?? 0,
      limit = query.limit ?? 500;
    return {
      events: events.slice(offset, offset + limit),
      next: events.length > offset + limit ? offset + limit : undefined,
      complete: events.length <= offset + limit,
    };
  },
  status: browserStatus,
  async configure(settings: UsageSettings) {
    if (settings.enabled) throw new Error('后台采集需要使用 Android、Windows 或 macOS 安装版');
    const database = await openDatabase(),
      transaction = database.transaction('meta', 'readwrite');
    await requestValue(
      transaction.objectStore('meta').put(usageSettingsSchema.parse(settings), 'settings'),
    );
    return browserStatus();
  },
  async import(value: UsageEvent[]) {
    const events = usageEventSchema.array().max(100000).parse(value),
      database = await openDatabase();
    const existing = new Map((await browserRows()).map((event) => [event.id, event]));
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('events', 'readwrite'),
        store = transaction.objectStore('events');
      let changed = 0;
      for (const event of events) {
        const old = existing.get(event.id);
        if (!old || old.revision < event.revision) {
          store.put(event);
          changed++;
        }
      }
      transaction.oncomplete = () => resolve(changed);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },
  async sync() {
    throw new Error('浏览器版不支持设备同步');
  },
};
export const usageBridge = (): UsageBridge => window.clearlist?.usage ?? browserBridge;
export function usageChanged() {
  window.dispatchEvent(new Event('dayweave:usage'));
}
export async function loadUsageRange(query: UsageQuery) {
  const bridge = usageBridge(),
    events: UsageEvent[] = [];
  let before: number | undefined;
  for (let page = 0; page < 200; page++) {
    const result = await bridge.query({ ...query, before, limit: 5000 });
    events.push(...result.events);
    if (result.complete || result.next === undefined) return events;
    if (result.next === before) throw new Error('自动记录分页未前进，请重试');
    before = result.next;
  }
  throw new Error('此时间范围记录过多，请缩小日期范围');
}
export function useUsage(query?: UsageQuery, includeStatus = true) {
  const [result, setResult] = useState<{
    events: UsageEvent[];
    status?: UsageStatus;
    loading: boolean;
    error: string;
  }>({ events: [], loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener('dayweave:usage', changed);
    const timer = setInterval(changed, 30000);
    return () => {
      window.removeEventListener('dayweave:usage', changed);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setResult((previous) => ({ ...previous, events: [], loading: true, error: '' }));
    void Promise.all([
      query ? loadUsageRange(query) : Promise.resolve([]),
      includeStatus ? usageBridge().status() : Promise.resolve(undefined),
    ])
      .then(([events, status]) => {
        if (!cancelled) setResult({ events, status, loading: false, error: '' });
      })
      .catch((error) => {
        if (!cancelled)
          setResult({
            events: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [query?.start, query?.end, query?.deviceId, query?.search, includeStatus, revision]);
  return result;
}
