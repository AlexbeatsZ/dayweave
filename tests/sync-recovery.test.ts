import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, newTask } from '../src/model.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import { toDocument } from '../src/sync/document.js';
import { openEnvelope, randomKey, seal, syncEndpoint } from '../src/sync/crypto.js';
import type { SyncConfig, SyncRequest } from '../src/sync/types.js';

test('HTTPS transport preserves prefix and refuses redirects without changing encrypted payload', async (context) => {
  const body = await import('../src/sync/crypto.js').then(({ seal }) =>
    seal({ seq: 1 }, randomKey(), '/sync', 'device'),
  );
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://sync.example.com/dayweave/sync');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, JSON.stringify(body));
    assert.ok(options.signal);
    return new Response(JSON.stringify(body));
  });
  assert.deepEqual(await fetchEnvelope('https://sync.example.com/dayweave/', '/sync', body), body);
});

test('public transport requires HTTPS, preserves route prefixes, and rejects unsafe addresses', () => {
  assert.equal(
    syncEndpoint('https://sync.example.com:63573/dayweave/'),
    'https://sync.example.com:63573/dayweave',
  );
  assert.equal(syncEndpoint('http://192.168.31.32:49732'), 'http://192.168.31.32:49732');
  for (const value of [
    'http://8.8.8.8',
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/?token=secret',
    'https://example.com/#x',
    'https://example.com/a/../b',
    'https://example.com/%2fprivate',
    'https://example.com/?',
    'https://example.com:99999',
  ])
    assert.throws(() => syncEndpoint(value));
});

test('journal replays after process death without losing local edits', async () => {
  const sent = emptyState();
  sent.tasks.push(newTask('Sent task'));
  const received = structuredClone(sent);
  received.tasks[0].title = 'Hub choice';
  const later = newTask('Later offline edit');
  let state = structuredClone(sent);
  state.tasks.push(later);
  const config: SyncConfig = {
    version: 1,
    deviceId: 'device',
    name: 'Test',
    enabled: true,
    seq: 7,
    endpoint: 'https://sync.example.com/dayweave',
    hubId: 'hub',
    key: randomKey(),
    base: toDocument(emptyState()),
    incoming: {
      sent: toDocument(sent),
      reply: {
        seq: 7,
        hubId: 'hub',
        revision: 'hub:2',
        state: received,
        base: toDocument(received),
      },
    },
  };
  let disk = JSON.stringify(config);
  let failCommit = true;
  const create = () =>
    new SyncClient(
      {
        read: async () => disk,
        write: async (text) => {
          if (failCommit && !JSON.parse(text).incoming) throw new Error('config disk full');
          disk = text;
        },
      },
      {
        snapshot: async () => ({ state: structuredClone(state) }),
        mutate: async (transform) => {
          state = transform(state);
        },
      },
      async () => {
        throw new Error('offline');
      },
      'Test',
    );
  const first = create();
  await first.load();
  await first.now();
  assert.equal(state.tasks[0].title, 'Hub choice');
  assert.ok(JSON.parse(disk).incoming);
  failCommit = false;
  const restarted = create();
  await restarted.load();
  await restarted.now();
  assert.equal(state.tasks[0].title, 'Hub choice');
  assert.ok(state.tasks.some((task) => task.id === later.id));
  assert.equal(restarted.config.incoming, undefined);
  assert.equal(restarted.config.endpoint, config.endpoint);
  assert.equal((await restarted.readStatus()).delivery, 'offline');
  const oldIdentity = restarted.config.deviceId;
  const oldKey = restarted.config.key;
  const oldBase = restarted.config.base;
  await restarted.setEndpoint('https://other.example.com/dayweave');
  assert.equal(restarted.config.deviceId, oldIdentity);
  assert.equal(restarted.config.key, oldKey);
  assert.equal(restarted.config.base, oldBase);
});

