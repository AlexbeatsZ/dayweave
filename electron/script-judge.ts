/**
 * Computes every script goal's results on the profile that owns them (the sync hub, or a
 * desktop that is not paired) and writes them into state, from where sync distributes them.
 * Other devices never run goal scripts, so every device shows the same result.
 */
import { setImmediate as yieldToIO } from 'node:timers/promises';
import type { AppState } from '../src/model.js';
import { businessDateKey } from '../src/timezone.js';
import {
  goalPeriodKey,
  goalResultId,
  scriptBasis,
  type GoalResult,
  type GoalScript,
  type ScriptGoal,
} from '../src/timelog/domain.js';
import {
  dataStamp,
  resultPeriods,
  scriptHost,
  scriptPeriod,
  type ScriptData,
} from '../src/timelog/script-api.js';
import { LoadedScript, RUN_TIMEOUT_MS, type ScriptRun } from '../src/timelog/script-engine.js';
import { resolveParams } from '../src/timelog/script-util.js';
import type { UsageEvent } from '../src/usage/domain.js';
import type { StateService } from './state-service.js';
import type { DesktopSync } from './sync.js';
import type { UsageStore } from './usage-store.js';

/** Current periods (and recently ended ones, which late usage sync can still change). */
const REFRESH_MS = 5 * 60000;
const RECENT_MS = 36 * 3600000;
const DEBOUNCE_MS = 3000;

