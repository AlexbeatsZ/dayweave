/**
 * The script editor's local helpers. Goal results themselves are computed only by the sync
 * hub (electron/script-judge.ts) and arrive with synced state; this module only reads a
 * script's exports and runs the editor's 试运行 with this device's data, using the same
 * QuickJS engine as the hub. The engine is loaded on first use.
 */
import type { AppState } from '../model.js';
import { loadUsageRange } from '../usage/client.js';
import type { UsageEvent } from '../usage/domain.js';
import type { ScriptGoal, Span } from './domain.js';
import { scriptHost, scriptPeriod, type ScriptData } from './script-api.js';
import type { ScriptRun } from './script-engine.js';
import { resolveParams, type ScriptMeta } from './script-util.js';

const engine = () => import('./script-engine.js');

/** Loads `code` once to read its name, description and parameters. */
export async function inspectScript(code: string): Promise<ScriptMeta> {
  const script = await (await engine()).LoadedScript.load(code);
  try {
    return script.meta;
  } finally {
    script.dispose();
  }
}
/**
 * One run of unsaved code for one period with this device's data. Runs are synchronous, so
 * automatic records are fetched on demand: a run asking for an unloaded range is repeated
 * once the range has been read (scripts only read data, so repeating them is harmless).
 */
export async function testScript(
  code: string,
  state: AppState,
  goal: Pick<ScriptGoal, 'period' | 'params'>,
  key: string,
): Promise<ScriptRun & { meta?: ScriptMeta }> {
  let script;
  try {
    script = await (await engine()).LoadedScript.load(code);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), logs: [] };
  }
  try {
    const data: ScriptData = {
      timelog: state.timelog,
      tasks: state.tasks,
      lists: state.lists,
      planGroups: state.planGroups,
      schedule: state.schedule,
    };
    const period = scriptPeriod(goal, key, Date.now());
    const params = resolveParams(script.meta.params, goal.params);
    const usage = new Map<string, UsageEvent[]>();
    for (let attempt = 0; attempt < 8; attempt++) {
      let missing: Span | undefined;
      const host = scriptHost(data, period, (range) => {
        const loaded = usage.get(`${range.start}-${range.end}`);
        if (loaded) return loaded;
        missing = range;
        throw new Error('正在读取自动记录');
      });
      const run = script.run(period, params, host);
      if (!missing) return { ...run, meta: script.meta };
      const range: Span = missing;
      usage.set(`${range.start}-${range.end}`, await loadUsageRange(range));
    }
    return { error: '自动记录查询次数过多', logs: [], meta: script.meta };
  } finally {
    script.dispose();
  }
}
