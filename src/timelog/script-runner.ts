/**
 * Main-thread side of goal scripts: one worker per script source, data calls answered from
 * the store and the automatic-record database, and a per-device result cache. Results are
 * never written to synced state (see docs/design/goal-scripts.md).
 */
import { useEffect, useMemo, useState } from 'react';
import type { AppState } from '../model.js';
import { useStore } from '../store.js';
import { getDayStart, getTimeZone } from '../timezone.js';
import { loadUsageRange } from '../usage/client.js';
import type { UsageEvent } from '../usage/domain.js';
import type { GoalScript, ScriptGoal, ScriptOutcome, ScriptParam } from './domain.js';
import {
  queryRange,
  scriptActivities,
  scriptClasses,
  scriptGoals,
  scriptPeriod,
  scriptRecords,
  scriptSlots,
  scriptTasks,
  scriptUsage,
  type ScriptData,
  type ScriptPeriod,
} from './script-api.js';
import { resolveParams, type ScriptMeta } from './script-util.js';
import type { WorkerRequest, WorkerResponse } from './script-worker.js';
import ScriptWorker from './script-worker.ts?worker&inline';

/** One run may take this long, data calls included, before its worker is stopped. */
export const RUN_TIMEOUT_MS = 10000;
export type RunResult = { outcome?: ScriptOutcome; error?: string; logs: string[] };

const dataOf = (state: AppState): ScriptData => ({
  timelog: state.timelog,
  tasks: state.tasks,
  lists: state.lists,
  planGroups: state.planGroups,
  schedule: state.schedule,
});
/** Answers a script's data calls; usage pages are cached for the host's lifetime. */
function createHost(getData: () => ScriptData) {
  const usage = new Map<string, Promise<UsageEvent[]>>();
  const methods: Record<string, (period: ScriptPeriod, query: never) => unknown> = {
    records: (period, query) => scriptRecords(getData(), period, query),
    activities: () => scriptActivities(getData()),
    tasks: (period, query) => scriptTasks(getData(), period, query),
    slots: (period, query) => scriptSlots(getData(), period, query),
    classes: (period, query) => scriptClasses(getData(), period, query),
    goals: (period) => scriptGoals(getData(), period),
    usage: async (period, query?: { start?: number; end?: number }) => {
      const range = queryRange(query, period);
      const key = `${range.start}-${range.end}`;
      if (!usage.has(key)) usage.set(key, loadUsageRange(range));
      return scriptUsage(await usage.get(key)!, range, query);
    },
  };
  return async (method: string, period: ScriptPeriod, args: unknown[]) => {
    const handler = methods[method];
    if (!handler) throw new Error(`ctx.${method} 不存在`);
    return handler(period, (args[0] ?? {}) as never);
  };
}
type Host = ReturnType<typeof createHost>;

