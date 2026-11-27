import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWakeGuard } from '../watch/vela/src/common/wake-guard.js';

function setup() {
  let time = 0;
  const pulses: unknown[] = [];
  const replies: any[] = [];
  const timers = new Map<number, () => void>();
  let seq = 0;
  const guard = createWakeGuard(
    (options: unknown) => pulses.push(options),
    (reply: unknown) => replies.push(reply),
    () => time,
    (fn: () => void) => {
      timers.set(++seq, fn);
      return seq;
    },
    (id: number) => timers.delete(id),
  );
  const send = (op: string, id = 'request-1') =>
    guard.receive({ protocol: 'gadgetbridge.wake_guard.v1', id, op });
  const tick = () => {
    time += 1000;
    const jobs = [...timers.values()];
    timers.clear();
    jobs.forEach((job) => job());
  };
  return { guard, pulses, replies, send, tick };
}

test('vibration requires prepare, executes exactly three local pulses and acknowledges once', () => {
  const t = setup();
  t.send('vibrate');
  assert.equal(t.pulses.length, 0);
  t.send('prepare');
  assert.equal(t.replies[0].op, 'ready');
  t.send('vibrate');
  t.send('vibrate');
  t.tick();
  t.tick();
  assert.deepEqual(t.pulses, [{ mode: 'long' }, { mode: 'long' }, { mode: 'long' }]);
  assert.equal(t.replies.at(-1).op, 'executed');
  t.send('prepare');
  t.send('vibrate');
  t.tick();
  assert.equal(t.pulses.length, 3);
});

test('expired and cancelled handshakes cannot produce deferred vibration', () => {
  const t = setup();
  t.send('prepare');
  t.tick();
  t.tick();
  t.tick();
  t.send('vibrate');
  assert.equal(t.pulses.length, 0);
  t.send('prepare', 'request-2');
  t.send('cancel', 'request-2');
  t.send('vibrate', 'request-2');
  assert.equal(t.pulses.length, 0);
});

test('cancel and close stop future pulses; business messages pass through', () => {
  const t = setup();
  assert.equal(t.guard.receive({ v: 1, re: 'business', ok: true }), false);
  t.send('prepare');
  t.send('vibrate');
  t.send('cancel');
  t.tick();
  assert.equal(t.pulses.length, 1);
  t.send('prepare', 'request-2');
  t.send('vibrate', 'request-2');
  t.guard.close();
  t.tick();
  assert.equal(t.pulses.length, 2);
});
