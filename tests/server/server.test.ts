import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { emptyState, newTask, type AppState } from '../../src/model.js';
import { SyncClient, fetchEnvelope } from '../../src/sync/client.js';
import { randomKey } from '../../src/sync/crypto.js';
import { UsageStore } from '../../electron/usage-store.js';
import { defaultUsageSettings, usageEventSchema } from '../../src/usage/domain.js';
import { syncUsage } from '../../src/usage/sync.js';
import { startHeadless } from '../../electron/headless-runtime.js';
import { FileStore } from '../../electron/storage.js';
import { startApi } from '../../electron/api.js';
import { StateService } from '../../electron/state-service.js';

const exec = promisify(execFile);
const base = path.join(os.tmpdir(), '.agents');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const exists = async (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

async function fixture(run: (root: string, pkg: string) => Promise<void>) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'dayweave-server-'));
  const pkg = path.join(root, 'relocated-package');
  try {
    await cp(path.resolve('release/Dayweave-Server'), pkg, { recursive: true });
    await run(root, pkg);
  } finally {
    assert.ok(root.startsWith(base + path.sep));
    await rm(root, { recursive: true, force: true });
  }
}
async function configFile(root: string, profile: string, patch = {}) {
  const file = path.join(root, 'server.json');
  await writeFile(
    file,
    JSON.stringify({
      profile,
      createProfile: true,
      apiPort: 0,
      discovery: false,
      hub: 'enable',
      initialHubPort: 0,
      ...patch,
    }),
  );
  return file;
}
async function launch(pkg: string, config: string, profile: string) {
  const child = spawn(process.execPath, [path.join(pkg, 'server.mjs'), '--config', config], {
    cwd: path.dirname(profile),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = once(child, 'exit');
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const info = await readJson(path.join(profile, 'api.json'));
      if (info.pid === child.pid) {
        const health = await fetch(info.url + '/health', {
          headers: { Authorization: `Bearer ${info.token}` },
        });
        if (health.ok) return { child, exited, info, output: () => output };
      }
    } catch {}
    await wait(50);
  }
  child.kill();
  await exited;
  throw new Error('Server startup timeout: ' + output);
}
async function request(info: any, method: string, route: string, body?: unknown) {
  const response = await fetch(info.url + route, {
    method,
    headers: {
      Authorization: `Bearer ${info.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.data;
}
async function admin(pkg: string, config: string, ...args: string[]) {
  const result = await exec(
    process.execPath,
    [path.join(pkg, 'admin.mjs'), '--config', config, ...args],
    {
      windowsHide: true,
      timeout: 50000,
    },
  );
  return JSON.parse(result.stdout).data;
}
async function stop(pkg: string, config: string, running: Awaited<ReturnType<typeof launch>>) {
  await admin(pkg, config, 'stop');
  const [code] = await running.exited;
  assert.equal(code, 0, running.output());
}
function memoryClient(name: string) {
  let state = emptyState();
  const client = new SyncClient(
    { read: async () => null, write: async () => {} },
    {
      snapshot: async () => ({ state }),
      mutate: async (fn) => {
        state = fn(state);
      },
    },
    fetchEnvelope,
    name,
  );
  return {
    client,
    get: () => state,
    set: (value: AppState) => {
      state = value;
    },
  };
}

test(
  'relocated unattended bundle preserves legacy identity/backup/settings and exchanges business and usage through restart',
  { timeout: 40000 },
  async () => {
    await fixture(async (root, pkg) => {
      const profile = path.join(root, 'original-profile');
      await mkdir(profile);
      const state = emptyState();
      state.tasks.push(newTask('Legacy task'));
      await writeFile(path.join(profile, 'data.json'), '{broken');
      await writeFile(path.join(profile, 'data.backup.json'), JSON.stringify(state));
      const token = 'a'.repeat(64);
      await writeFile(
        path.join(profile, 'api.json'),
        JSON.stringify({ token, url: 'http://127.0.0.1:1/api/v1', pid: 9999999 }),
      );
      const oldKey = randomKey();
      const conflict = { key: 'tasks/legacy', field: 'title', local: 'Retained candidate' };
      await writeFile(
        path.join(profile, 'sync.json'),
        JSON.stringify({
          version: 1,
          deviceId: 'original-hub',
          name: 'Legacy ROG',
          enabled: true,
          seq: 71,
          conflicts: [conflict],
          hub: { port: 0, clients: { oldPeer: { name: 'Preserved', key: oldKey, seq: 29 } } },
        }),
      );
      const legacyFile = path.join(root, 'legacy.db');
      const legacy = new DatabaseSync(legacyFile);
      legacy.exec(
        'CREATE TABLE events(id TEXT,device_id TEXT,timestamp INTEGER,payload TEXT,synced INTEGER); CREATE TABLE devices(id TEXT,name TEXT,platform TEXT)',
      );
      legacy
        .prepare('INSERT INTO devices VALUES(?,?,?)')
        .run('legacy-device', 'Old Source', 'win32');
      legacy.prepare('INSERT INTO events VALUES(?,?,?,?,0)').run(
        'old-event',
        'legacy-device',
        1000,
        JSON.stringify({
          id: 'old-event',
          device_id: 'legacy-device',
          timestamp: 1000,
          duration: 10,
          app_name: 'Legacy Editor',
          window_title: 'Historical',
        }),
      );
      legacy.close();
      const store = new UsageStore(path.join(profile, 'usage.db'));
      store.configure({ ...defaultUsageSettings(), enabled: true });
      store.setMeta('sources', { 'work-review': legacyFile });
      store.close();
      const config = await configFile(root, './original-profile', {
        createProfile: false,
        hub: 'preserve',
      });
      let running = await launch(pkg, config, profile);
      const a = memoryClient('Client A'),
        b = memoryClient('Client B');
      const first = new UsageStore(':memory:'),
        second = new UsageStore(':memory:');
      try {
        assert.equal(running.info.token, token);
        assert.equal(await exists(path.join(pkg, 'node_modules')), false);
        const status = await admin(pkg, config, 'status');
        assert.equal(status.mode, 'server');
        assert.equal(status.version, '0.1.0');
        assert.equal(status.appVersion, '0.4.10');
        assert.equal(status.sync.hubId, 'original-hub');
        assert.deepEqual(status.sync.conflicts, [conflict]);
        assert.equal(status.recovered, true);
        assert.equal(status.usage.localCapture, false);
        assert.equal(status.usage.settings.enabled, true);
        assert.match(status.usage.capture, /服务器/);
        assert.equal(status.usage.error, '');
        assert.equal(status.usage.count, 1);
        assert.equal(await exists(path.join(profile, 'collector', 'config.json')), false);
        assert.ok((await readdir(profile)).some((file) => file.startsWith('data.corrupt-')));
        assert.equal((await fetch(running.info.url + '/server/status')).status, 401);
        assert.equal(
          (
            await fetch(running.info.url + '/server/shutdown', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, Origin: 'http://example.com' },
            })
          ).status,
          403,
        );
        const owner = await readFile(path.join(profile, 'owner.lock'), 'utf8');
        await assert.rejects(
          exec(process.execPath, [path.join(pkg, 'server.mjs'), '--config', config], {
            windowsHide: true,
            timeout: 5000,
          }),
        );
        assert.equal(await readFile(path.join(profile, 'owner.lock'), 'utf8'), owner);
        const persisted = await readJson(path.join(profile, 'sync.json'));
        assert.deepEqual(persisted.hub.clients.oldPeer, {
          name: 'Preserved',
          key: oldKey,
          seq: 29,
        });
        assert.equal(persisted.seq, 71);
        const endpoint = `http://127.0.0.1:${status.hubPort}`;
        await a.client.load();
        await b.client.load();
        await a.client.pair((await admin(pkg, config, 'invite')).invitation, endpoint);
        await b.client.pair((await admin(pkg, config, 'invite')).invitation, endpoint);
        await a.client.now();
        a.get().tasks.push(newTask('Client offline task'));
        await a.client.now();
        await b.client.now();
        assert.equal(b.get().tasks.length, 2);
        assert.equal(a.client.connected, true, a.client.error);
        const created = await request(running.info, 'POST', '/tasks', { title: 'Local AI task' });
        assert.equal(
          (await request(running.info, 'GET', `/tasks/${created.id}`)).title,
          'Local AI task',
        );
        const timer = await request(running.info, 'POST', '/time-records', {
          startAt: Date.now() - 60000,
          note: 'Server timer',
        });
        await b.client.now();
        assert.equal(b.get().timelog.timer?.id, timer.id);
        const closed = await request(running.info, 'POST', `/time-records/${timer.id}/stop`, {});
        assert.equal(closed.id, timer.id);
        first.import([
          usageEventSchema.parse({
            id: 'remote-observation',
            deviceId: 'phone',
            deviceName: 'Phone',
            source: 'dayweave',
            platform: 'android',
            kind: 'app',
            start: 2000,
            end: 62000,
            app: 'Reader',
            revision: 1,
          }),
        ]);
        await syncUsage(a.client, first);
        await syncUsage(b.client, second);
        assert.equal(second.status().count, 2);
        assert.equal(first.status().pending, 0);
        assert.equal((await admin(pkg, config, 'usage')).count, 2);
        const peerKey = (await readJson(path.join(profile, 'sync.json'))).hub.clients[
          b.client.config.deviceId
        ].key;
        await stop(pkg, config, running);
        assert.equal(await exists(path.join(profile, 'owner.lock')), false);
        const after = new UsageStore(path.join(profile, 'usage.db'));
        assert.equal(after.status().count, 2);
        assert.equal(after.settings().enabled, true);
        after.close();
        running = await launch(pkg, config, profile);
        const restarted = await admin(pkg, config, 'status');
        assert.equal(restarted.tasks, 3);
        assert.equal(restarted.records, 1);
        assert.equal(restarted.sync.hubId, 'original-hub');
        assert.equal(running.info.token, token);
        assert.deepEqual(restarted.sync.conflicts, [conflict]);
        assert.equal(
          (await readJson(path.join(profile, 'sync.json'))).hub.clients[b.client.config.deviceId]
            .key,
          peerKey,
        );
        await b.client.now();
        assert.equal(b.client.connected, true, b.client.error);
        await admin(pkg, config, 'revoke', a.client.config.deviceId);
        await a.client.now();
        assert.equal(a.client.connected, false);
        await assert.rejects(syncUsage(a.client, first));
        assert.equal((await admin(pkg, config, 'usage')).count, 2);
        const external = new DatabaseSync(legacyFile, { readOnly: true });
        assert.equal(external.prepare('SELECT synced FROM events').get()!.synced, 0);
        external.close();
      } finally {
        first.close();
        second.close();
        if (running.child.exitCode === null) await stop(pkg, config, running);
      }
    });
  },
);

