/**
 * Runs one goal script module. The page's CSP (inherited by this blob worker) blocks network
 * access; the globals below are removed as well, so a script can only read through `ctx`.
 */
import { setDayStart, setTimeZone } from '../timezone.js';
import type { ScriptParam } from './domain.js';
import type { ScriptPeriod } from './script-api.js';
import { scriptMeta, scriptOutcome, scriptUtil } from './script-util.js';

export type WorkerRequest =
  | { type: 'load'; code: string; zone: string; dayStart: string }
  | { type: 'run'; runId: number; period: ScriptPeriod; params: Record<string, ScriptParam> }
  | { type: 'reply'; callId: number; value?: unknown; error?: string };
export type WorkerResponse =
  | { type: 'loaded'; meta: ReturnType<typeof scriptMeta> }
  | { type: 'failed'; error: string }
  | { type: 'call'; callId: number; runId: number; method: string; args: unknown[] }
  | {
      type: 'result';
      runId: number;
      outcome?: ReturnType<typeof scriptOutcome>;
      error?: string;
      logs: string[];
    };

// Typed locally: the project compiles against the DOM library, not the worker one.
const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
};
const post = scope.postMessage.bind(scope) as (message: WorkerResponse) => void;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (e: Error) => void }
>();
let judge: ((ctx: unknown) => unknown) | undefined;
let nextCall = 0;
let scriptUrl = '';

/** "message (第 12 行)" using the script's own line numbers from the blob URL in the stack. */
function describe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const line =
    scriptUrl &&
    stack.match(new RegExp(`${scriptUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):\\d+`));
  return line ? `${message}（第 ${line[1]} 行）` : message;
}
function call(runId: number, method: string, args: unknown[]) {
  const callId = ++nextCall;
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject });
    post({ type: 'call', callId, runId, method, args: structuredClone(args) });
  });
}
function lockdown() {
  for (const name of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'importScripts',
    'indexedDB',
    'caches',
    'BroadcastChannel',
    'Worker',
    'SharedWorker',
    'postMessage',
  ])
    try {
      Object.defineProperty(scope, name, {
        value: undefined,
        configurable: false,
        writable: false,
      });
    } catch {
      // Not every global exists on every engine.
    }
}
async function load(request: Extract<WorkerRequest, { type: 'load' }>) {
  setTimeZone(request.zone);
  setDayStart(request.dayStart);
  scriptUrl = URL.createObjectURL(new Blob([request.code], { type: 'text/javascript' }));
  lockdown();
  const module = (await import(/* @vite-ignore */ scriptUrl)) as Record<string, unknown>;
  const meta = scriptMeta(module);
  judge = module.default as typeof judge;
  return meta;
}
async function run(request: Extract<WorkerRequest, { type: 'run' }>) {
  const logs: string[] = [];
  const data =
    (method: string) =>
    (...args: unknown[]) =>
      call(request.runId, method, args);
  const ctx = Object.freeze({
    period: request.period,
    params: request.params,
    util: scriptUtil,
    log: (...values: unknown[]) => {
      if (logs.length < 200)
        logs.push(
          values
            .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
            .join(' ')
            .slice(0, 2000),
        );
    },
    records: data('records'),
    activities: data('activities'),
    tasks: data('tasks'),
    slots: data('slots'),
    classes: data('classes'),
    usage: data('usage'),
    goals: data('goals'),
  });
  try {
    post({ type: 'result', runId: request.runId, outcome: scriptOutcome(await judge!(ctx)), logs });
  } catch (error) {
    post({ type: 'result', runId: request.runId, error: describe(error), logs });
  }
}
scope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'reply') {
    const waiting = pending.get(request.callId);
    pending.delete(request.callId);
    if (request.error !== undefined) waiting?.reject(new Error(request.error));
    else waiting?.resolve(request.value);
  } else if (request.type === 'load')
    load(request).then(
      (meta) => post({ type: 'loaded', meta }),
      (error) => post({ type: 'failed', error: describe(error) }),
    );
  else if (request.type === 'run') void run(request);
});
