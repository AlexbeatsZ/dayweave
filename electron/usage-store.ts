import { DatabaseSync } from 'node:sqlite';
import {
  usageEventSchema,
  usageQuerySchema,
  defaultUsageSettings,
  usageSettingsSchema,
  type UsageEvent,
  type UsageQuery,
  type UsageSettings,
  type UsageStatus,
} from '../src/usage/domain.js';
import {
  usageExchangeSchema,
  usageReplySchema,
  type UsageExchange,
  type UsageReply,
  type UsageReplica,
} from '../src/usage/sync.js';

export class UsageStore implements UsageReplica {
  readonly database: DatabaseSync;
  constructor(readonly file: string) {
    this.database = new DatabaseSync(file);
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS usage_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, device TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, payload TEXT NOT NULL, owner TEXT NOT NULL, pending INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_time ON usage_events(start,end);
      CREATE INDEX IF NOT EXISTS usage_pending ON usage_events(pending,seq);
      CREATE TABLE IF NOT EXISTS usage_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  meta(key: string) {
    const row = this.database.prepare('SELECT value FROM usage_meta WHERE key=?').get(key);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  setMeta(key: string, value: unknown) {
    this.database
      .prepare('INSERT OR REPLACE INTO usage_meta VALUES(?,?)')
      .run(key, JSON.stringify(value));
  }
  transaction<Value>(action: () => Value): Value {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  private put(event: UsageEvent, owner: string, pending: boolean) {
    const existing = this.database
      .prepare('SELECT payload,owner,pending FROM usage_events WHERE id=?')
      .get(event.id);
    if (existing) {
      const old = JSON.parse(String(existing.payload)) as UsageEvent;
      const same =
        JSON.stringify({ ...old, revision: 0 }) === JSON.stringify({ ...event, revision: 0 });
      if (same) return false;
      if (existing.owner !== owner && owner !== '@hub')
        throw new Error('此来源的记录由其他设备管理，不能覆盖');
      if (old.revision >= event.revision) return false;
    }
    this.database
      .prepare(
        'INSERT OR REPLACE INTO usage_events(id,device,start,end,payload,owner,pending) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        event.id,
        event.deviceId,
        event.start,
        event.end,
        JSON.stringify(event),
        owner,
        pending ? 1 : 0,
      );
    return true;
  }
  import(value: UsageEvent[], owner = '@local') {
    const events = usageEventSchema.array().max(100000).parse(value);
    return this.transaction(() =>
      events.reduce((count, event) => count + Number(this.put(event, owner, true)), 0),
    );
  }
  query(value: UsageQuery) {
    const query = usageQuerySchema.parse(value),
      limit = query.limit ?? 500;
    const rows = this.database
      .prepare(
        `SELECT seq,payload FROM usage_events WHERE start<? AND end>=? AND (?='' OR device=?) AND seq<? AND (?='' OR instr(lower(payload),lower(?))>0) AND json_extract(payload,'$.deleted')=0 ORDER BY seq DESC LIMIT ?`,
      )
      .all(
        query.end,
        query.start,
        query.deviceId ?? '',
        query.deviceId ?? '',
        query.before ?? Number.MAX_SAFE_INTEGER,
        query.search ?? '',
        query.search ?? '',
        limit + 1,
      );
    const more = rows.length > limit;
    rows.length = Math.min(rows.length, limit);
    return {
      events: rows.map((row) => JSON.parse(String(row.payload)) as UsageEvent),
      next: more ? Number(rows.at(-1)!.seq) : undefined,
      complete: !more,
    };
  }
  settings() {
    return usageSettingsSchema.parse(this.meta('settings') ?? defaultUsageSettings());
  }
  configure(settings: UsageSettings) {
    this.setMeta('settings', usageSettingsSchema.parse(settings));
  }
  status(): UsageStatus {
    const rows = this.database
      .prepare(
        `SELECT device,MAX(end) lastEvent,payload FROM usage_events WHERE json_extract(payload,'$.deleted')=0 GROUP BY device`,
      )
      .all();
    return {
      settings: this.settings(),
      capture: '未启用',
      error: '',
      count: Number(
        this.database
          .prepare(
            "SELECT count(*) count FROM usage_events WHERE json_extract(payload,'$.deleted')=0",
          )
          .get()!.count,
      ),
      pending: Number(
        this.database.prepare('SELECT count(*) count FROM usage_events WHERE pending=1').get()!
          .count,
      ),
      lastSync: this.meta('lastSync'),
      devices: rows.map((row) => {
        const event = JSON.parse(String(row.payload)) as UsageEvent;
        return {
          id: String(row.device),
          name: event.deviceName,
          platform: event.platform,
          lastEvent: Number(row.lastEvent),
        };
      }),
    };
  }
  async pending(limit: number) {
    return this.database
      .prepare('SELECT payload FROM usage_events WHERE pending=1 ORDER BY seq LIMIT ?')
      .all(limit)
      .map((row) => JSON.parse(String(row.payload)) as UsageEvent);
  }
  async cursor(hubId: string) {
    return Number(this.meta(`cursor:${hubId}`) ?? 0);
  }
  async receive(hubId: string, value: UsageReply) {
    const reply = usageReplySchema.parse(value);
    this.transaction(() => {
      for (const item of reply.accepted)
        this.database
          .prepare(
            `UPDATE usage_events SET pending=0 WHERE id=? AND json_extract(payload,'$.revision')=?`,
          )
          .run(item.id, item.revision);
      for (const event of reply.events) this.put(event, '@hub', false);
      this.setMeta(`cursor:${hubId}`, reply.cursor);
      this.setMeta('lastSync', Date.now());
    });
  }
  async exchange(owner: string, value: UsageExchange): Promise<UsageReply> {
    const request = usageExchangeSchema.parse(value);
    return this.transaction(() => {
      for (const event of request.events) this.put(event, owner, false);
      const rows = this.database
        .prepare('SELECT seq,payload FROM usage_events WHERE seq>? ORDER BY seq LIMIT ?')
        .all(request.cursor, request.limit + 1);
      const more = rows.length > request.limit;
      rows.length = Math.min(request.limit, rows.length);
      return {
        requestId: request.requestId,
        accepted: request.events.map(({ id, revision }) => ({ id, revision })),
        events: rows.map((row) => JSON.parse(String(row.payload))),
        cursor: rows.length ? Number(rows.at(-1)!.seq) : request.cursor,
        more,
      };
    });
  }
  close() {
    this.database.close();
  }
}