test(
  'server deadline completion and abrupt-exit WAL/profile recovery keep the same records',
  { timeout: 20000 },
  async () => {
    await fixture(async (root, pkg) => {
      const profile = path.join(root, 'profile');
      const config = await configFile(root, profile);
      let running = await launch(pkg, config, profile);
      try {
        const endAt = Date.now() + 600;
        const timer = await request(running.info, 'POST', '/time-records', {
          startAt: Date.now() - 60000,
          endAt,
          note: 'Due timer',
        });
        await wait(750);
        const records = await request(running.info, 'GET', '/time-records');
        assert.equal(records[0].id, timer.id);
        assert.equal(records[0].endAt, endAt);
        await request(running.info, 'POST', '/tasks', { title: 'Durable before crash' });
        const peer = memoryClient('Crash recovery client');
        const observations = new UsageStore(':memory:');
        await peer.client.load();
        const status = await admin(pkg, config, 'status');
        await peer.client.pair(
          (await admin(pkg, config, 'invite')).invitation,
          `http://127.0.0.1:${status.hubPort}`,
        );
        await peer.client.now();
        observations.import([
          usageEventSchema.parse({
            id: 'wal-observation',
            deviceId: 'remote',
            deviceName: 'Remote',
            source: 'dayweave',
            platform: 'android',
            kind: 'app',
            start: 2000,
            end: 62000,
            app: 'Reader',
            revision: 1,
          }),
        ]);
        await syncUsage(peer.client, observations);
        observations.close();
        assert.ok((await stat(path.join(profile, 'usage.db-wal'))).size > 0);
        running.child.kill('SIGKILL');
        await running.exited;
        assert.equal(await exists(path.join(profile, 'owner.lock')), true);
        running = await launch(pkg, config, profile);
        assert.equal((await admin(pkg, config, 'status')).tasks, 1);
        assert.equal((await admin(pkg, config, 'usage')).count, 1);
        await peer.client.now();
        assert.equal(peer.client.connected, true, peer.client.error);
        assert.equal((await request(running.info, 'GET', '/time-records'))[0].id, timer.id);
      } finally {
        if (running.child.exitCode === null) await stop(pkg, config, running);
      }
    });
  },
);

