import { stateSchema } from '../model.js';
import { syncEndpoint, syncEndpoints, openEnvelope, seal, type Envelope } from './crypto.js';
import {
  fromDocument,
  overlayNewEdits,
  reconcileTimeOverlaps,
  stable,
  toDocument,
  migrateLegacyDocument,
  migrateLegacyConflicts,
} from './document.js';
import { invitationText } from './invitation.js';
import type { SyncConfig, SyncReply, SyncState, SyncStatus, SyncStorage } from './types.js';
import type { CalendarAccountCommand, CalendarAccountReply } from '../calendar-accounts.js';

const SEQUENCE_BLOCK = 1000;
const LAST_SYNC_PERSIST_MS = 10 * 60_000;
export class SyncClient {
  config!: SyncConfig;
  error = '';
  lastSync?: number;
  connected = false;
  private activeEndpoint?: string;
  private through?: string;
  private tail: Promise<unknown> = Promise.resolve();
  private inFlight?: Promise<SyncStatus>;
  /** Last sequence sent. The persisted `config.seq` is a reserved ceiling above it. */
  private sequence = 0;
  get sentSequence() {
    return this.sequence;
  }
  constructor(
    readonly storage: SyncStorage,
    readonly state: SyncState,
    readonly post: (endpoint: string, path: string, body: Envelope) => Promise<Envelope>,
    readonly defaultName: string,
  ) {}
  async load() {
    const raw = await this.storage.read();
    if (raw !== null) {
      const value = JSON.parse(raw) as SyncConfig;
      if (!value.arrangementsVersion) {
        await this.storage.preserve?.(raw, 'sync.before-arrangements.json');
        value.arrangementsVersion = 1;
      }
      if (
        value.version !== 1 ||
        typeof value.deviceId !== 'string' ||
        !Number.isSafeInteger(value.seq) ||
        !Array.isArray(value.conflicts)
      )
        throw new Error('同步配置无法读取，请保留 sync.json 后恢复配对。');
      if (value.endpoints || value.endpoint) {
        value.endpoints = syncEndpoints(value.endpoints ?? [value.endpoint!]);
        value.endpoint = value.endpoints[0];
      }
      if (value.base) {
        const old = value.base,
          migrated = migrateLegacyDocument(old);
        if (stable(old) !== stable(migrated)) {
          await this.storage.preserve?.(raw);
          value.conflicts = migrateLegacyConflicts(old, value.conflicts);
          value.base = migrated;
        }
      }
      if ((value.incoming?.reply.state as { version?: number } | undefined)?.version === 1) {
        await this.storage.preserve?.(raw);
        value.incoming!.sent = migrateLegacyDocument(value.incoming!.sent);
        value.incoming!.reply.state = stateSchema.parse(value.incoming!.reply.state);
        if (value.incoming!.reply.base) {
          value.incoming!.reply.conflicts = migrateLegacyConflicts(
            value.incoming!.reply.base,
            value.incoming!.reply.conflicts ?? [],
          );
          value.incoming!.reply.base = migrateLegacyDocument(value.incoming!.reply.base);
        }
      }
      this.config = value;
      this.sequence = value.seq;
      this.lastSync = value.lastSync;
    } else {
      this.config = {
        version: 1,
        deviceId: crypto.randomUUID(),
        name: this.defaultName,
        enabled: false,
        seq: 0,
        conflicts: [],
      };
      await this.save();
    }
  }
  save() {
    return this.storage.write(JSON.stringify(this.config));
  }
  /**
   * The hub rejects any sequence it has seen. Reserving blocks keeps every sent value below the
   * persisted ceiling across crashes without rewriting the whole configuration for each poll.
   */
  private async nextSequence() {
    if (this.sequence >= this.config.seq) {
      const reserved = this.config.seq;
      this.config.seq = this.sequence + SEQUENCE_BLOCK;
      try {
        await this.save();
      } catch (error) {
        this.config.seq = reserved;
        throw error;
      }
    }
    return ++this.sequence;
  }
  exclusive<T>(run: () => Promise<T>): Promise<T> {
    const task = this.tail.then(run);
    this.tail = task.catch(() => {});
    return task;
  }
  status(): SyncStatus {
    return {
      mode: !this.config?.enabled ? 'off' : this.config.hub ? 'hub' : 'client',
      name: this.config?.name ?? this.defaultName,
      endpoint: this.config?.endpoint,
      endpoints: this.config?.endpoints ?? (this.config?.endpoint ? [this.config.endpoint] : []),
      activeEndpoint: this.activeEndpoint,
      hubId: this.config?.hubId,
      connected: this.connected,
      lastSync: this.lastSync,
      error: this.error,
      conflicts: this.config?.conflicts ?? [],
    };
  }
  async readStatus(): Promise<SyncStatus> {
    const status = this.status();
    if (status.mode === 'off') return { ...status, delivery: 'off' };
    if (status.mode === 'hub') return { ...status, delivery: 'saved' };
    try {
      const document = toDocument((await this.state.snapshot()).state);
      const pendingChanges =
        !!this.config.incoming ||
        !this.config.base ||
        stable(document) !== stable(this.config.base);
      return {
        ...status,
        pendingChanges,
        delivery: status.conflicts.length
          ? 'conflict'
          : this.inFlight
            ? 'syncing'
            : !status.connected
              ? 'offline'
              : pendingChanges
                ? 'pending'
                : 'synced',
      };
    } catch (error) {
      return {
        ...status,
        delivery: 'local-error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  private async applyIncoming() {
    const config = this.config;
    const incoming = config.incoming;
    if (!incoming) return;
    const { sent, reply } = incoming;
    if (!reply.state || !reply.base || reply.hubId !== config.hubId)
      throw new Error('同步恢复日志无效');
    await this.save();
    const conflicts = structuredClone(config.conflicts);
    const authoritative = stateSchema.parse(reply.state);
    const received = toDocument(authoritative);
    await this.state.mutate(
      (current) =>
        reconcileTimeOverlaps(
          overlayNewEdits(sent, toDocument(current), received, conflicts),
          authoritative,
          current,
          conflicts,
        ),
      authoritative.timelog,
    );
    for (const conflict of reply.conflicts ?? [])
      if (!conflicts.some((item) => stable(item) === stable(conflict))) conflicts.push(conflict);
    const previous = { base: config.base, revision: config.revision, conflicts: config.conflicts };
    config.base = reply.base;
    config.revision = reply.revision;
    config.conflicts = conflicts;
    config.incoming = undefined;
    try {
      await this.save();
    } catch (error) {
      Object.assign(config, previous, { incoming });
      throw error;
    }
  }
  pair(invitation: string, endpoint?: string) {
    return this.exclusive(async () => {
      if (this.config.hub) throw new Error('请先关闭本机同步中心。');
      const value = JSON.parse(invitationText(invitation)) as {
        version: number;
        hubId: string;
        key: string;
        expires: number;
        endpoints: string[];
      };
      if (
        value.version !== 1 ||
        typeof value.key !== 'string' ||
        !Array.isArray(value.endpoints) ||
        value.expires < Date.now() ||
        value.key.length !== 43
      )
        throw new Error('配对邀请无效或已过期，请在 ROG 生成新邀请。');
      const candidates = syncEndpoints(endpoint?.trim() || value.endpoints);
      const paired = await this.request(
        '/pair',
        () => seal({ name: this.config.name }, value.key, '/pair', this.config.deviceId),
        async (response) => {
          const reply = await openEnvelope<{ key: string; hubId: string; clientId: string }>(
            response,
            value.key,
            '/pair:reply',
          );
          if (reply.hubId !== value.hubId || reply.clientId !== this.config.deviceId)
            throw new Error('配对中心身份不符');
          return reply;
        },
        candidates,
      );
      this.config = {
        ...this.config,
        enabled: true,
        endpoint: candidates[0],
        endpoints: candidates,
        hubId: paired.hubId,
        key: paired.key,
        seq: 0,
        base: undefined,
        revision: undefined,
        incoming: undefined,
        lastSync: undefined,
      };
      this.sequence = 0;
      await this.save();
      this.error = '';
      this.connected = false;
      return this.status();
    });
  }
  now() {
    this.inFlight ??= this.exchange().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  calendarAccounts(command: CalendarAccountCommand) {
    return this.exclusive(async () => {
      const c = this.config;
      if (!c.enabled || c.hub || !c.key || !c.hubId) throw new Error('请先连接同步中心');
      const requestId = crypto.randomUUID();
      let seq = 0;
      const reply = await this.request(
        '/calendar-accounts',
        async () => {
          seq = await this.nextSequence();
          return seal({ command, requestId, seq }, c.key!, '/calendar-accounts', c.deviceId);
        },
        async (envelope) => {
          const value = await openEnvelope<{
            seq: number;
            hubId: string;
            result?: CalendarAccountReply;
            error?: string;
          }>(envelope, c.key!, '/calendar-accounts:reply');
          if (envelope.clientId !== c.deviceId || value.hubId !== c.hubId || value.seq !== seq)
            throw new Error('日历连接响应身份或序号不符');
          return value;
        },
      );
      if (reply.error) throw new Error(reply.error);
      if (!reply.result) throw new Error('请先升级同步中心以使用账号登录');
      return reply.result;
    });
  }
  async request<T>(
    path: string,
    createBody: () => Promise<Envelope>,
    readReply: (response: Envelope) => Promise<T>,
    endpoints = this.config.endpoints ?? (this.config.endpoint ? [this.config.endpoint] : []),
  ): Promise<T> {
    let lastError: unknown;
    for (const endpoint of endpoints) {
      const body = await createBody();
      try {
        const reply = await readReply(await this.post(endpoint, path, body));
        this.activeEndpoint = endpoint;
        return reply;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error('未填写同步中心地址');
  }
  private exchange() {
    return this.exclusive(async () => {
      const c = this.config;
      if (!c.enabled || c.hub || !c.endpoint || !c.key) return this.status();
      try {
        await this.applyIncoming();
        const snapshot = (await this.state.snapshot()).state;
        const sent = toDocument(snapshot);
        const dirty = !c.base || stable(sent) !== stable(c.base);
        const through = this.through;
        const request = {
          protocol: 3,
          ...(through ? { through } : {}),
          name: c.name,
          revision: c.revision,
          ...(dirty ? { state: snapshot, base: c.base ?? {} } : {}),
        };
        // Capture exactly the state sent, so edits during the request remain pending.
        const document = request.state ? toDocument(request.state) : sent;
        let seq = 0;
        const reply = await this.request(
          '/sync',
          async () => {
            seq = await this.nextSequence();
            return seal({ ...request, seq }, c.key!, '/sync', c.deviceId);
          },
          async (response) => {
            const value = await openEnvelope<SyncReply>(response, c.key!, '/sync:reply');
            if (value.protocol !== 3)
              throw new Error('安排模型版本不兼容，请先升级同步中心与所有客户端');
            if (response.clientId !== c.deviceId || value.hubId !== c.hubId || value.seq !== seq)
              throw new Error('同步响应身份或序号不符');
            return value;
          },
        );
        if (reply.state && reply.base) {
          c.incoming = { sent: document, reply };
          await this.applyIncoming();
        }
        if (this.through === through) this.through = undefined;
        this.lastSync = Date.now();
        // An unchanged poll only refreshes the persisted timestamp occasionally.
        if (
          c.revision !== reply.revision ||
          !c.lastSync ||
          this.lastSync - c.lastSync > LAST_SYNC_PERSIST_MS
        ) {
          c.revision = reply.revision;
          c.lastSync = this.lastSync;
          await this.save();
        }
        this.error = '';
        this.connected = true;
      } catch (error) {
        this.connected = false;
        this.error = error instanceof Error ? error.message : String(error);
      }
      return this.status();
    });
  }
  async ensureTasks(through: string) {
    this.through = !this.through || through > this.through ? through : this.through;
    await this.now();
    if (this.through && this.connected) await this.now();
    return this.status();
  }
  disconnect() {
    return this.exclusive(async () => {
      this.config.enabled = false;
      this.config.hub = undefined;
      this.connected = false;
      this.activeEndpoint = undefined;
      await this.save();
      return this.status();
    });
  }
  setEndpoint(endpoint: string) {
    return this.exclusive(async () => {
      if (!this.config.enabled || this.config.hub || !this.config.key)
        throw new Error('请先配对同步中心');
      const previous = this.config.endpoint;
      const previousEndpoints = this.config.endpoints;
      this.config.endpoints = syncEndpoints(endpoint);
      this.config.endpoint = this.config.endpoints[0];
      try {
        await this.save();
      } catch (error) {
        this.config.endpoint = previous;
        this.config.endpoints = previousEndpoints;
        throw error;
      }
      this.connected = false;
      this.activeEndpoint = undefined;
      this.error = '';
      return this.status();
    });
  }
  resolve(index: number, keepLocal: boolean) {
    return this.exclusive(async () => {
      const conflict = this.config.conflicts[index];
      if (!conflict) throw new Error('冲突已处理');
      if (keepLocal)
        await this.state.mutate((state) => {
          const doc = toDocument(state);
          if (conflict.field === '*') {
            if (conflict.local === null) delete doc[conflict.key];
            else doc[conflict.key] = conflict.local as (typeof doc)[string];
          } else if (doc[conflict.key]) {
            if (conflict.localPresent === false) delete doc[conflict.key][conflict.field];
            else doc[conflict.key][conflict.field] = conflict.local;
          }
          return fromDocument(doc, state);
        });
      this.config.conflicts.splice(index, 1);
      await this.save();
      return this.status();
    });
  }
}

/** The user-facing reason for a failed hub response, shared by every transport. */
export function syncHttpError(status: number, route?: string) {
  if (route === '/calendar-accounts' && (status === 403 || status === 404))
    return '同步中心或网关尚不支持日历账号连接，请先升级。';
  return status === 401
    ? '配对已失效，请重新配对'
    : status === 409
      ? '同步协议版本不兼容，请升级同步中心与所有客户端'
      : `同步中心返回 ${status}`;
}
export async function fetchEnvelope(endpoint: string, path: string, body: Envelope) {
  const response = await fetch(syncEndpoint(endpoint) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(path === '/calendar-accounts' ? 60000 : 12000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(syncHttpError(response.status, path));
  const text = await response.text();
  if (text.length > 70 * 1024 * 1024) throw new Error('同步消息过大');
  return JSON.parse(text) as Envelope;
}
