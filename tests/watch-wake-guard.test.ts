import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWakeGuard } from '../watch/vela/src/common/wake-guard.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

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

test('actual channel holds business and control replies until interconnect onopen', () => {
  const sent: any[] = [];
  const pulses: any[] = [];
  const conn: any = { send: (message: any) => sent.push(message.data) };
  const exports: any = {};
  const compiled = transformSync(
    readFileSync(new URL('../watch/vela/src/common/channel.js', import.meta.url), 'utf8'),
    {
      format: 'cjs',
      target: 'es2018',
    },
  ).code;
  const context = vm.createContext({
    module: { exports },
    exports,
    require(name: string) {
      if (name === '@system.interconnect') return { instance: () => conn };
      if (name === '@system.vibrator') return { vibrate: (options: any) => pulses.push(options) };
      if (name === './wake-guard.js') return { createWakeGuard };
      throw new Error(name);
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  new vm.Script(compiled).runInContext(context);
  const channel = (context.module as any).exports.channel;
  channel.request('view');
  const prepare = { protocol: 'gadgetbridge.wake_guard.v1', id: 'cold-start', op: 'prepare' };
  conn.onmessage({ data: JSON.stringify(prepare) });
  assert.equal(sent.length, 0);
  conn.onopen();
  assert.equal(sent[0].op, 'view');
  assert.equal(sent[1].op, 'ready');
  conn.onmessage({ data: JSON.stringify({ ...prepare, op: 'vibrate' }) });
  assert.equal(pulses.length, 1);
  channel.close();
});