test(
  'shutdown drains accepted writes and queued sync work before releasing the profile',
  { timeout: 10000 },
  async () => {
    await fixture(async (root) => {
      const profile = path.join(root, 'profile');
      const runtime = await startHeadless({
        directory: profile,
        discovery: false,
        apiPort: 0,
        server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
      });
      let releaseWrite!: () => void, saveStarted!: () => void, releaseSync!: () => void;
      const entered = new Promise<void>((resolve) => {
        saveStarted = resolve;
      });
      const blocker = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      const original = runtime.service.storage.save.bind(runtime.service.storage);
      runtime.service.storage.save = async (state) => {
        saveStarted();
        await blocker;
        return original(state);
      };
      const writing = request(runtime.api.info, 'POST', '/tasks', {
        title: 'Accepted before stop',
      });
      await entered;
      const queued = runtime.sync.client.exclusive(
        () =>
          new Promise<void>((resolve) => {
            releaseSync = resolve;
          }),
      );
      let closed = false;
      const closing = runtime.close().then(() => {
        closed = true;
      });
      try {
        await wait(20);
        assert.equal(closed, false);
        assert.equal(await exists(path.join(profile, 'owner.lock')), true);
        releaseWrite();
        await writing;
        await wait(20);
        assert.equal(closed, false);
        releaseSync();
        await queued;
        await closing;
        assert.equal(await exists(path.join(profile, 'owner.lock')), false);
        assert.equal(
          (await readJson(path.join(profile, 'data.json'))).tasks[0].title,
          'Accepted before stop',
        );
      } finally {
        releaseWrite();
        releaseSync();
        await runtime.close();
      }
    });
  },
);

