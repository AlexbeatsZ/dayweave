import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, newTask, type AppState } from '../src/model.js';
import { startTimer, finishTimer, toggleTimer } from '../src/timelog/domain.js';
import {
  toDocument,
  fromDocument,
  mergeDocuments,
  overlayNewEdits,
  stable,
} from '../src/sync/document.js';
import { seal, openEnvelope, randomKey, localEndpoint, type Envelope } from '../src/sync/crypto.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';
import { DesktopSync } from '../electron/sync.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';

test('open records round-trip without ticks; closed timing wins over stale pause and note edits', () => {
  const a = emptyState();
  a.timelog = startTimer(a.timelog, 'study', '跨设备', Date.now() - 20000);
  const base = toDocument(a);
  const id = a.timelog.timer!.id;
  assert.equal((base['records/' + id].timing as { endAt: null }).endAt, null);
  assert.deepEqual(fromDocument(base, a).timelog.timer, a.timelog.timer);
  const stopped = structuredClone(a);
  stopped.timelog = finishTimer(stopped.timelog, Date.now() - 2000);
  const stale = structuredClone(a);
  stale.timelog = toggleTimer(stale.timelog, Date.now() - 5000);
  stale.timelog.timer!.note = '手机补充';
  const merged = fromDocument(mergeDocuments(base, toDocument(stale), toDocument(stopped)).doc, a);
  assert.equal(merged.timelog.timer, null);
  assert.equal(merged.timelog.records[0].id, id);
  assert.equal(merged.timelog.records[0].note, '手机补充');
});
test('offline task fields merge independently, same-field conflicts retain both candidates', () => {
  const a = emptyState();
  a.tasks = [newTask('原始')];
  const b = structuredClone(a),
    c = structuredClone(a);
  b.tasks[0].title = '电脑标题';
  c.tasks[0].notes = '手机备注';
  let merged = mergeDocuments(toDocument(a), toDocument(b), toDocument(c));
  assert.equal(merged.conflicts.length, 0);
  const state = fromDocument(merged.doc, a);
  assert.equal(state.tasks[0].title, '电脑标题');
  assert.equal(state.tasks[0].notes, '手机备注');
  c.tasks[0].title = '平板标题';
  merged = mergeDocuments(toDocument(a), toDocument(b), toDocument(c));
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].local, '电脑标题');
  assert.equal(fromDocument(merged.doc, a).tasks[0].title, '平板标题');
});
test('simultaneous offline starts preserve both timer IDs and old schemas still load', () => {
  const a = emptyState(),
    b = structuredClone(a),
    c = structuredClone(a);
  b.timelog = startTimer(b.timelog, 'study', '电脑', Date.now() - 3000);
  c.timelog = startTimer(c.timelog, 'work', '手机', Date.now() - 2000);
  const merged = fromDocument(mergeDocuments(toDocument(a), toDocument(b), toDocument(c)).doc, a);
  assert.equal(
    new Set([merged.timelog.timer!.id, ...merged.timelog.conflictedTimers!.map((t) => t.id)]).size,
    2,
  );
  assert.equal(
    stable(toDocument(fromDocument(toDocument(merged), merged))),
    stable(toDocument(merged)),
  );
});
test('in-flight edits survive, remote deletion is retained with a recoverable candidate', () => {
  const a = emptyState();
  a.tasks = [newTask('原始')];
  const sent = toDocument(a);
  a.tasks[0].notes = '请求期间修改';
  const remote = structuredClone(sent);
  remote['tasks/' + a.tasks[0].id].title = '中心标题';
  const merged = fromDocument(overlayNewEdits(sent, toDocument(a), remote), a);
  assert.equal(merged.tasks[0].notes, '请求期间修改');
  assert.equal(merged.tasks[0].title, '中心标题');
  delete remote['tasks/' + a.tasks[0].id];
  const conflicts: ReturnType<typeof mergeDocuments>['conflicts'] = [];
  assert.equal(
    fromDocument(overlayNewEdits(sent, toDocument(a), remote, conflicts), a).tasks.length,
    0,
  );
  assert.equal(conflicts.length, 1);
});
test('authenticated encryption rejects tampering and response reflection; only private endpoints', async () => {
  const key = randomKey(),
    body = await seal({ task: 'private' }, key, '/sync', 'device');
  assert.deepEqual(await openEnvelope(body, key, '/sync'), { task: 'private' });
  await assert.rejects(() => openEnvelope(body, key, '/sync:reply'));
  const changed = { ...body, data: (body.data[0] === 'A' ? 'B' : 'A') + body.data.slice(1) };
  await assert.rejects(() => openEnvelope(changed, key, '/sync'));
  for (const url of [
    'http://example.com',
    'http://8.8.8.8',
    'http://192.168.1.1/a',
    'http://user@192.168.1.1',
  ])
    assert.throws(() => localEndpoint(url));
  assert.equal(localEndpoint('http://100.106.169.46:49732'), 'http://100.106.169.46:49732');
});
test('real encrypted hub with two clients: pairing, offline merge, cross-device stop, replay, revocation', async () => {
  const temp = path.join(os.tmpdir(), '.agents');
  await mkdir(temp, { recursive: true });
  const directory = await mkdtemp(path.join(temp, 'dayweave-sync-'));
  const service = new StateService(new FileStore(directory));
  const hub = await new DesktopSync(service, directory, false).initialize();
  hub.client.config.hub = { port: 0, clients: {} };
  await hub.enableHub();
  const endpoint = 'http://127.0.0.1:' + hub.client.config.hub.port;
  const memory = (name: string) => {
    let raw: string | null = null;
    let state = emptyState();
    let last: Envelope;
    const client = new SyncClient(
      {
        read: async () => raw,
        write: async (text) => {
          raw = text;
        },
      },
      {
        snapshot: async () => ({ state: structuredClone(state) }),
        mutate: async (fn) => {
          state = fn(state);
        },
      },
      async (address, route, body) => {
        last = body;
        return fetchEnvelope(address, route, body);
      },
      name,
    );
    return {
      client,
      get: () => state,
      set: (s: AppState) => {
        state = s;
      },
      last: () => last,
    };
  };
  const a = memory('电脑'),
    b = memory('手机');
  try {
    await a.client.load();
    await b.client.load();
    await a.client.pair(await hub.invite(), endpoint);
    await a.client.now();
    assert.equal(a.client.connected, true, a.client.error);
    await b.client.pair(await hub.invite(), endpoint);
    await b.client.now();
    assert.equal(b.client.connected, true, b.client.error);
    a.get().tasks.push(newTask('电脑离线'));
    b.get().tasks.push(newTask('手机离线'));
    await a.client.now();
    await b.client.now();
    await a.client.now();
    assert.equal(a.get().tasks.length, 2);
    assert.equal(b.get().tasks.length, 2);
    a.get().tasks[0].notes = '电脑备注';
    b.get().tasks.find((t) => t.id === a.get().tasks[0].id)!.title = '手机改标题';
    await b.client.now();
    await a.client.now();
    await b.client.now();
    assert.equal(b.get().tasks.find((t) => t.notes === '电脑备注')!.title, '手机改标题');
    a.get().timelog = startTimer(a.get().timelog, 'study', '真实同步', Date.now() - 10000);
    await a.client.now();
    await b.client.now();
    const timerId = a.get().timelog.timer!.id;
    assert.equal(b.get().timelog.timer!.id, timerId);
    b.get().timelog = finishTimer(b.get().timelog, Date.now() - 1000);
    await b.client.now();
    a.get().timelog = toggleTimer(a.get().timelog, Date.now() - 2000);
    await a.client.now();
    assert.equal(a.get().timelog.timer, null);
    assert.equal(a.get().timelog.records[0].id, timerId);
    const replay = await fetch(endpoint + '/sync', {
      method: 'POST',
      body: JSON.stringify(a.last()),
    });
    assert.equal(replay.status, 401);
    await hub.revoke(a.client.config.deviceId);
    await a.client.now();
    assert.equal(a.client.connected, false);
  } finally {
    await hub.close();
    await service.flush();
    await rm(directory, { recursive: true, force: true });
  }
});
