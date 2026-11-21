import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emptyState, newTask, type Task } from '../src/model';
import { scriptHost, scriptPeriod } from '../src/timelog/script-api';
import { LoadedScript } from '../src/timelog/script-engine';
import { resolveParams } from '../src/timelog/script-util';
import { setDayStart, setTimeZone, wallTime } from '../src/timezone';
import { type UsageEvent } from '../src/usage/domain';

setTimeZone('Asia/Shanghai');
setDayStart('04:00');
const key = '2026-11-21';
const at = (wall: string, seconds = 0) => wallTime(key, wall) + seconds * 1000;
const observe = (start: number, end: number, inputState: UsageEvent['inputState']): UsageEvent => ({
  id: 'test',
  deviceId: 'mac',
  deviceName: 'Mac',
  platform: 'darwin',
  source: 'work-review',
  kind: 'app',
  start,
  end,
  app: 'Codex',
  title: '',
  url: '',
  category: '',
  inputState,
  revision: 1,
  deleted: false,
});
async function openJudge(name: string, now: number) {
  const code = await readFile(new URL(`../scripts/goals/${name}.js`, import.meta.url), 'utf8');
  const loaded = await LoadedScript.load(code);
  const period = scriptPeriod({ period: 'day' }, key, now);
  const params = resolveParams(loaded.meta.params, {});
  return {
    dispose: () => loaded.dispose(),
    run: (events: UsageEvent[], tasks: Task[] = []) => {
      const state = {
        ...emptyState(),
        tasks,
        lists: [{ ...emptyState().lists[0]!, id: 'evidence', name: '目标凭证' }],
      };
      const result = loaded.run(
        period,
        params,
        scriptHost(state, period, () => events),
      );
      assert.equal(result.error, undefined);
      assert.ok(result.outcome);
      return result.outcome;
    },
  };
}
const proof = (title: string, notes: Record<string, unknown>) =>
  newTask(title, {
    dates: { [key]: null },
    listId: 'evidence',
    notes: JSON.stringify(notes),
    createdAt: new Date(at('07:00')).toISOString(),
    completedAt: new Date(at('20:00')).toISOString(),
  });

test('vibe coding counts only recent input after :15, trims partial exceptions and preserves the 5 minute boundary', async () => {
  const judge = await openJudge('vibe-coding', at('20:00'));
  const idle = observe(at('09:10'), at('09:58'), 'idle');
  const allowed = observe(at('09:13'), at('09:20'), 'active');
  const violation = observe(at('09:13'), at('09:20', 1), 'active');
  const title = 'vibe coding 例外';
  try {
    assert.equal(judge.run([idle, allowed]).met, true);
    assert.equal(judge.run([idle, violation]).met, false);
    assert.equal(judge.run([observe(at('09:13'), at('09:58'), undefined)]).met, null);
    const request = {
      kind: 'emergency',
      sentAt: at('09:20'),
      start: at('09:15'),
      end: at('09:30'),
    };
    assert.equal(judge.run([idle, violation], [proof(title, request)]).met, true);
    assert.equal(
      judge.run([idle, violation], [proof(title, { ...request, sentAt: at('09:21') })]).met,
      false,
    );
    const planned = {
      kind: 'planned',
      sentAt: at('03:55'),
      approvedAt: at('07:00'),
      start: at('09:20'),
      end: at('09:30'),
    };
    assert.equal(judge.run([idle, violation], [proof(title, planned)]).met, true);
    assert.equal(
      judge.run([idle, violation], [proof(title, { ...planned, sentAt: at('04:00') })]).met,
      false,
    );
  } finally {
    judge.dispose();
  }
});

test('three plans score user confirmations by separate exclusive deadlines', async () => {
  const judge = await openJudge('three-plans', at('20:00'));
  const plan = (phase: string, confirmedAt: number) =>
    proof(`${phase}规划`, { confirmedAt, plan: 'Read the first chapter' });
  try {
    assert.equal(judge.run([]).progress, 0);
    const morning = plan('早上', at('08:59'));
    const evening = plan('晚上', at('18:59'));
    assert.equal(judge.run([], [morning, evening, plan('午间', at('13:00'))]).progress, 2 / 3);
    assert.equal(judge.run([], [morning, morning]).progress, 1 / 3);
    assert.equal(judge.run([], [morning, evening, plan('午间', at('12:59'))]).met, true);
  } finally {
    judge.dispose();
  }
});