test(
  'server capture policy still imports AW and exchanges usage when another legacy source fails',
  { timeout: 10000 },
  async () => {
    await fixture(async (root) => {
      const hub = await startHeadless({
        directory: path.join(root, 'hub'),
        discovery: false,
        enableHub: true,
        initialHubPort: 0,
        apiPort: 0,
        server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
      });
      const client = await startHeadless({
        directory: path.join(root, 'client'),
        discovery: false,
        apiPort: 0,
        server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
      });
      try {
        await client.sync.pair(
          await hub.sync.invite(),
          `http://127.0.0.1:${hub.sync.client.config.hub!.port}`,
        );
        const aw = path.join(root, 'aw');
        await mkdir(aw);
        await writeFile(
          path.join(aw, 'batch.json'),
          JSON.stringify({
            device_id: 'old-phone',
            bucket: {
              id: 'aw-watcher-android',
              created: '2026-10-01T00:00:00Z',
              hostname: 'Phone',
            },
            events: [
              {
                id: 1,
                timestamp: '2026-10-27T00:00:00Z',
                duration: 5,
                data: { app: 'Reader' },
              },
            ],
          }),
        );
        const invalid = path.join(root, 'invalid.db');
        await writeFile(invalid, 'broken source database');
        client.usage.store.setMeta('sources', { 'work-review': invalid, activitywatch: aw });
        await assert.rejects(client.usage.sync());
        const health = await client.usage.health();
        assert.equal(health.localCapture, false);
        assert.ok(health.error);
        assert.ok(health.sources.find((source) => source.kind === 'work-review')!.error);
        assert.equal(hub.usage.store.status().count, 1, JSON.stringify(health));
        assert.equal(client.usage.store.status().pending, 0);
      } finally {
        await client.close();
        await hub.close();
      }
    });
  },
);

