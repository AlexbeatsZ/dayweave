import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { UsageStore } from '../electron/usage-store.js';
import { DesktopUsage } from '../electron/usage.js';
import { parseUsageImport } from '../src/usage/import.js';
import { usageSummary, usageEventSchema, type UsageEvent } from '../src/usage/domain.js';
import { usageReplySchema, syncUsage } from '../src/usage/sync.js';
import { DesktopSync } from '../electron/sync.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import { emptyState } from '../src/model.js';

const event = (patch: Partial<UsageEvent> = {}): UsageEvent =>
  usageEventSchema.parse({
    id: 'event-1',
    deviceId: 'desktop',
    deviceName: 'OMEN',
    source: 'work-review',
    platform: 'win32',
    kind: 'app',
    start: 1000,
    end: 61000,
    app: 'Editor',
    revision: 1,
    ...patch,
  });

test('usage totals distinguish union, device cumulative time, websites and unlock instants', () => {
  const result = usageSummary(
    [
      event(),
      event({ id: 'phone', deviceId: 'phone', start: 31000, end: 91000 }),
      event({ id: 'duplicate-observation', start: 11000, end: 21000 }),
      event({ id: 'web', kind: 'web', url: 'https://example.com/read', start: 31000, end: 51000 }),
      event({ id: 'unlock', kind: 'unlock', start: 1000, end: 1000 }),
      event({ id: 'outside', kind: 'unlock', start: 0, end: 0 }),
    ],
    { start: 1000, end: 91000 },
  );
  assert.equal(result.active, 90000);
  assert.equal(result.deviceTime, 120000);
  assert.equal(result.apps[0].duration, 120000);
  assert.equal(result.websites[0].duration, 20000);
  assert.equal(result.unlocks, 1);
});
test('AW batch and merged exports preserve identity, zero-duration unlocks and corrected duration', () => {
  const batch = {
    device_id: 'k70',
    bucket: { id: 'aw-watcher-android', created: '2026-10-01T00:00:00Z', hostname: 'K70' },
    events: [{ id: 1, timestamp: '2026-10-27T00:00:00Z', duration: 5.5, data: { app: 'Via' } }],
  };
  const old = parseUsageImport(batch, 1)[0],
    corrected = parseUsageImport({ ...batch, events: [{ ...batch.events[0], duration: 7 }] }, 2)[0];
  assert.equal(old.id, corrected.id);
  assert.equal(corrected.end - corrected.start, 7000);
  const recreated = parseUsageImport(
    { ...batch, bucket: { ...batch.bucket, created: '2026-10-02T00:00:00Z' } },
    3,
  )[0];
  assert.notEqual(old.id, recreated.id);
  assert.throws(() => parseUsageImport({ events: [] }));
});
test('SQLite imports are atomic, revision-aware and idempotent after restart', () => {
  const store = new UsageStore(':memory:');
  try {
    assert.equal(store.import([event()]), 1);
    assert.equal(store.import([event({ revision: 2 })]), 0);
    assert.equal(store.import([event({ end: 71000, revision: 3 })]), 1);
    assert.equal(store.import([event({ end: 91000, revision: 1 })]), 0);
    assert.throws(() => store.import([event({ id: 'new' }), { ...event(), start: -1 }]));
    assert.equal(store.status().count, 1);
    assert.equal(store.query({ start: 0, end: 100000 }).events[0].end, 71000);
  } finally {
    store.close();
  }
});
test('hub increments delivery cursor for revisions and protects source ownership', async () => {
  const store = new UsageStore(':memory:');
  try {
    const first = await store.exchange('peer-a', {
      requestId: crypto.randomUUID(),
      events: [event()],
      cursor: 0,
      limit: 1,
    });
    assert.equal(first.events.length, 1);
    const corrected = await store.exchange('peer-a', {
      requestId: crypto.randomUUID(),
      events: [event({ end: 91000, revision: 2 })],
      cursor: first.cursor,
      limit: 1,
    });
    assert.ok(corrected.cursor > first.cursor);
    assert.equal(corrected.events[0].end, 91000);
    await assert.rejects(
      store.exchange('peer-b', {
        requestId: crypto.randomUUID(),
        events: [event({ end: 101000, revision: 3 })],
        cursor: 0,
        limit: 1,
      }),
    );
    assert.equal(store.query({ start: 0, end: 200000 }).events[0].end, 91000);
  } finally {
    store.close();
  }
});
test('duplicate historical imports tolerate device display aliases but cannot change observations', async () => {
  const store = new UsageStore(':memory:');
  try {
    store.import([event({ source: 'work-review', deviceName: 'OMEN', platform: 'windows' })]);
    const duplicate = event({
      source: 'work-review',
      deviceName: 'Meta-OMEN',
      platform: 'win32',
      revision: 2,
    });
    const reply = await store.exchange('peer-a', {
      requestId: crypto.randomUUID(),
      events: [duplicate],
      cursor: 0,
      limit: 10,
    });
    assert.deepEqual(reply.accepted, [{ id: duplicate.id, revision: 2 }]);
    assert.equal(store.status().count, 1);
    assert.equal(reply.events[0].deviceName, 'OMEN');
    await assert.rejects(
      store.exchange('peer-a', {
        requestId: crypto.randomUUID(),
        events: [{ ...duplicate, end: duplicate.end + 1 }],
        cursor: 0,
        limit: 10,
      }),
    );
    await assert.rejects(
      store.exchange('peer-a', {
        requestId: crypto.randomUUID(),
        events: [{ ...duplicate, title: 'different observation' }],
        cursor: 0,
        limit: 10,
      }),
    );
    assert.equal(store.status().count, 1);
  } finally {
    store.close();
  }
});
test('stale acknowledgement never marks a newer local correction delivered', async () => {
  const store = new UsageStore(':memory:');
  try {
    store.import([event({ end: 91000, revision: 2 })]);
    await store.receive('hub', {
      requestId: crypto.randomUUID(),
      accepted: [{ id: 'event-1', revision: 1 }],
      events: [],
      cursor: 3,
      more: false,
    });
    assert.equal((await store.pending(100)).length, 1);
    assert.equal(await store.cursor('hub'), 3);
    assert.throws(() => usageReplySchema.parse({ cursor: -1 }));
  } finally {
    store.close();
  }
});
test('paired encrypted usage sync distributes all devices without modifying manual state', async () => {
  await mkdir(path.join(os.tmpdir(), '.agents'), { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), '.agents/dayweave-usage-'));
  const service = new StateService(new FileStore(directory));
  const hub = new DesktopSync(service, directory, false),
    server = new UsageStore(path.join(directory, 'usage.db'));
  const first = new UsageStore(':memory:'),
    second = new UsageStore(':memory:');
  try {
    await hub.initialize();
    hub.client.config.hub = { port: 0, clients: {} };
    await hub.enableHub();
    hub.usage = server;
    const address = (
      hub as unknown as { server: { address(): { port: number } } }
    ).server.address();
    const makeClient = async (name: string) => {
      let state = emptyState();
      const client = new SyncClient(
        { read: async () => null, write: async () => {} },
        {
          snapshot: async () => ({ state }),
          mutate: async (transform) => {
            state = transform(state);
          },
        },
        fetchEnvelope,
        name,
      );
      await client.load();
      await client.pair(await hub.invite(), `http://127.0.0.1:${address.port}`);
      return client;
    };
    const clientA = await makeClient('OMEN'),
      clientB = await makeClient('K70');
    first.import([event()]);
    second.import([event({ id: 'phone-record', deviceId: 'phone', app: 'Via' })]);
    await syncUsage(clientA, first);
    await syncUsage(clientB, second);
    await syncUsage(clientA, first);
    assert.equal(first.status().count, 2);
    assert.equal(second.status().count, 2);
    assert.equal(first.status().pending, 0);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.state.timelog.records.length, 0);
  } finally {
    await hub.close();
    server.close();
    first.close();
    second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('global desktop sync exchanges local observations and refreshes application choices', async () => {
  await mkdir(path.join(os.tmpdir(), '.agents'), { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), '.agents/dayweave-global-usage-'));
  const hubDirectory = path.join(directory, 'hub');
  const hub = new DesktopSync(new StateService(new FileStore(hubDirectory)), hubDirectory, false);
  const central = new UsageStore(':memory:');
  const local = new UsageStore(':memory:');
  try {
    await hub.initialize();
    hub.client.config.hub = { port: 0, clients: {} };
    await hub.enableHub();
    hub.usage = central;
    const address = (
      hub as unknown as { server: { address(): { port: number } } }
    ).server.address();
    const clientDirectory = path.join(directory, 'client');
    const client = new DesktopSync(
      new StateService(new FileStore(clientDirectory)),
      clientDirectory,
      false,
    );
    await client.client.load();
    await client.client.pair(await hub.invite(), `http://127.0.0.1:${address.port}`);
    const usage = new DesktopUsage(local, client, clientDirectory, 'missing');
    local.import([event()]);
    central.import([event({ id: 'remote-event', deviceId: 'other', app: 'Remote editor' })]);
    await client.now();
    assert.equal(central.status().count, 2);
    assert.equal(local.status().count, 2);
    assert.equal(local.status().pending, 0);
    assert.deepEqual(await usage.applications(), [
      { id: 'Editor', name: 'Editor' },
      { id: 'Remote editor', name: 'Remote editor' },
    ]);
    assert.equal((await client.service.snapshot()).state.timelog.records.length, 0);
  } finally {
    await hub.close();
    central.close();
    local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Work Review source is read-only, imports late historical rows and survives source vacuum', async () => {
  await mkdir(path.join(os.tmpdir(), '.agents'), { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), '.agents/dayweave-source-'));
  const source = new DatabaseSync(path.join(directory, 'legacy.db'));
  source.exec(
    'CREATE TABLE events(id TEXT, device_id TEXT, timestamp INTEGER, payload TEXT, synced INTEGER); CREATE TABLE devices(id TEXT,name TEXT,platform TEXT)',
  );
  source.prepare('INSERT INTO devices VALUES(?,?,?)').run('old-device', 'Old desktop', 'win32');
  const statement = source.prepare('INSERT INTO events VALUES(?,?,?,?,0)');
  const insert = (id: string, timestamp: number) =>
    statement.run(
      id,
      'old-device',
      timestamp,
      JSON.stringify({
        id,
        device_id: 'old-device',
        timestamp,
        duration: 10,
        app_name: 'Editor',
        window_title: '',
      }),
    );
  insert('recent', 1000);
  const sync = await new DesktopSync(
    new StateService(new FileStore(directory)),
    directory,
    false,
  ).initialize();
  const store = new UsageStore(path.join(directory, 'usage.db'));
  const usage = new DesktopUsage(store, sync, directory, 'missing');
  try {
    await usage.connectSource('work-review', path.join(directory, 'legacy.db'));
    assert.equal(store.status().count, 1);
    insert('late-old-record', 10);
    source.exec('VACUUM');
    await usage.sync();
    await usage.sync();
    assert.equal(store.status().count, 2);
    assert.equal(source.prepare('SELECT SUM(synced) total FROM events').get()!.total, 0);
    assert.equal(store.query({ start: 0, end: 2000000 }).events[0].deviceName, 'Old desktop');
  } finally {
    await sync.close();
    await usage.close();
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop browser URLs contribute to websites without inflating app or device totals', () => {
  const summary = usageSummary(
    [
      event({ url: 'https://example.com/read' }),
      event({ id: 'web-layer', kind: 'web', url: 'https://example.com/read' }),
    ],
    { start: 0, end: 100000 },
  );
  assert.equal(summary.websites[0].duration, 60000);
  assert.equal(summary.active, 60000);
  assert.equal(summary.deviceTime, 60000);
});