test('idle polls leave the configuration untouched and sequences stay ahead after restart', async () => {
  const key = randomKey();
  let raw = JSON.stringify({
    version: 1,
    arrangementsVersion: 1,
    deviceId: 'device',
    name: 'Test',
    enabled: true,
    seq: 41,
    endpoint: 'https://sync.example.com/dayweave',
    hubId: 'hub',
    key,
    revision: 'hub:1',
    lastSync: Date.now(),
  } satisfies SyncConfig);
  let writes = 0;
  const sent: number[] = [];
  const client = () =>
    new SyncClient(
      {
        read: async () => raw,
        write: async (value) => {
          raw = value;
          writes++;
        },
      },
      { snapshot: async () => ({ state: emptyState() }), mutate: async () => {} },
      async (_endpoint, _route, body) => {
        const request = await openEnvelope<SyncRequest>(body, key, '/sync');
        sent.push(request.seq);
        return seal(
          { protocol: 3, seq: request.seq, hubId: 'hub', revision: 'hub:1' },
          key,
          '/sync:reply',
          'device',
        );
      },
      'Test',
    );
  const first = client();
  await first.load();
  for (let index = 0; index < 5; index++) await first.now();
  assert.equal(first.connected, true, first.error);
  const afterPolls = writes;
  for (let index = 0; index < 5; index++) await first.now();
  assert.equal(writes, afterPolls, 'unchanged polls must not rewrite sync.json');
  // A crash loses the in-memory counter; the reserved ceiling still exceeds every sent value.
  const restarted = client();
  await restarted.load();
  await restarted.now();
  assert.equal(restarted.connected, true, restarted.error);
  assert.ok(sent.at(-1)! > Math.max(...sent.slice(0, -1)));
  assert.ok((JSON.parse(raw) as SyncConfig).seq >= sent.at(-1)!);
});

test('an unusable journal is preserved and dropped instead of blocking every later exchange', async () => {
  const state = emptyState();
  state.tasks.push(newTask('Local edit'));
  const key = randomKey();
  const broken = {
    version: 1,
    arrangementsVersion: 1,
    deviceId: 'device',
    name: 'Test',
    enabled: true,
    seq: 3,
    endpoint: 'https://sync.example.com/dayweave',
    hubId: 'hub',
    key,
    base: toDocument(emptyState()),
    // Left by an older release: reply from another hub, plus a retired conflict list.
    conflicts: [{ key: 'tasks/x', field: '*', local: null, remote: null, reason: 'old' }],
    incoming: {
      sent: toDocument(state),
      reply: { seq: 3, hubId: 'other-hub', revision: 'hub:9', state, base: toDocument(state) },
    },
  };
  let disk = JSON.stringify(broken);
  const preserved = new Map<string, string>();
  let posts = 0;
  const client = new SyncClient(
    {
      read: async () => disk,
      write: async (text) => {
        disk = text;
      },
      preserve: async (text, name) => {
        preserved.set(name!, text);
      },
    },
    {
      snapshot: async () => ({ state: structuredClone(state) }),
      mutate: async () => {},
    },
    async (_endpoint, path, body) => {
      posts++;
      const request = await openEnvelope<SyncRequest>(body, key, path);
      assert.ok(request.state, 'local edits are uploaded against the unchanged base');
      return seal(
        { protocol: 3, seq: request.seq, hubId: 'hub', revision: 'hub:10' },
        key,
        path + ':reply',
        'device',
      );
    },
    'Test',
  );
  await client.load();
  assert.equal('conflicts' in client.config, false);
  const status = await client.now();
  assert.equal(status.error, '');
  assert.equal(posts, 1);
  assert.equal(JSON.parse(disk).incoming, undefined);
  assert.ok(preserved.get('sync.incoming-failed.json')?.includes('other-hub'));
});

test('several endpoints report each failure so the first route is diagnosable', async () => {
  const client = new SyncClient(
    { read: async () => null, write: async () => {} },
    { snapshot: async () => ({ state: emptyState() }), mutate: async () => {} },
    async (endpoint) => {
      throw new Error(endpoint.includes('100.') ? 'timeout' : '同步中心返回 401');
    },
    'Test',
  );
  await client.load();
  await assert.rejects(
    client.request(
      '/sync',
      async () => ({ clientId: 'd', iv: '', data: '' }),
      async (x) => x,
      ['http://100.106.169.46:49732', 'https://sync.example.com/dayweave'],
    ),
    /100\.106\.169\.46:49732：timeout；sync\.example\.com：同步中心返回 401/,
  );
});
