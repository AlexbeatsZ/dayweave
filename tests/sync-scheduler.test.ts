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
