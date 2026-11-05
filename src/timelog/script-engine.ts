/**
 * Runs goal scripts inside QuickJS compiled to WebAssembly. The same engine serves the hub
 * (which computes and distributes every result) and the editor's local test run, so a
 * script behaves identically in both. The guest has no host access except `__host`, a
 * synchronous JSON bridge to the data methods and helpers listed in docs/goal-scripts.md.
 */
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import type { ScriptOutcome, ScriptParam } from './domain.js';
import type { ScriptPeriod } from './script-api.js';
import { scriptMeta, scriptOutcome, scriptUtil, type ScriptMeta } from './script-util.js';

/** Answers `ctx.<method>(query)`; throws to reject the call inside the script. */
export type ScriptHost = (method: string, query: unknown) => unknown;
export type ScriptRun = { outcome?: ScriptOutcome; error?: string; logs: string[] };
export const RUN_TIMEOUT_MS = 5000;
const MEMORY_LIMIT = 64 * 1024 * 1024;
export const DATA_METHODS = [
  'records',
  'usage',
  'tasks',
  'slots',
  'classes',
  'activities',
  'goals',
] as const;

let engine: Promise<QuickJSWASMModule> | undefined;
/** Monotonic, so a changed or frozen wall clock cannot stop or extend the limit. */
const deadline = () => {
  const end = performance.now() + RUN_TIMEOUT_MS;
  return () => performance.now() > end;
};
const quickjs = () => (engine ??= newQuickJSWASMModuleFromVariant(variant));

// Guest-side wiring. `__host` is captured and removed before the user module is evaluated.
const PRELUDE = `
const host = globalThis.__host;
delete globalThis.__host;
const call = (name, args) => {
  const reply = JSON.parse(host(name, JSON.stringify(args)));
  if ('error' in reply) throw new Error(reply.error);
  return reply.value;
};
const util = Object.freeze(Object.fromEntries(
  ${JSON.stringify(Object.keys(scriptUtil))}.map((name) => [name, (...args) => call('util.' + name, args)]),
));
globalThis.__run = (period, params) => {
  const logs = [];
  const ctx = Object.freeze({
    period: Object.freeze(JSON.parse(period)),
    params: Object.freeze(JSON.parse(params)),
    util,
    log: (...values) => {
      if (logs.length < 200)
        logs.push(values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ').slice(0, 2000));
    },
    ...Object.fromEntries(${JSON.stringify(DATA_METHODS)}.map((name) => [
      name,
      (query) => { try { return Promise.resolve(call(name, query ?? {})); } catch (e) { return Promise.reject(e); } },
    ])),
  });
  globalThis.__logs = logs;
  return Promise.resolve().then(() => globalThis.__module.default(ctx)).then((value) => JSON.stringify(value === undefined ? null : value));
};
`;

