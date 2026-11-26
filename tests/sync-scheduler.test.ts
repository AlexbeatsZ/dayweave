import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncScheduler } from '../src/sync/scheduler.js';

test('sync scheduling coalesces bursts, retains in-flight edits and stops on background', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  let release!: () => void;
  const scheduler = new SyncScheduler(() => {
    calls++;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const settle = async () => {
    for (let count = 0; count < 10; count++) await Promise.resolve();
  };
  try {
    scheduler.start();
    scheduler.start();
    for (let count = 0; count < 20; count++) scheduler.request();
    context.mock.timers.tick(100);
    await settle();
    assert.equal(calls, 1);
    scheduler.request();
    context.mock.timers.tick(2000);
    await settle();
    assert.equal(calls, 1);
    release();
    await settle();
    context.mock.timers.tick(100);
    await settle();
    assert.equal(calls, 2);
    scheduler.stop();
    release();
    await settle();
    context.mock.timers.tick(10000);
    await settle();
    assert.equal(calls, 2);
    scheduler.start();
    context.mock.timers.tick(100);
    await settle();
    assert.equal(calls, 3);
    release();
    await settle();
  } finally {
    scheduler.stop();
  }
});

test('background polls back off after failures, while local changes still sync at once', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0;
  let ok = false;
  const scheduler = new SyncScheduler(async () => {
    calls++;
    return ok;
  });
  const settle = async () => {
    for (let count = 0; count < 10; count++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    for (let step = 0; step < ms; step += 100) {
      context.mock.timers.tick(100);
      await settle();
    }
  };
  try {
    scheduler.start();
    await advance(100); // t=100: first attempt fails, next poll allowed from t=4100
    assert.equal(calls, 1);
    await advance(5800); // polls at 2000/4000 are skipped
    assert.equal(calls, 1);
    await advance(300); // poll at 6000 runs and fails again: wait until 14100
    assert.equal(calls, 2);
    await advance(3800); // t=10000
    assert.equal(calls, 2);
    scheduler.request(); // a local change is not delayed by the backoff
    await advance(100);
    assert.equal(calls, 3);
    ok = true;
    await advance(18000); // t=28100: backoff (until 26100) expired, poll at 28000 succeeds
    assert.equal(calls, 4);
    await advance(4000); // healthy again: every 2 s
    assert.equal(calls, 6);
  } finally {
    scheduler.stop();
  }
});
