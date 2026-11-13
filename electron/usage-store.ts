import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldToIO } from 'node:timers/promises';
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
  private readingStatus?: Promise<UsageStatus>;
  constructor(readonly file: string) {
    this.database = new DatabaseSync(file);
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS usage_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, device TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, payload TEXT NOT NULL, owner TEXT NOT NULL, pending INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_time ON usage_events(start,end);
      CREATE INDEX IF NOT EXISTS usage_pending ON usage_events(pending,seq);
      CREATE TABLE IF NOT EXISTS usage_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // A column mirrors payload.deleted (as on Android), so status and queries use an index
    // instead of parsing every JSON payload.
    const columns = this.database.prepare('PRAGMA table_info(usage_events)').all();
    if (!columns.some((column) => column.name === 'deleted'))
      this.transaction(() =>
        this.database.exec(`ALTER TABLE usage_events ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
          UPDATE usage_events SET deleted=1 WHERE json_extract(payload,'$.deleted')=1;`),
      );
    this.database.exec('CREATE INDEX IF NOT EXISTS usage_live ON usage_events(deleted,device,end)');
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
      const same = (Object.keys(old) as (keyof UsageEvent)[]).every(
        (key) => ['revision', 'deviceName', 'platform'].includes(key) || old[key] === event[key],
      );
      if (same) return false;
      // Another device owns this observation. Keep its copy and continue the batch: failing
      // here would roll back every other row and block the same pending batch forever.
      if (existing.owner !== owner && owner !== '@hub') return false;
      if (old.revision >= event.revision) return false;
    }
    this.database
      .prepare(
        'INSERT OR REPLACE INTO usage_events(id,device,start,end,payload,owner,pending,deleted) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        event.id,
        event.deviceId,
        event.start,
        event.end,
        JSON.stringify(event),
        owner,
        pending ? 1 : 0,
        event.deleted ? 1 : 0,
      );
    return true;
  }
  import(value: UsageEvent[], owner = '@local') {
    const events = usageEventSchema.array().max(100000).parse(value);
    return this.transaction(() =>
      events.reduce((count, event) => count + Number(this.put(event, owner, true)), 0),
    );
  }
  importMissing(value: UsageEvent[]) {
    const events = usageEventSchema.array().max(500).parse(value);
    if (!events.length) return;
    const exists = this.database.prepare('SELECT 1 FROM usage_events WHERE id=?');
    const insert = this.database.prepare(
      "INSERT INTO usage_events(id,device,start,end,payload,owner,pending,deleted) VALUES(?,?,?,?,?,'@local',1,?)",
    );
    this.transaction(() => {
      for (const event of events)
        if (!exists.get(event.id))
          insert.run(
            event.id,
            event.deviceId,
            event.start,
            event.end,
            JSON.stringify(event),
            event.deleted ? 1 : 0,
          );
    });
  }
  /**
   * Pages newest-first by start time, the order the time index serves. `next` is the start of
   * the last page row; every row sharing that start is returned on the same page, so revised
   * rows (which receive a new seq for replication) can neither be skipped nor repeated.
   */
  query(value: UsageQuery) {
    const query = usageQuerySchema.parse(value),
      limit = query.limit ?? 500;
    const filter = `start<? AND end>=? AND (?='' OR device=?)
      AND (?='' OR instr(lower(coalesce(json_extract(payload,'$.app'),'')||' '||coalesce(json_extract(payload,'$.title'),'')||' '||coalesce(json_extract(payload,'$.url'),'')),lower(?))>0)
      AND deleted=0`;
    const parameters = [
      query.end,
      query.start,
      query.deviceId ?? '',
      query.deviceId ?? '',
      query.search ?? '',
      query.search ?? '',
    ];
    const rows = this.database
      .prepare(
        `SELECT start,payload FROM usage_events WHERE ${filter} AND start<? ORDER BY start DESC,id LIMIT ?`,
      )
      .all(...parameters, query.before ?? Number.MAX_SAFE_INTEGER, limit + 1);
    if (rows.length <= limit)
      return {
        events: rows.map((row) => JSON.parse(String(row.payload)) as UsageEvent),
        next: undefined,
        complete: true,
      };
    const boundary = Number(rows[limit - 1].start);
    const ties = this.database
      .prepare(`SELECT payload FROM usage_events WHERE ${filter} AND start=? ORDER BY id`)
      .all(...parameters, boundary);
    return {
      events: [...rows.filter((row) => Number(row.start) > boundary), ...ties].map(
        (row) => JSON.parse(String(row.payload)) as UsageEvent,
      ),
      next: boundary,
      complete: false,
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
        `SELECT e.device,m.lastEvent,e.payload FROM usage_events e
          JOIN (SELECT device,MAX(end) lastEvent FROM usage_events WHERE deleted=0 GROUP BY device) m
          ON e.device=m.device AND e.end=m.lastEvent AND e.deleted=0 GROUP BY e.device`,
      )
      .all();
    return {
      settings: this.settings(),
      capture: '未启用',
      error: '',
      count: Number(
        this.database.prepare('SELECT count(*) count FROM usage_events WHERE deleted=0').get()!
          .count,
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
  async statusAsync(cancelled: () => boolean): Promise<UsageStatus> {
    if (this.file === ':memory:') return this.status();
    this.readingStatus ??= (async () => {
      // A separate read-only connection holds a consistent WAL snapshot while
      // the existing owner continues accepting writes between bounded pages.
      const reader = new DatabaseSync(this.file, { readOnly: true });
      try {
        reader.exec('BEGIN');
        const page = reader.prepare(
          'SELECT seq,payload,pending FROM usage_events WHERE seq>? ORDER BY seq LIMIT 256',
        );
        let cursor = 0,
          count = 0,
          pending = 0;
        const devices = new Map<string, UsageStatus['devices'][number]>();
        for (;;) {
          if (cancelled()) throw new Error('Usage status cancelled during shutdown');
          const rows = page.all(cursor);
          if (!rows.length) break;
          for (const row of rows) {
            pending += Number(row.pending) === 1 ? 1 : 0;
            const event = JSON.parse(String(row.payload)) as UsageEvent;
            if (event.deleted === false) {
              count++;
              const previous = devices.get(event.deviceId);
              if (!previous || event.end > previous.lastEvent)
                devices.set(event.deviceId, {
                  id: event.deviceId,
                  name: event.deviceName,
                  platform: event.platform,
                  lastEvent: event.end,
                });
            }
          }
          cursor = Number(rows.at(-1)!.seq);
          await yieldToIO();
        }
        return {
          settings: this.settings(),
          capture: '未启用',
          error: '',
          count,
          pending,
          lastSync: this.meta('lastSync'),
          devices: [...devices.values()].sort((a, b) => a.id.localeCompare(b.id)),
        };
      } finally {
        reader.close();
      }
    })().finally(() => {
      this.readingStatus = undefined;
    });
    return this.readingStatus;
  }
  async pending(limit: number) {
    return this.database
      .prepare('SELECT payload FROM usage_events WHERE pending=1 ORDER BY seq LIMIT ?')
      .all(limit)
      .map((row) => JSON.parse(String(row.payload)) as UsageEvent);
  }
  async drainReads() {
    await this.readingStatus?.catch(() => {});
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
