import { localEndpoint, openEnvelope, seal, type Envelope } from './crypto.js';
import { fromDocument, overlayNewEdits, stable, toDocument } from './document.js';
import type { Peer, SyncConfig, SyncReply, SyncState, SyncStatus, SyncStorage } from './types.js';

export class SyncClient {
  config!: SyncConfig;
  error = '';
  lastSync?: number;
  connected = false;
  private lastDiscovery = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly storage: SyncStorage,
    readonly state: SyncState,
    readonly post: (endpoint: string, path: string, body: Envelope) => Promise<Envelope>,
    readonly defaultName: string,
    readonly discover?: () => Promise<Peer[]>,
  ) {}
  async load() {
    const raw = await this.storage.read();
    if (raw !== null) {
      const value = JSON.parse(raw) as SyncConfig;
      if (
        value.version !== 1 ||
        typeof value.deviceId !== 'string' ||
        !Number.isSafeInteger(value.seq) ||
        !Array.isArray(value.conflicts)
      )
        throw new Error('同步配置无法读取，请保留 sync.json 后恢复配对。');
      if (value.endpoint) localEndpoint(value.endpoint);
      this.config = value;
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
      hubId: this.config?.hubId,
      connected: this.connected,
      lastSync: this.lastSync,
      error: this.error,
      conflicts: this.config?.conflicts ?? [],
    };
  }
  pair(invitation: string, endpoint?: string) {
    return this.exclusive(async () => {
      if (this.config.hub) throw new Error('请先关闭本机同步中心。');
      const value = JSON.parse(invitation.trim()) as {
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
      const candidates = endpoint?.trim() ? [endpoint.trim()] : value.endpoints.slice(0, 16);
      let address = '',
        response: Envelope | undefined,
        lastError: unknown;
      const envelope = await seal(
        { name: this.config.name },
        value.key,
        '/pair',
        this.config.deviceId,
      );
      for (const candidate of candidates) {
        try {
          address = localEndpoint(candidate);
          response = await this.post(address, '/pair', envelope);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!response) throw lastError ?? new Error('未找到可用的中心地址');
      const paired = await openEnvelope<{ key: string; hubId: string; clientId: string }>(
        response,
        value.key,
        '/pair:reply',
      );
      if (paired.hubId !== value.hubId || paired.clientId !== this.config.deviceId)
        throw new Error('配对中心身份不符');
      this.config = {
        ...this.config,
        enabled: true,
        endpoint: address,
        hubId: paired.hubId,
        key: paired.key,
        seq: 0,
        base: undefined,
        revision: undefined,
      };
      await this.save();
      this.error = '';
      this.connected = false;
      return this.status();
    });
  }
  async now() {
    return this.exclusive(async () => {
      const c = this.config;
      if (!c.enabled || c.hub || !c.endpoint || !c.key) return this.status();
      try {
        const sent = toDocument((await this.state.snapshot()).state);
        const dirty = !c.base || stable(sent) !== stable(c.base);
        c.seq++;
        await this.save();
        const request = {
          seq: c.seq,
          revision: c.revision,
          ...(dirty ? { state: (await this.state.snapshot()).state, base: c.base ?? {} } : {}),
        };
        // Capture exactly the state sent, so edits during the request remain pending.
        const document = request.state ? toDocument(request.state) : sent;
        const response = await this.post(
          c.endpoint,
          '/sync',
          await seal(request, c.key, '/sync', c.deviceId),
        );
        const reply = await openEnvelope<SyncReply>(response, c.key, '/sync:reply');
        if (reply.hubId !== c.hubId || reply.seq !== c.seq)
          throw new Error('同步响应身份或序号不符');
        if (reply.state && reply.base) {
          const received = toDocument(reply.state);
          await this.state.mutate((current) =>
            fromDocument(
              overlayNewEdits(document, toDocument(current), received, c.conflicts),
              current,
            ),
          );
          c.base = reply.base;
          for (const conflict of reply.conflicts ?? [])
            if (!c.conflicts.some((x) => stable(x) === stable(conflict)))
              c.conflicts.push(conflict);
        }
        c.revision = reply.revision;
        await this.save();
        this.error = '';
        this.connected = true;
        this.lastSync = Date.now();
      } catch (error) {
        this.connected = false;
        this.error = error instanceof Error ? error.message : String(error);
        if (this.discover && Date.now() - this.lastDiscovery > 30000) {
          this.lastDiscovery = Date.now();
          try {
            const peer = (await this.discover()).find((peer) => peer.hubId === c.hubId);
            if (peer && peer.endpoint !== c.endpoint) {
              c.endpoint = localEndpoint(peer.endpoint);
              await this.save();
            }
          } catch {
            /* Keep the original network error and retry later. */
          }
        }
      }
      return this.status();
    });
  }
  disconnect() {
    return this.exclusive(async () => {
      this.config.enabled = false;
      this.config.hub = undefined;
      this.connected = false;
      await this.save();
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

export async function fetchEnvelope(endpoint: string, path: string, body: Envelope) {
  const response = await fetch(localEndpoint(endpoint) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 ? '配对已失效，请重新配对' : `同步中心返回 ${response.status}`,
    );
  const text = await response.text();
  if (text.length > 70 * 1024 * 1024) throw new Error('同步消息过大');
  return JSON.parse(text) as Envelope;
}