export class ScriptJudge {
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private running?: Promise<void>;
  private again = false;
  private closed = false;
  private ownRevision = '';
  private lastStamp = '';
  private loaded = new Map<string, { updatedAt: number; script?: LoadedScript; error?: string }>();
  /** Goal bases whose script timed out; they are not retried until the script or goal changes. */
  private blocked = new Map<string, string>();
  constructor(
    private service: StateService,
    private usage: () => UsageStore | undefined,
    private owner: () => boolean,
  ) {}
  start() {
    this.unsubscribe = this.service.subscribe((snapshot) => {
      if (snapshot.revision !== this.ownRevision) this.schedule(DEBOUNCE_MS);
    });
    this.interval = setInterval(() => this.schedule(0), REFRESH_MS);
    this.interval.unref();
    this.schedule(DEBOUNCE_MS);
    return this;
  }
  private schedule(delay: number) {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pass(), delay);
    this.timer.unref();
  }
  /** One pass at a time; a request during a pass runs another pass afterwards. */
  pass(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      // Yield first: a pass that finishes synchronously would otherwise clear `running`
      // before it is assigned, leaving a settled promise that every later call returns.
      await Promise.resolve();
      try {
        do {
          this.again = false;
          if (!this.closed && this.owner()) await this.compute();
        } while (this.again && !this.closed);
      } catch (error) {
        console.error('Dayweave goal scripts:', error);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }
  private async script(row: GoalScript) {
    const cached = this.loaded.get(row.id);
    if (cached?.updatedAt === row.updatedAt) return cached;
    cached?.script?.dispose();
    let entry: { updatedAt: number; script?: LoadedScript; error?: string };
    try {
      entry = { updatedAt: row.updatedAt, script: await LoadedScript.load(row.code) };
    } catch (error) {
      entry = {
        updatedAt: row.updatedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.loaded.set(row.id, entry);
    return entry;
  }
  private usageIn(range: { start: number; end: number }) {
    const store = this.usage();
    if (!store) throw new Error('同步中心的自动记录存储尚未就绪');
    const events: UsageEvent[] = [];
    let before: number | undefined;
    for (let page = 0; page < 200; page++) {
      const result = store.query({ ...range, before, limit: 5000 });
      events.push(...result.events);
      if (result.complete || result.next === undefined) return events;
      before = result.next;
    }
    throw new Error('此范围自动记录过多，请缩小查询范围');
  }
  private async compute() {
    const { state } = await this.service.snapshot();
    const data: ScriptData = {
      timelog: state.timelog,
      tasks: state.tasks,
      lists: state.lists,
      planGroups: state.planGroups,
      schedule: state.schedule,
    };
    const stamp = dataStamp(state);
    const changed = stamp !== this.lastStamp;
    const now = Date.now();
    const today = businessDateKey(now);
    const existing = new Map((state.timelog.goalResults ?? []).map((row) => [row.id, row]));
    const goals = state.timelog.goals.filter(
      (goal): goal is ScriptGoal => goal.kind === 'script' && !goal.archived,
    );
    const next: GoalResult[] = [];
    for (const goal of goals) {
      const basis = scriptBasis(state.timelog, goal);
      const row = state.timelog.scripts?.find((item) => item.id === goal.scriptId);
      const loaded: { script?: LoadedScript; error?: string } = row
        ? await this.script(row)
        : { error: '脚本已删除，请重新选择' };
      for (const key of resultPeriods(goal, today)) {
        const id = goalResultId(goal.id, key);
        const old = existing.get(id);
        const period = scriptPeriod(goal, key, now);
        const due =
          !old || old.basis !== basis || changed || !period.settled || now - period.end < RECENT_MS;
        if (!due) continue;
        let run: ScriptRun;
        const blocked = this.blocked.get(basis);
        if (blocked || loaded.error || !loaded.script)
          run = { error: blocked ?? loaded.error, logs: [] };
        else {
          run = loaded.script.run(
            period,
            resolveParams(loaded.script.meta.params, goal.params),
            scriptHost(data, period, (range) => this.usageIn(range)),
          );
          if (run.error?.startsWith(`运行超过 ${RUN_TIMEOUT_MS / 1000} 秒`))
            this.blocked.set(basis, run.error);
          await yieldToIO();
          if (this.closed) return;
        }
        const outcome = run.outcome ?? { met: null, progress: 0, note: '', error: run.error };
        next.push({
          id,
          goalId: goal.id,
          period: goalPeriodKey(goal, key),
          met: outcome.met,
          progress: outcome.progress,
          note: outcome.note,
          ...(outcome.error ? { error: outcome.error.slice(0, 2000) } : {}),
          basis,
          updatedAt: now,
        });
      }
    }
    this.lastStamp = stamp;
    for (const [id, entry] of this.loaded)
      if (!state.timelog.scripts?.some((row) => row.id === id)) {
        entry.script?.dispose();
        this.loaded.delete(id);
      }
    const snapshot = await this.service.mutate((current) => write(current, next, today));
    this.ownRevision = snapshot.revision;
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    this.unsubscribe?.();
    await this.running;
    for (const entry of this.loaded.values()) entry.script?.dispose();
    this.loaded.clear();
  }
}
/** Goal scripts run only where results are owned: the hub, or a profile that is not paired. */
export function startScriptJudge(
  service: StateService,
  sync: DesktopSync,
  store: () => UsageStore | undefined,
) {
  return new ScriptJudge(service, store, () => {
    const config = sync.client.config;
    return !config?.enabled || !!config.hub;
  }).start();
}
const same = (a: GoalResult, b: GoalResult) =>
  a.met === b.met &&
  a.progress === b.progress &&
  a.note === b.note &&
  a.error === b.error &&
  a.basis === b.basis;
/**
 * Merges freshly computed results into the latest state: unchanged results keep their row (no
 * sync traffic), results computed from an outdated goal are skipped for the next pass, and
 * results of removed goals or periods outside the kept window are dropped.
 */
export function write(state: AppState, computed: GoalResult[], today: string): AppState {
  const timelog = state.timelog;
  const goals = new Map(
    timelog.goals
      .filter((goal): goal is ScriptGoal => goal.kind === 'script' && !goal.archived)
      .map((goal) => [goal.id, goal]),
  );
  const kept = new Map<string, GoalResult>();
  for (const row of timelog.goalResults ?? []) {
    const goal = goals.get(row.goalId);
    if (goal && resultPeriods(goal, today).includes(row.period)) kept.set(row.id, row);
  }
  for (const row of computed) {
    const goal = goals.get(row.goalId);
    if (!goal || scriptBasis(timelog, goal) !== row.basis) continue;
    const old = kept.get(row.id);
    if (!old || !same(old, row)) kept.set(row.id, row);
  }
  const goalResults = [...kept.values()].sort((a, b) => a.id.localeCompare(b.id));
  const before = timelog.goalResults ?? [];
  if (
    goalResults.length === before.length &&
    goalResults.every((row, index) => row === before[index])
  )
    return state;
  return { ...state, timelog: { ...timelog, goalResults } };
}
