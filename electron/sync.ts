import { createServer, type Server } from 'node:http';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Bonjour from 'bonjour-service';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import { SyncScheduler } from '../src/sync/scheduler.js';
import { localEndpoint, openEnvelope, randomKey, seal, type Envelope } from '../src/sync/crypto.js';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document.js';
import { stateSchema } from '../src/model.js';
import type { Peer, SyncBridge, SyncRequest, SyncStatus } from '../src/sync/types.js';
import type { StateService } from './state-service.js';
import type { UsageReplica, UsageExchange } from '../src/usage/sync.js';

export function syncFiles(directory: string) {
  const file = path.join(directory, 'sync.json');
  return {
    async read() {
      try {
        return await readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(content: string) {
      await mkdir(directory, { recursive: true });
      const handle = await open(file + '.tmp', 'w', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(file + '.tmp', file);
    },
  };
}
export function lanAddresses(port: number) {
  const addresses: { address: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const entry of list ?? [])
      if (entry.family === 'IPv4' && !entry.internal) {
        try {
          addresses.push({
            address: localEndpoint(`http://${entry.address}:${port}`),
            score: /wlan|wi-?fi|wireless|^en0$/i.test(name)
              ? 0
              : entry.address.startsWith('100.')
                ? 20
                : entry.address.startsWith('169.254.')
                  ? 30
                  : 10,
          });
        } catch {
          /* Public interfaces are not advertised. */
        }
      }
  return addresses.sort((a, b) => a.score - b.score).map((item) => item.address);
}

export class DesktopSync implements SyncBridge {
  usage?: UsageReplica;
  refreshUsage?: () => Promise<void>;
  readonly client: SyncClient;
  private server?: Server;
  private publisher?: Bonjour;
  private readonly scheduler: SyncScheduler;
  private unsubscribe?: () => void;
  constructor(
    readonly service: StateService,
    readonly directory: string,
    readonly discovery = true,
  ) {
    this.client = new SyncClient(syncFiles(directory), service, fetchEnvelope, os.hostname());
    this.scheduler = new SyncScheduler(() => this.client.now());
  }
  async initialize() {
    await this.client.load();
    if (this.client.config.enabled && this.client.config.hub) await this.listen();
    this.unsubscribe = this.service.subscribe(() => this.scheduler.request());
    this.scheduler.start();
    return this;
  }
  async status(): Promise<SyncStatus> {
    const c = this.client.config;
    return {
      ...(await this.client.readStatus()),
      ...(c.hub
        ? {
            connected: !!this.server,
            hubId: c.deviceId,
            addresses: lanAddresses(c.hub.port),
            peers: Object.entries(c.hub.clients).map(([id, peer]) => ({ id, name: peer.name })),
          }
        : {}),
    };
  }
  async enableHub(initialPort = 49732) {
    await this.client.exclusive(async () => {
      const c = this.client.config;
      if (c.enabled && c.endpoint && !c.hub) throw new Error('请先断开其他同步中心。');
      c.enabled = true;
      c.hub ??= { port: initialPort, clients: {} };
      await this.client.save();
      if (!this.server) await this.listen();
    });
    return this.status();
  }
  async invite() {
    return this.client.exclusive(async () => {
      const c = this.client.config;
      if (!c.enabled || !c.hub || !this.server) throw new Error('请先开启同步中心。');
      c.hub.invite = { key: randomKey(), expires: Date.now() + 5 * 60000 };
      await this.client.save();
      return JSON.stringify({
        version: 1,
        hubId: c.deviceId,
        ...c.hub.invite,
        endpoints: lanAddresses(c.hub.port),
      });
    });
  }
  async revoke(id: string) {
    await this.client.exclusive(async () => {
      if (this.client.config.hub) delete this.client.config.hub.clients[id];
      await this.client.save();
    });
    return this.status();
  }
  async pair(invite: string, endpoint?: string) {
    await this.client.pair(invite, endpoint);
    await this.client.now();
    return this.status();
  }
  async now() {
    await Promise.all([this.client.now(), this.refreshUsage?.()]);
    return this.status();
  }
  async setEndpoint(endpoint: string) {
    await this.client.setEndpoint(endpoint);
    return this.now();
  }
  async resolve(index: number, keepLocal: boolean) {
    await this.client.resolve(index, keepLocal);
    return this.status();
  }
  async disconnect() {
    await this.stopServer();
    await this.client.disconnect();
    return this.status();
  }
  async discover(): Promise<Peer[]> {
    const bonjour = new Bonjour();
    const found = new Map<string, Peer>();
    const browser = bonjour.find({ type: 'dayweave' }, (service) => {
      for (const address of service.addresses ?? [])
        try {
          const endpoint = localEndpoint(`http://${address}:${service.port}`);
          const hubId = String(service.txt?.id ?? '');
          if (hubId && hubId !== this.client.config.deviceId)
            found.set(endpoint, { name: service.name, endpoint, hubId });
        } catch {
          /* Ignore non-LAN addresses. */
        }
    });
    return new Promise((resolve) =>
      setTimeout(() => {
        browser.stop();
        bonjour.destroy();
        resolve([...found.values()]);
      }, 3000),
    );
  }
  private async listen() {
    const c = this.client.config;
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (
        request.method !== 'POST' ||
        !['/pair', '/sync', '/usage'].includes(request.url ?? '') ||
        request.headers.origin
      ) {
        response.writeHead(403).end();
        request.resume();
        return;
      }
      const route = request.url!;
      let bytes = 0;
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 70 * 1024 * 1024) request.destroy();
        else chunks.push(chunk);
      });
      request.on('end', () => {
        void this.client.exclusive(async () => {
          let failureStatus = 401;
          try {
            const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Envelope;
            if (!/^[\w-]{1,100}$/.test(envelope.clientId)) throw new Error('身份无效');
            const hub = c.hub;
            if (!c.enabled || !hub) throw new Error('中心已关闭');
            let result: Envelope;
            if (route === '/pair') {
              const invitation = hub.invite;
              if (!invitation || invitation.expires < Date.now()) throw new Error('邀请已过期');
              const value = await openEnvelope<{ name: string }>(envelope, invitation.key, route);
              if (typeof value.name !== 'string' || value.name.length > 100)
                throw new Error('设备名称无效');
              failureStatus = 500;
              const key = randomKey();
              hub.clients[envelope.clientId] = { name: value.name, key, seq: 0 };
              hub.invite = undefined;
              await this.client.save();
              result = await seal(
                { key, hubId: c.deviceId, clientId: envelope.clientId },
                invitation.key,
                route + ':reply',
                envelope.clientId,
              );
            } else {
              const peer = hub.clients[envelope.clientId];
              if (!peer) throw new Error('设备未配对');
              if (route === '/usage') {
                if (!this.usage) throw new Error('自动记录存储尚未就绪');
                const request = await openEnvelope<UsageExchange>(envelope, peer.key, route);
                failureStatus = 500;
                const reply = await this.usage.exchange(envelope.clientId, request);
                result = await seal(reply, peer.key, route + ':reply', envelope.clientId);
                response
                  .writeHead(200, { 'Content-Type': 'application/json' })
                  .end(JSON.stringify(result));
                return;
              }
              const value = await openEnvelope<SyncRequest>(envelope, peer.key, route);
              if (!Number.isSafeInteger(value.seq) || value.seq <= peer.seq)
                throw new Error('拒绝重放消息');
              failureStatus = 500;
              peer.seq = value.seq;
              if (typeof value.name === 'string' && value.name.length <= 100)
                peer.name = value.name;
              await this.client.save();
              let conflicts: ReturnType<typeof mergeDocuments>['conflicts'] = [];
              const snapshot = value.state
                ? await this.service.mutate((current) => {
                    const incoming = toDocument(stateSchema.parse(value.state));
                    const base = value.base ?? {};
                    if (!base || typeof base !== 'object' || Array.isArray(base))
                      throw new Error('基础文档无效');
                    for (const key of Object.keys(base))
                      if (
                        !/^(tasks|lists|sessions|activities|goals|rewards|redemptions|courses|events|records)\/[^/]+$|^(schedule|preferences|focus)$/.test(
                          key,
                        )
                      )
                        throw new Error('基础文档字段无效');
                    const merged = mergeDocuments(base, incoming, toDocument(current));
                    conflicts = merged.conflicts;
                    return fromDocument(merged.doc, current);
                  })
                : await this.service.snapshot();
              const changed = !!value.state || snapshot.revision !== value.revision;
              result = await seal(
                {
                  seq: value.seq,
                  hubId: c.deviceId,
                  revision: snapshot.revision,
                  ...(changed
                    ? { state: snapshot.state, base: toDocument(snapshot.state), conflicts }
                    : {}),
                },
                peer.key,
                route + ':reply',
                envelope.clientId,
              );
            }
            response
              .writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify(result));
          } catch {
            response.writeHead(failureStatus).end();
          }
        });
      });
    });
    server.requestTimeout = 20000;
    server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(c.hub!.port, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    c.hub!.port = (server.address() as { port: number }).port;
    if (this.discovery) {
      const address = lanAddresses(c.hub!.port)[0];
      const iface = address ? new URL(address).hostname : undefined;
      this.publisher = new Bonjour(
        iface
          ? ({ bind: '0.0.0.0', interface: iface } as ConstructorParameters<typeof Bonjour>[0])
          : undefined,
        (error: Error) => {
          this.client.error = `局域网发现不可用：${error.message}，可使用手动地址。`;
        },
      );
      this.publisher.publish({
        name: `时织 · ${c.name}`,
        type: 'dayweave',
        disableIPv6: true,
        port: c.hub!.port,
        txt: { id: c.deviceId, version: '1' },
      });
    }
  }
  private async stopServer() {
    this.publisher?.destroy();
    this.publisher = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  async close() {
    this.scheduler.stop();
    this.unsubscribe?.();
    await this.stopServer();
    // Includes queued authenticated requests and an exchange already started by the scheduler.
    await this.client.exclusive(async () => {});
  }
}
