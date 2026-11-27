// Request/reply over @system.interconnect, relayed by Gadgetbridge to Dayweave on the phone.
// Protocol v1: docs/design/watch.md. Replies carry the hub clock, so times shown here and sent
// with commands follow the phone rather than this watch's own clock.
const interconnect = require('@system.interconnect');
const vibrator = require('@system.vibrator');
import { createWakeGuard } from './wake-guard.js';

const TIMEOUT = 8000;
let conn = null;
let seq = 0;
let offset = 0;
const waiting = {};
const listeners = [];
const wakeGuard = createWakeGuard(
  (options) => vibrator.vibrate(options),
  (body) => open().send({ data: body }),
  () => Date.now(),
  (fn, delay) => setTimeout(fn, delay),
  (timer) => clearTimeout(timer),
);

function open() {
  if (conn) return conn;
  conn = interconnect.instance();
  conn.onmessage = (message) => {
    const raw = message && message.data !== undefined ? message.data : message;
    let reply = null;
    try {
      reply = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (wakeGuard.receive(reply)) return;
    if (!reply || !waiting[reply.re]) return;
    const w = waiting[reply.re];
    delete waiting[reply.re];
    clearTimeout(w.timer);
    if (reply.ok && reply.at) offset = reply.at - Date.now();
    w.resolve(reply);
  };
  return conn;
}

function sendOnce(body) {
  return new Promise((resolve) => {
    const w = { resolve: resolve };
    w.timer = setTimeout(() => {
      delete waiting[body.id];
      resolve({ ok: false, err: 'offline', msg: '手机没有回应' });
    }, TIMEOUT);
    waiting[body.id] = w;
    open().send({
      data: body,
      fail: (data, code) => {
        if (!waiting[body.id]) return;
        delete waiting[body.id];
        clearTimeout(w.timer);
        resolve({
          ok: false,
          err: 'offline',
          msg: code === 1006 ? '未连接 Gadgetbridge' : '发送失败 ' + code,
        });
      },
    });
  });
}

export const channel = {
  now() {
    return Date.now() + offset;
  },
  /** Sends one request; a timed-out command is retried once with the same id (the hub dedupes). */
  request(op, fields) {
    const body = { v: 1, id: 'w' + Date.now().toString(36) + ++seq, op: op };
    for (const key in fields || {}) body[key] = fields[key];
    if (op !== 'view') body.at = this.now();
    return sendOnce(body)
      .then((reply) => (reply.ok || op === 'view' || reply.re ? reply : sendOnce(body)))
      .then((reply) => {
        if (reply.ok) listeners.forEach((fn) => fn(reply));
        return reply;
      });
  },
  /** Called with every fresh view, so another page shows the same state when it returns. */
  onView(fn) {
    listeners.push(fn);
  },
  close() {
    wakeGuard.close();
    for (const id in waiting) clearTimeout(waiting[id].timer);
    conn = null;
  },
};

export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n) => (n < 10 ? '0' : '') + n;
  return h ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s);
}
