import { stateWithActivities } from './fixtures/activities';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StateService } from '../electron/state-service';
import { FileStore } from '../electron/storage';
import { WatchHub } from '../electron/watch';
import { newTask, taskCompleted } from '../src/model';
import {
  applyWatchCommand,
  watchView,
  WATCH_COMMAND_MAX_AGE,
  WATCH_MESSAGE_LIMIT,
  WatchError,
} from '../src/watch/protocol';

// 2026-11-25 10:00 in Asia/Shanghai.
const NOON = Date.UTC(2026, 10, 25, 2, 0);
const start = (at: number, extra = {}) =>
  ({ v: 1, id: `c-${at}`, op: 'timer.start', activityId: 'study', at, ...extra }) as const;

function seeded() {
  const state = stateWithActivities();
  state.tasks = [
    newTask('交实验报告', { dates: { '2026-11-25': null } }),
    newTask('明天的事', { dates: { '2026-11-26': null } }),
    newTask('已完成', { dates: { '2026-11-25': null }, completedAt: new Date(NOON).toISOString() }),
  ];
  return state;
}

test('watch view lists today by the profile business day and prefers recent activities', () => {
  const state = seeded();
  state.timelog.records = [
    {
      id: 'r1',
      activityId: 'reading',
      note: '',
      tags: [],
      spans: [{ start: NOON - 7200000, end: NOON - 3600000 }],
      nature: 'positive',
      deletedAt: null,
      updatedAt: NOON,
    } as never,
  ];
  const view = watchView(state, NOON);
  assert.deepEqual(
    view.tasks.map((t) => t.t),
    ['交实验报告'],
  );
  assert.equal(view.acts[0].id, 'reading');
  assert.equal(view.acts.length, 6);
  assert.equal(view.timer, null);
  // 01:00 the next day is still the 25th when the business day starts at 04:00.
  state.settings.dayStartsAt = '04:00';
  assert.deepEqual(
    watchView(state, NOON + 15 * 3600000).tasks.map((t) => t.t),
    ['交实验报告'],
  );
});

test('timer commands use the watch time, clamp the future and stay idempotent', () => {
  let state = applyWatchCommand(seeded(), start(NOON - 60000, { countdownMin: 25 }), NOON);
  const timer = state.timelog.timer!;
  assert.equal(timer.startedAt, NOON - 60000);
  assert.equal(timer.plannedEndAt, NOON - 60000 + 25 * 60000);
  const pause = { v: 1, id: 'p', op: 'timer.pause', timerId: timer.id, at: NOON + 999999 } as const;
  state = applyWatchCommand(state, pause, NOON);
  assert.equal(state.timelog.timer!.runningSince, null);
  assert.equal(watchView(state, NOON).timer!.spansMs, 60000);
  assert.equal(applyWatchCommand(state, pause, NOON + 1000), state);
  state = applyWatchCommand(state, { ...pause, op: 'timer.stop', at: NOON + 5000 }, NOON + 5000);
  assert.equal(state.timelog.timer, null);
  assert.equal(state.timelog.records.at(-1)!.id, timer.id);
});

test('watch commands reject stale timers, edited tasks and week-old queues', () => {
  const state = applyWatchCommand(seeded(), start(NOON), NOON);
  const code = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof WatchError);
      return error.code;
    }
    assert.fail('expected a WatchError');
  };
  assert.equal(
    code(() =>
      applyWatchCommand(
        state,
        { v: 1, id: 'x', op: 'timer.stop', timerId: 'other', at: NOON },
        NOON,
      ),
    ),
    'conflict',
  );
  assert.equal(
    code(() => applyWatchCommand(state, start(NOON), NOON)),
    'conflict',
  );
  assert.equal(
    code(() => applyWatchCommand(seeded(), start(NOON - WATCH_COMMAND_MAX_AGE - 1), NOON)),
    'invalid',
  );
  const task = state.tasks[0];
  const complete = {
    v: 1,
    id: 'c',
    op: 'task.complete',
    taskId: task.id,
    expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    at: NOON,
  } as const;
  assert.equal(
    code(() => applyWatchCommand(state, complete, NOON)),
    'conflict',
  );
  const done = applyWatchCommand(state, { ...complete, expectedUpdatedAt: task.updatedAt }, NOON);
  assert.ok(taskCompleted(done.tasks[0]));
  assert.equal(
    code(() => applyWatchCommand(state, { ...complete, taskId: 'gone' }, NOON)),
    'not_found',
  );
});

test('hub ledger answers a replayed command without applying it twice', async () =>
  fixture(async (service, directory) => {
    await service.restore(seeded());
    const now = Date.now();
    const hub = new WatchHub(service, directory);
    const first = await hub.exchange('phone', start(now - 1000));
    assert.ok(first.ok && first.timer);
    const again = await new WatchHub(service, directory).exchange('phone', start(now - 1000));
    assert.ok(again.ok);
    assert.equal(again.ok && again.timer!.id, first.ok && first.timer!.id);
    // A different command id is a real second start and conflicts with the running timer.
    const second = await hub.exchange('phone', { ...start(now - 500), id: 'c-other' });
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.err, 'conflict');
    const replay = await hub.exchange('phone', { ...start(now - 500), id: 'c-other' });
    assert.deepEqual(replay, second);
    const raced = await Promise.all([
      hub.exchange('tablet', start(now - 200)),
      hub.exchange('tablet', start(now - 200)),
    ]);
    assert.deepEqual(raced[0], raced[1]);
    const invalid = await hub.exchange('phone', { v: 1, id: 'bad', op: 'shell' });
    assert.equal(!invalid.ok && invalid.err, 'invalid');
  }));

test('a full watch reply stays under the S4 message limit', () => {
  const state = seeded();
  state.tasks = Array.from({ length: 40 }, (_, i) =>
    newTask(`${'很长的待办标题'.repeat(10)}${i}`, { dates: { '2026-11-25': null } }),
  );
  const reply = JSON.stringify({
    v: 1,
    re: 'c-1',
    ok: true,
    stale: false,
    ...watchView(state, NOON),
  });
  assert.ok(Buffer.byteLength(reply) < WATCH_MESSAGE_LIMIT, `${Buffer.byteLength(reply)} bytes`);
});

async function fixture(run: (service: StateService, directory: string) => Promise<void>) {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-watch-'));
  const service = new StateService(new FileStore(directory));
  try {
    await run(service, directory);
  } finally {
    service.dispose();
    await service.flush();
    assert.ok(directory.startsWith(root + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
}