function message(vm: QuickJSContext, handle: QuickJSHandle) {
  const error = vm.dump(handle) as { name?: string; message?: string; stack?: string } | string;
  if (typeof error !== 'object' || !error) return String(error);
  if (error.message === 'interrupted') return `运行超过 ${RUN_TIMEOUT_MS / 1000} 秒，已停止`;
  const line = error.stack?.match(/\(user\.js:(\d+)/) ?? error.stack?.match(/user\.js:(\d+)/);
  const text = error.message || error.name || '脚本出错';
  return line ? `${text}（第 ${line[1]} 行）` : text;
}

/** One loaded script module; `run` judges one period at a time. Dispose when finished. */
export class LoadedScript {
  private host: ScriptHost = () => {
    throw new Error('没有可用的数据');
  };
  private constructor(
    private runtime: QuickJSRuntime,
    private vm: QuickJSContext,
    readonly meta: ScriptMeta,
  ) {}
  static async load(code: string): Promise<LoadedScript> {
    const runtime = (await quickjs()).newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setModuleLoader((name) =>
      name === 'user.js' ? code : { error: new Error(`脚本不能导入其他模块（${name}）`) },
    );
    const vm = runtime.newContext();
    let script: LoadedScript | undefined;
    try {
      const bridge = vm.newFunction('__host', (nameHandle, argsHandle) => {
        const name = vm.getString(nameHandle);
        let reply: unknown;
        try {
          const args = JSON.parse(vm.getString(argsHandle));
          reply = {
            value: name.startsWith('util.')
              ? (
                  scriptUtil[name.slice(5) as keyof typeof scriptUtil] as (
                    ...a: unknown[]
                  ) => unknown
                )(...(args as unknown[]))
              : script!.host(name, args),
          };
        } catch (error) {
          reply = { error: error instanceof Error ? error.message : String(error) };
        }
        return vm.newString(JSON.stringify(reply ?? { value: null }));
      });
      vm.setProp(vm.global, '__host', bridge);
      bridge.dispose();
      runtime.setInterruptHandler(deadline());
      for (const [source, name, type] of [
        [PRELUDE, 'prelude.js', 'global'],
        ["import * as m from 'user.js'; globalThis.__module = m;", 'main.js', 'module'],
      ] as const) {
        const result = vm.evalCode(source, name, { type });
        if (result.error) {
          const text = message(vm, result.error);
          result.error.dispose();
          throw new Error(text);
        }
        result.value.dispose();
      }
      const pending = runtime.executePendingJobs();
      if (pending.error) {
        const text = message(vm, pending.error);
        pending.error.dispose();
        throw new Error(text);
      }
      const exported = vm.evalCode(
        `JSON.stringify({ judge: typeof __module.default === 'function', name: __module.name, description: __module.description, params: __module.params })`,
      );
      if (exported.error) {
        const text = message(vm, exported.error);
        exported.error.dispose();
        throw new Error(text);
      }
      const shape = JSON.parse(vm.getString(exported.value)) as Record<string, unknown>;
      exported.value.dispose();
      script = new LoadedScript(
        runtime,
        vm,
        scriptMeta({ ...shape, default: shape.judge ? () => undefined : undefined }),
      );
      return script;
    } catch (error) {
      vm.dispose();
      runtime.dispose();
      throw error;
    }
  }
  /** Synchronous: every data call is answered from memory by `host`. */
  run(period: ScriptPeriod, params: Record<string, ScriptParam>, host: ScriptHost): ScriptRun {
    const { vm, runtime } = this;
    this.host = host;
    runtime.setInterruptHandler(deadline());
    const started = vm.evalCode(
      `__run(${JSON.stringify(JSON.stringify(period))}, ${JSON.stringify(JSON.stringify(params))})`,
    );
    if (started.error) {
      const error = message(vm, started.error);
      started.error.dispose();
      return { error, logs: [] };
    }
    const promise = started.value;
    try {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        const error = message(vm, jobs.error);
        jobs.error.dispose();
        return { error, logs: this.logs() };
      }
      const state = vm.getPromiseState(promise);
      if (state.type === 'pending')
        return { error: 'judge 一直没有返回（等待了不会完成的 Promise）', logs: this.logs() };
      if (state.type === 'rejected') {
        const error = message(vm, state.error);
        state.error.dispose();
        return { error, logs: this.logs() };
      }
      const value = JSON.parse(vm.getString(state.value));
      state.value.dispose();
      return { outcome: scriptOutcome(value), logs: this.logs() };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), logs: this.logs() };
    } finally {
      promise.dispose();
      this.host = () => {
        throw new Error('没有可用的数据');
      };
    }
  }
  private logs(): string[] {
    const result = this.vm.evalCode('JSON.stringify(globalThis.__logs ?? [])');
    if (result.error) {
      result.error.dispose();
      return [];
    }
    const logs = JSON.parse(this.vm.getString(result.value)) as string[];
    result.value.dispose();
    return logs;
  }
  dispose() {
    this.vm.dispose();
    this.runtime.dispose();
  }
}