test(
  'startup failures release locks, refuse empty migration and preserve desktop API behavior',
  { timeout: 15000 },
  async () => {
    await fixture(async (root, pkg) => {
      const missing = path.join(root, 'mistyped-profile');
      const config = await configFile(root, missing, { createProfile: false });
      await assert.rejects(
        exec(process.execPath, [path.join(pkg, 'server.mjs'), '--config', config]),
      );
      assert.equal(await exists(missing), false);
      const profile = path.join(root, 'desktop');
      const service = new StateService(new FileStore(profile));
      const api = await startApi(service, 0);
      try {
        const health = await request(api.info, 'GET', '/health');
        assert.equal(health.version, '0.4.10');
        assert.equal(health.mode, undefined);
        assert.equal(
          (
            await fetch(api.info.url + '/server/shutdown', {
              method: 'POST',
              headers: { Authorization: `Bearer ${api.info.token}` },
            })
          ).status,
          404,
        );
        const failProfile = path.join(root, 'failed-startup');
        await assert.rejects(
          startHeadless({
            directory: failProfile,
            discovery: false,
            apiPort: Number(new URL(api.info.url).port),
            server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
          }),
        );
        assert.equal(await exists(path.join(failProfile, 'owner.lock')), false);
        const runtime = await startHeadless({
          directory: failProfile,
          discovery: false,
          apiPort: 0,
          server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
        });
        await runtime.close();
        const legacyLock = JSON.stringify({ pid: process.pid, nonce: 'older-desktop' });
        await writeFile(path.join(failProfile, 'owner.lock'), legacyLock);
        await assert.rejects(
          startHeadless({
            directory: failProfile,
            discovery: false,
            apiPort: 0,
            server: { version: '0.1.0', appVersion: '0.4.10', sourceCommit: 'test' },
          }),
        );
        assert.equal(await readFile(path.join(failProfile, 'owner.lock'), 'utf8'), legacyLock);
        await rm(path.join(failProfile, 'owner.lock'));
        const legacyRuntime = await startHeadless({
          directory: failProfile,
          discovery: false,
          apiPort: 0,
        });
        assert.equal(legacyRuntime.usage.localCapture, true);
        await legacyRuntime.close();
      } finally {
        await api.close();
        service.dispose();
        await service.flush();
      }
    });
  },
);

test(
  'offline update backs up the complete stopped profile and prepares one current program without activation',
  { timeout: 15000 },
  async () => {
    await fixture(async (root, pkg) => {
      const profile = path.join(root, 'profile');
      const config = await configFile(root, profile);
      const running = await launch(pkg, config, profile);
      await request(running.info, 'POST', '/tasks', { title: 'Backup fixture' });
      await configFile(root, profile, { createProfile: false });
      const current = path.join(root, 'current');
      const recovery = path.join(root, 'recovery');
      await mkdir(current);
      await writeFile(path.join(current, 'old.txt'), 'previous program');
      try {
        await assert.rejects(
          exec(process.execPath, [
            path.join(pkg, 'stage-update.mjs'),
            '--package',
            pkg,
            '--current',
            current,
            '--config',
            config,
            '--recovery',
            recovery,
          ]),
        );
        assert.equal(await exists(recovery), false);
      } finally {
        await stop(pkg, config, running);
      }
      await configFile(root, profile, { createProfile: false });
      const data = await readFile(path.join(profile, 'sync.json'), 'utf8');
      const result = await exec(process.execPath, [
        path.join(pkg, 'stage-update.mjs'),
        '--package',
        pkg,
        '--current',
        current,
        '--config',
        config,
        '--recovery',
        recovery,
      ]);
      assert.equal(JSON.parse(result.stdout).activated, false);
      assert.equal(await readFile(path.join(recovery, 'profile', 'sync.json'), 'utf8'), data);
      assert.equal(await readFile(path.join(profile, 'sync.json'), 'utf8'), data);
      assert.equal(
        await readFile(path.join(recovery, 'program', 'old.txt'), 'utf8'),
        'previous program',
      );
      assert.equal(await exists(path.join(current, 'runtime.mjs')), true);
      assert.equal(await exists(path.join(profile, 'owner.lock')), false);
    });
  },
);
