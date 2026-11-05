import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileStore } from '../electron/storage';
import { ScriptJudge, write } from '../electron/script-judge';
import { StateService } from '../electron/state-service';
import { UsageStore } from '../electron/usage-store';
import { emptyState } from '../src/model';
import {
  goalResultId,
  goalStatus,
  scriptResult,
  type GoalResult,
  type ScriptGoal,
} from '../src/timelog/domain';
import { resultPeriods } from '../src/timelog/script-api';
import { businessDateKey, setDayStart, setTimeZone, shiftDay } from '../src/timezone';
import type { UsageEvent } from '../src/usage/domain';

setTimeZone('Asia/Shanghai');
setDayStart('00:00');

test('the hub judges every kept period once, distributes results in state and keeps them stable', async () => {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'dayweave-judge-'));
  const service = new StateService(new FileStore(directory));
  const usage = new UsageStore(':memory:');
  const now = Date.now();
  const today = businessDateKey(now);
  const event: UsageEvent = {
    id: 'u1',
    deviceId: 'phone',
    deviceName: 'Redmi',
    platform: 'android',
    source: 'dayweave',
    kind: 'app',
    start: now - 20 * 60000,
    end: now - 10 * 60000,
    app: 'tv.danmaku.bilibili',
    title: '',
    url: '',
    category: '',
    revision: 1,
    deleted: false,
  };
  usage.import([event], 'phone');
  let owner = true;
  const judge = new ScriptJudge(
    service,
    () => usage,
    () => owner,
  );
  try {
    const goal: ScriptGoal = {
      id: 'g',
      name: '少刷 B 站',
      period: 'day',
      archived: false,
      updatedAt: 1,
      kind: 'script',
      scriptId: 's',
      params: { limit: 5 },
    };
    await service.mutate(() => {
      const state = emptyState();
      state.timelog.scripts = [
        {
          id: 's',
          name: 'B 站',
          code: `export const params = { limit: { type: 'number', default: 30 } };
export default async (ctx) => {
  const minutes = ctx.util.minutes(await ctx.usage({ apps: ['bilibili'] }));
  return { met: minutes <= ctx.params.limit, note: Math.round(minutes) + ' 分钟' };
}`,
          updatedAt: 2,
        },
      ];
      state.timelog.goals = [goal];
      return state;
    });
    await judge.pass();
    let { state } = await service.snapshot();
    const results = state.timelog.goalResults ?? [];
    assert.equal(results.length, resultPeriods(goal, today).length, 'one result per kept day');
    assert.equal(scriptResult(state.timelog, goal, today)?.note, '10 分钟');
    assert.equal(scriptResult(state.timelog, goal, shiftDay(today, -1))?.note, '0 分钟');
    assert.equal(
      goalStatus(state.timelog, goal, shiftDay(today, -1), now).met,
      true,
      'every device reads the same settled result from state',
    );
    // Nothing changed: another pass must not write, so sync carries no new revision.
    const revision = (await service.snapshot()).revision;
    await judge.pass();
    assert.equal((await service.snapshot()).revision, revision);

    // Editing parameters (on any device) makes the hub recompute every period.
    await service.mutate((current) => ({
      ...current,
      timelog: {
        ...current.timelog,
        goals: [{ ...goal, params: { limit: 20 }, updatedAt: 3 }],
      },
    }));
    ({ state } = await service.snapshot());
    assert.equal(
      scriptResult(state.timelog, state.timelog.goals[0] as ScriptGoal, today),
      undefined,
    );
    await judge.pass();
    ({ state } = await service.snapshot());
    const edited = state.timelog.goals[0] as ScriptGoal;
    assert.equal(scriptResult(state.timelog, edited, today)?.met, true);

    // A paired client never computes.
    owner = false;
    await service.mutate((current) => ({
      ...current,
      timelog: { ...current.timelog, goals: [{ ...edited, params: { limit: 1 }, updatedAt: 4 }] },
    }));
    await judge.pass();
    ({ state } = await service.snapshot());
    assert.equal(
      scriptResult(state.timelog, state.timelog.goals[0] as ScriptGoal, today),
      undefined,
    );

    // Deleting the goal drops its results.
    owner = true;
    await service.mutate((current) => ({ ...current, timelog: { ...current.timelog, goals: [] } }));
    await judge.pass();
    ({ state } = await service.snapshot());
    assert.equal(state.timelog.goalResults, undefined);
    const saved = JSON.parse(await readFile(path.join(directory, 'data.json'), 'utf8'));
    assert.equal(saved.timelog.goalResults, undefined);
  } finally {
    await judge.close();
    usage.close();
    service.dispose();
    await service.flush();
    await rm(directory, { recursive: true, force: true });
  }
});

test('writing results skips ones computed from an outdated goal and trims the window', () => {
  const state = emptyState();
  const goal: ScriptGoal = {
    id: 'g',
    name: 'x',
    period: 'day',
    archived: false,
    updatedAt: 1,
    kind: 'script',
    scriptId: 's',
    params: {},
  };
  state.timelog.scripts = [{ id: 's', name: 's', code: '', updatedAt: 1 }];
  state.timelog.goals = [goal];
  const today = '2026-11-04';
  const row = (period: string, basis: string): GoalResult => ({
    id: goalResultId('g', period),
    goalId: 'g',
    period,
    met: true,
    progress: 1,
    note: '',
    basis,
    updatedAt: 1,
  });
  const current = JSON.stringify(['s', 1, 'day', {}]);
  state.timelog.goalResults = [row('2026-01-01', current)];
  const next = write(state, [row(today, current), row('2026-11-03', 'old basis')], today);
  assert.deepEqual(
    next.timelog.goalResults?.map((item) => item.period),
    [today],
    'outside the window and outdated rows are dropped',
  );
});
