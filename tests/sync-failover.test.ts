import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, newTask } from '../src/model.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import { syncEndpoints, openEnvelope, seal, randomKey } from '../src/sync/crypto.js';
import { toDocument } from '../src/sync/document.js';
import type { SyncConfig, SyncRequest } from '../src/sync/types.js';
import { syncUsage, type UsageExchange } from '../src/usage/sync.js';
import { DesktopSync } from '../electron/sync.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';

const addresses = ['https://first.example.com/dayweave', 'http://192.168.31.32:49732'];

async function fixture(post: SyncClient['post']) {
  let state = emptyState();
  state.tasks.push(newTask('Offline task'));
  const config: SyncConfig = {
    version: 1,
    deviceId: 'device',
    name: 'Test',
    enabled: true,
    endpoint: addresses[0],
    endpoints: [...addresses],
    hubId: 'hub',
    key: randomKey(),
    seq: 0,
    base: toDocument(emptyState()),
    conflicts: [],
  };
  let disk = JSON.stringify(config);
  let failSave = false;
  const client = new SyncClient(
    {
      read: async () => disk,
      write: async (value) => {
        if (failSave) throw new Error('disk full');
        disk = value;
      },
    },
    {
      snapshot: async () => ({ state: structuredClone(state) }),
      mutate: async (transform) => {
        state = transform(state);
      },
    },
    post,
    'Test',
  );
  await client.load();
  return {
    client,
    failSave: () => {
      failSave = true;
    },
    disk: () => JSON.parse(disk) as SyncConfig,
  };
}

test('address lists preserve explicit order, normalize bare IPs and reject every unsafe entry', () => {
  assert.deepEqual(
    syncEndpoints(
      'https://first.example.com/dayweave/\n192.168.31.32\n100.106.169.46:49732\nhttps://first.example.com/dayweave',
    ),
    [addresses[0], addresses[1], 'http://100.106.169.46:49732'],
  );
  assert.throws(() => syncEndpoints(''));
  assert.throws(() => syncEndpoints([]));
  assert.throws(() => syncEndpoints(Array(17).fill(addresses[0])));
  assert.throws(() => syncEndpoints([addresses[0], 'http://8.8.8.8']));
});

test('each exchange starts at the first configured address without promoting a fallback', async () => {
  const calls: string[] = [];
  let firstAvailable = false;
  const { client, disk } = await fixture(async (endpoint, route, body) => {
    calls.push(endpoint);
    if (endpoint === addresses[0] && !firstAvailable) throw new Error('unreachable');
    const request = await openEnvelope<SyncRequest>(body, client.config.key!, route);
    return seal(
      { seq: request.seq, hubId: 'hub', revision: 'r1' },
      client.config.key!,
      '/sync:reply',
      'device',
    );
  });
  await client.now();
  assert.deepEqual(calls, addresses);
  assert.equal(client.status().activeEndpoint, addresses[1]);
  assert.equal(client.config.endpoint, addresses[0]);
  assert.deepEqual(disk().endpoints, addresses);
  firstAvailable = true;
  calls.length = 0;
  await client.now();
  assert.deepEqual(calls, [addresses[0]]);
  assert.equal(client.status().activeEndpoint, addresses[0]);
});

test('lost accepted replies use a fresh persistent sequence on the next address of the same real hub', async () => {
  await mkdir(path.join(os.tmpdir(), '.agents'), { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), '.agents/dayweave-failover-'));
  const service = new StateService(new FileStore(directory));
  const hub = new DesktopSync(service, directory, false);
  try {
    await hub.client.load();
    hub.client.config.hub = { port: 0, clients: {} };
    await hub.enableHub();
    const port = (hub as unknown as { server: { address(): { port: number } } }).server.address()
      .port;
    const actual = `http://127.0.0.1:${port}`;
    let state = emptyState();
    state.tasks.push(newTask('Upload once'));
    let raw: string | null = null;
    const sequences: number[] = [];
    let loseReply = true;
    const client = new SyncClient(
      {
        read: async () => raw,
        write: async (value) => {
          raw = value;
        },
      },
      {
        snapshot: async () => ({ state }),
        mutate: async (transform) => {
          state = transform(state);
        },
      },
      async (endpoint, route, body) => {
        if (route === '/pair' && endpoint === addresses[0]) throw new Error('unreachable');
        if (route === '/sync')
          sequences.push((await openEnvelope<SyncRequest>(body, client.config.key!, route)).seq);
        const reply = await fetchEnvelope(actual, route, body);
        if (route === '/sync' && loseReply) {
          loseReply = false;
          throw new Error('reply lost');
        }
        return reply;
      },
      'Client',
    );
    await client.load();
    await client.pair(await hub.invite(), addresses.join('\n'));
    assert.deepEqual(client.config.endpoints, addresses);
    await client.now();
    assert.deepEqual(sequences, [1, 2]);
    assert.equal(client.connected, true);
    assert.equal(
      (await service.snapshot()).state.tasks.filter((task) => task.title === 'Upload once').length,
      1,
    );
    assert.equal((await client.readStatus()).pendingChanges, false);
    assert.equal((JSON.parse(raw!) as SyncConfig).seq, 2);
  } finally {
    await hub.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('all-address failure preserves pairing, baseline, order and pending data', async () => {
  const calls: string[] = [];
  const { client } = await fixture(async (endpoint) => {
    calls.push(endpoint);
    throw new Error('offline');
  });
  const before = structuredClone(client.config);
  await client.now();
  assert.deepEqual(calls, addresses);
  assert.equal(client.connected, false);
  assert.equal(client.config.key, before.key);
  assert.equal(client.config.hubId, before.hubId);
  assert.deepEqual(client.config.base, before.base);
  assert.deepEqual(client.config.endpoints, addresses);
  assert.equal((await client.readStatus()).pendingChanges, true);
});

test('configuration or sequence persistence failure never sends or falls through to another address', async () => {
  let calls = 0;
  const { client, failSave } = await fixture(async () => {
    calls++;
    throw new Error('unexpected network');
  });
  const before = structuredClone(client.config);
  failSave();
  await assert.rejects(client.setEndpoint([...addresses].reverse().join('\n')), /disk full/);
  assert.deepEqual(client.config.endpoints, before.endpoints);
  assert.equal(client.config.endpoint, before.endpoint);
  await client.now();
  assert.equal(calls, 0);
});

test('automatic observations follow the same order and restart with the first address on every exchange', async () => {
  const calls: string[] = [];
  let receives = 0;
  const { client } = await fixture(async (endpoint, route, body) => {
    calls.push(endpoint);
    if (endpoint === addresses[0]) throw new Error('unreachable');
    const request = await openEnvelope<UsageExchange>(body, client.config.key!, route);
    return seal(
      { requestId: request.requestId, accepted: [], events: [], cursor: 0, more: false },
      client.config.key!,
      '/usage:reply',
      'device',
    );
  });
  const replica = {
    pending: async () => [],
    cursor: async () => 0,
    receive: async () => {
      receives++;
    },
    exchange: async () => {
      throw new Error('Not a hub');
    },
  };
  await syncUsage(client, replica);
  await syncUsage(client, replica);
  assert.deepEqual(calls, [...addresses, ...addresses]);
  assert.equal(receives, 2);
});