/** A worker holding one loaded script module. */
class ScriptSession {
  private worker: Worker;
  private runs = new Map<
    number,
    { period: ScriptPeriod; resolve: (result: RunResult) => void; timer: number }
  >();
  private nextRun = 0;
  private dead = '';
  readonly ready: Promise<ScriptMeta>;
  constructor(
    code: string,
    private host: Host,
  ) {
    this.worker = new ScriptWorker();
    let loaded!: (meta: ScriptMeta) => void, failed!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => ((loaded = resolve), (failed = reject)));
    const timer = window.setTimeout(() => {
      failed(new Error('脚本加载超时'));
      this.stop('脚本加载超时');
    }, RUN_TIMEOUT_MS);
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'loaded' || data.type === 'failed') window.clearTimeout(timer);
      if (data.type === 'loaded') loaded(data.meta);
      else if (data.type === 'failed') {
        failed(new Error(data.error));
        this.stop(data.error);
      } else if (data.type === 'call') void this.answer(data);
      else if (data.type === 'result') {
        const run = this.runs.get(data.runId);
        if (!run) return;
        window.clearTimeout(run.timer);
        this.runs.delete(data.runId);
        run.resolve({ outcome: data.outcome, error: data.error, logs: data.logs });
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      failed(new Error(event.message || '脚本无法加载'));
      this.stop(event.message || '脚本无法加载');
    };
    this.send({ type: 'load', code, zone: getTimeZone(), dayStart: getDayStart() });
  }
  get alive() {
    return !this.dead;
  }
  private send(message: WorkerRequest) {
    this.worker.postMessage(message);
  }
  private async answer(call: Extract<WorkerResponse, { type: 'call' }>) {
    const run = this.runs.get(call.runId);
    if (!run) return;
    try {
      const value = await this.host(call.method, run.period, call.args);
      this.send({ type: 'reply', callId: call.callId, value });
    } catch (error) {
      this.send({
        type: 'reply',
        callId: call.callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  async run(period: ScriptPeriod, params: Record<string, ScriptParam>): Promise<RunResult> {
    if (this.dead) return { error: this.dead, logs: [] };
    await this.ready;
    const runId = ++this.nextRun;
    return new Promise((resolve) => {
      const timer = window.setTimeout(
        () => this.stop(`运行超过 ${RUN_TIMEOUT_MS / 1000} 秒，已停止`),
        RUN_TIMEOUT_MS,
      );
      this.runs.set(runId, { period, resolve, timer });
      this.send({ type: 'run', runId, period, params });
    });
  }
  /** Ends the worker; unfinished runs report `reason`. */
  stop(reason = '已停止') {
    if (this.dead) return;
    this.dead = reason;
    this.worker.terminate();
    for (const run of this.runs.values()) {
      window.clearTimeout(run.timer);
      run.resolve({ error: reason, logs: [] });
    }
    this.runs.clear();
  }
}

/** Loads `code` once to read its name, description and parameters. */
export async function inspectScript(code: string): Promise<ScriptMeta> {
  const session = new ScriptSession(
    code,
    createHost(() => ({}) as ScriptData),
  );
  try {
    return await session.ready;
  } finally {
    session.stop();
  }
}
/** The editor's 试运行: one run of unsaved code for one period. */
export async function testScript(
  code: string,
  state: AppState,
  goal: Pick<ScriptGoal, 'period' | 'params'>,
  key: string,
): Promise<RunResult & { meta?: ScriptMeta }> {
  const session = new ScriptSession(
    code,
    createHost(() => dataOf(state)),
  );
  try {
    const meta = await session.ready;
    const result = await session.run(
      scriptPeriod(goal, key, Date.now()),
      resolveParams(meta.params, goal.params),
    );
    return { ...result, meta };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), logs: [] };
  } finally {
    session.stop();
  }
}

// Shared across components: one worker per script source, results per goal/period/data stamp.
const sessions = new Map<string, { session: ScriptSession; used: number }>();
const results = new Map<string, { stamp: string; result: RunResult }>();
let latest: AppState | undefined;
const host = createHost(() => dataOf(latest!));
function sessionFor(code: string) {
  const now = Date.now();
  for (const [key, entry] of sessions)
    if (key !== code && now - entry.used > 120000) {
      entry.session.stop();
      sessions.delete(key);
    }
  let entry = sessions.get(code);
  if (!entry?.session.alive) {
    entry = { session: new ScriptSession(code, host), used: now };
    sessions.set(code, entry);
  }
  entry.used = now;
  return entry.session;
}
/** Changes whenever data a script could read changes; usage is covered by the minute tick. */
function dataStamp(state: AppState) {
  let stamp = 0;
  for (const row of state.timelog.records) stamp = Math.max(stamp, row.updatedAt);
  for (const row of state.tasks) stamp = Math.max(stamp, Date.parse(row.updatedAt));
  for (const row of state.planGroups) stamp = Math.max(stamp, Date.parse(row.updatedAt));
  return [
    stamp,
    state.timelog.records.length,
    state.tasks.length,
    state.planGroups.length,
    state.timelog.timer?.id ?? '',
    state.schedule.courses.length + state.schedule.events.length,
  ].join(':');
}
const resultKey = (goal: ScriptGoal, key: string) => `${goal.id}@${key}`;

/**
 * Runs each requested goal/period (current periods again every minute) and returns the
 * latest result per `${goal.id}@${periodKey}`. Earlier results stay visible while rerunning.
 */
export function useScriptResults(requests: { goal: ScriptGoal; key: string }[]) {
  const { data } = useStore();
  latest = data;
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60000));
  const [, setVersion] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setMinute(Math.floor(Date.now() / 60000)), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const scripts = data.timelog.scripts;
  const stamp = dataStamp(data);
  const signature = requests
    .map(({ goal, key }) => `${resultKey(goal, key)}:${goal.updatedAt}`)
    .join('|');
  const jobs = useMemo(() => {
    const now = Date.now();
    return requests.flatMap(({ goal, key }) => {
      const script = scripts?.find((row) => row.id === goal.scriptId);
      const period = scriptPeriod(goal, key, now);
      const jobStamp = [
        script?.updatedAt ?? 'missing',
        JSON.stringify(goal.params),
        stamp,
        period.settled ? 'settled' : minute,
      ].join('|');
      return [{ goal, key, script, period, jobStamp }];
    });
    // `signature` stands in for `requests`, which callers rebuild on every render.
  }, [signature, scripts, stamp, minute]);
  useEffect(() => {
    let cancelled = false;
    const missing = jobs.filter(
      (job) => results.get(resultKey(job.goal, job.key))?.stamp !== job.jobStamp,
    );
    void (async () => {
      for (const job of missing) {
        if (cancelled) return;
        const result = await runJob(job.script, job.goal, job.period);
        results.set(resultKey(job.goal, job.key), { stamp: job.jobStamp, result });
        if (!cancelled) setVersion((value) => value + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobs]);
  return (goal: ScriptGoal, key: string) => results.get(resultKey(goal, key))?.result;
}
async function runJob(script: GoalScript | undefined, goal: ScriptGoal, period: ScriptPeriod) {
  if (!script) return { error: '脚本已删除，请重新选择', logs: [] } satisfies RunResult;
  const session = sessionFor(script.code);
  try {
    const meta = await session.ready;
    return await session.run(period, resolveParams(meta.params, goal.params));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), logs: [] };
  }
}
/** The goal status input for a run: errors become an undecided outcome carrying the message. */
export const outcomeOf = (result: RunResult | undefined): ScriptOutcome | undefined =>
  result && (result.outcome ?? { met: null, progress: 0, note: '', error: result.error });
