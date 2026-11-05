import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emptyState, newTask, type AppState } from '../src/model';
import { fromDocument, isDocumentKey, toDocument } from '../src/sync/document';
import {
  goalResultId,
  goalStatus,
  scriptBasis,
  scriptResult,
  validateState,
  type Goal,
  type GoalResult,
  type ScriptGoal,
  type State,
} from '../src/timelog/domain';
import {
  queryRange,
  scriptGoals,
  scriptHost,
  scriptPeriod,
  scriptRecords,
  scriptSlots,
  scriptTasks,
  scriptUsage,
  type ScriptData,
  type ScriptPeriod,
} from '../src/timelog/script-api';
import { LoadedScript } from '../src/timelog/script-engine';
import {
  intersect,
  minutes,
  resolveParams,
  scriptMeta,
  scriptOutcome,
  scriptUtil,
  sessions,
  subtract,
  union,
} from '../src/timelog/script-util';
import { setDayStart, setTimeZone, wallTime } from '../src/timezone';
import type { UsageEvent } from '../src/usage/domain';

setTimeZone('Asia/Shanghai');
setDayStart('04:00');
const DAY = '2026-11-03';
const at = (time: string, day = DAY) => wallTime(day, time);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });

function fixture(): AppState {
  const state = emptyState();
  const record = (
    id: string,
    activityId: string,
    from: string,
    to: string,
    tags: string[] = [],
  ) => ({
    id,
    activityId,
    note: '',
    tags,
    spans: [span(from, to)],
    nature: state.timelog.activities.find((row) => row.id === activityId)!.nature,
    deletedAt: null,
    updatedAt: 1,
  });
  state.timelog.records = [
    record('study-am', 'study', '09:00', '11:00'),
    record('scroll', 'scroll', '13:00', '13:30'),
    record('rest', 'life', '21:00', '22:00', ['决定休息']),
    record('scroll-late', 'scroll', '22:30', '23:00'),
    // Belongs to the previous business day (before 04:00).
    record('night', 'study', '02:00', '03:00'),
  ];
  state.tasks = [
    newTask('背单词', { id: 't1', dates: { [DAY]: null }, tags: ['英语'] }),
    newTask('写报告', {
      id: 't2',
      dates: { [DAY]: null },
      completedAt: new Date(at('15:00')).toISOString(),
    }),
  ];
  state.planGroups = [
    {
      id: 'slot',
      date: DAY,
      title: '午饭前',
      minutes: 120,
      until: '12:00',
      note: '',
      order: 0,
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-03T00:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'late',
      date: DAY,
      title: '夜里',
      minutes: 60,
      until: '01:00',
      note: '',
      order: 1,
      createdAt: '2026-11-03T00:00:00.000Z',
      updatedAt: '2026-11-03T00:00:00.000Z',
      deletedAt: null,
    },
  ];
  return state;
}
const data = (state: AppState): ScriptData => ({
  timelog: state.timelog,
  tasks: state.tasks,
  lists: state.lists,
  planGroups: state.planGroups,
  schedule: state.schedule,
});
const usage = (
  app: string,
  from: string,
  to: string,
  extra: Partial<UsageEvent> = {},
): UsageEvent => ({
  id: `${app}-${from}`,
  deviceId: 'phone',
  deviceName: 'Redmi',
  platform: 'android',
  source: 'dayweave',
  kind: 'app',
  ...span(from, to),
  app,
  title: '',
  url: '',
  category: '',
  revision: 1,
  deleted: false,
  ...extra,
});
const scriptGoal = (params: ScriptGoal['params'] = {}): ScriptGoal => ({
  id: 'g',
  name: '脚本目标',
  period: 'day',
  archived: false,
  updatedAt: 1,
  kind: 'script',
  scriptId: 's',
  params,
});
async function runCode(code: string, state: AppState, events: UsageEvent[], values = {}) {
  const script = await LoadedScript.load(code);
  try {
    const period = scriptPeriod({ period: 'day' }, DAY, at('12:00', '2026-11-04'));
    return script.run(
      period,
      resolveParams(script.meta.params, values),
      scriptHost(data(state), period, () => events),
    );
  } finally {
    script.dispose();
  }
}
async function runTemplate(file: string, state: AppState, events: UsageEvent[], values = {}) {
  const code = await readFile(`src/timelog/script-templates/${file}`, 'utf8');
  const run = await runCode(code, state, events, values);
  assert.equal(run.error, undefined);
  return run.outcome!;
}

test('span helpers merge, intersect, subtract and count sessions', () => {
  const a = [span('09:00', '10:00'), span('09:30', '11:00'), span('13:00', '14:00')];
  assert.deepEqual(union(a), [span('09:00', '11:00'), span('13:00', '14:00')]);
  assert.deepEqual(intersect(a, span('10:30', '13:30')), [
    span('10:30', '11:00'),
    span('13:00', '13:30'),
  ]);
  assert.deepEqual(subtract(span('09:00', '12:00'), [span('10:00', '10:30')]), [
    span('09:00', '10:00'),
    span('10:30', '12:00'),
  ]);
  assert.equal(minutes(a), 180);
  assert.equal(
    sessions([span('09:00', '09:05'), span('09:06', '09:10'), span('09:20', '09:21')], 2).length,
    2,
  );
  assert.equal(scriptUtil.clock(at('21:05')), '21:05');
  assert.equal(
    scriptUtil.date(at('03:00', '2026-11-04')),
    DAY,
    'before 04:00 is still the previous day',
  );
});

test('records are period-scoped, clipped and filterable by activity name, tags and nature', () => {
  const state = fixture();
  const period = scriptPeriod({ period: 'day' }, DAY, at('12:00', '2026-11-04'));
  assert.equal(period.start, at('04:00'));
  assert.equal(period.settled, true);
  const all = scriptRecords(data(state), period);
  assert.deepEqual(
    all.map((row) => row.id),
    ['study-am', 'scroll', 'rest', 'scroll-late'],
  );
  assert.deepEqual(
    scriptRecords(data(state), period, { activities: ['学习'] }).map((row) => row.minutes),
    [120],
  );
  assert.deepEqual(
    scriptRecords(data(state), period, { nature: 'negative', end: at('21:00') }).map((r) => r.id),
    ['scroll'],
  );
  assert.deepEqual(
    scriptRecords(data(state), period, { tags: ['决定休息'] }).map((r) => r.id),
    ['rest'],
  );
  const clipped = scriptRecords(data(state), period, { start: at('10:00'), end: at('10:30') });
  assert.deepEqual(clipped[0].spans, [span('10:00', '10:30')]);
  assert.throws(() => scriptRecords(data(state), period, { start: 0, end: 100 * 86400000 }), /62/);

  state.timelog.timer = {
    id: 'live',
    activityId: 'study',
    note: '',
    tags: [],
    spans: [],
    runningSince: at('11:30'),
    startedAt: at('11:30'),
    nature: 'positive',
  };
  const live = scriptPeriod({ period: 'day' }, DAY, at('11:45'));
  const running = scriptRecords(data(state), live).find((row) => row.running);
  assert.equal(running?.minutes, 15, 'a running timer counts up to now');
});

test('tasks, slots, usage and other goals are exposed read-only', () => {
  const state = fixture();
  state.timelog.goals = [
    {
      id: 'time',
      name: '学习 1h',
      period: 'day',
      archived: false,
      updatedAt: 1,
      rules: [{ activities: ['study'], tags: [], excludeTags: [] }],
      minutes: 60,
      comparison: 'atLeast',
    },
    scriptGoal(),
  ];
  const period = scriptPeriod({ period: 'day' }, DAY, at('12:00', '2026-11-04'));
  assert.deepEqual(
    scriptTasks(data(state), period, { tag: '英语' }).map((task) => task.title),
    ['背单词'],
  );
  assert.equal(scriptTasks(data(state), period, { completed: true })[0].completedAt, at('15:00'));
  const [slot, late] = scriptSlots(data(state), period);
  assert.deepEqual([slot.start, slot.end], [at('10:00'), at('12:00')]);
  assert.equal(
    late.end,
    at('01:00', '2026-11-04'),
    'slots before the day start are the next morning',
  );
  const events = [
    usage('tv.danmaku.bili', '09:30', '09:40'),
    usage('com.tencent.mm', '10:00', '10:05', { deleted: true }),
    usage('Chrome', '03:00', '04:30', { kind: 'web', url: 'https://example.com' }),
  ];
  const range = queryRange({}, period);
  assert.deepEqual(
    scriptUsage(events, range, { apps: ['BILI'] }).map((row) => row.app),
    ['tv.danmaku.bili'],
  );
  assert.equal(scriptUsage(events, range, { kinds: ['web'] })[0].start, at('04:00'), 'clipped');
  assert.equal(scriptUsage(events, range, { search: ['example'] }).length, 1);
  assert.deepEqual(
    scriptGoals(data(state), period).map((goal) => [goal.name, goal.met]),
    [['学习 1h', true]],
  );
});

test('script exports and results are checked before use', () => {
  assert.throws(() => scriptMeta({}), /export default/);
  assert.throws(() => scriptMeta({ default: () => true, params: { x: { type: 'date' } } }), /type/);
  const meta = scriptMeta({
    default: () => true,
    name: '示例',
    params: { apps: { type: 'list', default: 'a, b' }, limit: { type: 'number' } },
  });
  assert.deepEqual(
    meta.params.map((spec) => spec.default),
    [['a', 'b'], 0],
  );
  assert.deepEqual(resolveParams(meta.params, { limit: 5 }), { apps: ['a', 'b'], limit: 5 });
  assert.deepEqual(scriptOutcome(true), { met: true, progress: 1, note: '' });
  assert.deepEqual(scriptOutcome({ met: false, progress: 3, note: 'x' }), {
    met: false,
    progress: 1,
    note: 'x',
  });
  assert.throws(() => scriptOutcome({ met: 'yes' }), /met/);
  assert.throws(() => scriptOutcome(1), /返回/);
});

test('script goals only count a settled, error-free result computed from the current basis', () => {
  const state: State = fixture().timelog;
  state.scripts = [{ id: 's', name: '示例', code: 'export default () => true', updatedAt: 2 }];
  const goal = scriptGoal();
  state.goals = [goal];
  const ended = at('12:00', '2026-11-04');
  assert.equal(goalStatus(state, goal, DAY, ended).met, null, 'not computed yet');
  const result = (outcome: Partial<GoalResult>): GoalResult => ({
    id: goalResultId(goal.id, DAY),
    goalId: goal.id,
    period: DAY,
    met: true,
    progress: 1,
    note: '',
    basis: scriptBasis(state, goal),
    updatedAt: 1,
    ...outcome,
  });
  state.goalResults = [result({})];
  assert.equal(goalStatus(state, goal, DAY, ended).met, true);
  assert.equal(goalStatus(state, goal, DAY, at('12:00')).met, null, 'running periods stay open');
  state.goalResults = [result({ met: null, error: 'x' })];
  assert.equal(goalStatus(state, goal, DAY, ended).met, null);
  state.goalResults = [result({})];
  assert.equal(
    scriptResult(state, { ...goal, params: { limit: 3 } }, DAY),
    undefined,
    'new params',
  );
  assert.ok(
    scriptResult(state, { ...goal, name: '改名', order: 3, updatedAt: 9 }, DAY),
    'renaming or reordering keeps the result',
  );
  state.scripts = [{ ...state.scripts[0], updatedAt: 3 }];
  assert.equal(scriptResult(state, goal, DAY), undefined, 'edited script');
});

test('the QuickJS sandbox exposes only ctx and stops runaway scripts', async () => {
  const state = fixture();
  const run = (code: string) => runCode(code, state, []);
  let result = await run(
    'export default async (ctx) => ({ met: typeof fetch === "undefined" && typeof require === "undefined" && typeof process === "undefined", note: String((await ctx.records()).length) })',
  );
  assert.deepEqual(result.outcome, { met: true, progress: 1, note: '4' });
  await assert.rejects(
    () => LoadedScript.load("import fs from 'node:fs'; export default () => true"),
    /不能导入/,
  );
  await assert.rejects(() => LoadedScript.load('export const x = 1'), /export default/);
  await assert.rejects(
    () => LoadedScript.load('export default () => {'),
    /SyntaxError|expecting|unexpected/i,
  );
  result = await run(
    'export default async function judge(ctx) {\n  ctx.log("a", 1)\n  return ctx.nope.value\n}',
  );
  assert.match(result.error!, /第 3 行/);
  assert.deepEqual(result.logs, ['a 1']);
  result = await run(
    'export default async (ctx) => { await ctx.records({ start: 0, end: 1e12 }) }',
  );
  assert.match(result.error!, /62/);
  result = await run('export default () => new Promise(() => {})');
  assert.match(result.error!, /一直没有返回/);
  result = await run(
    'export default (ctx) => ctx.util.minutes([{ start: 0, end: 600000 }]) === 10',
  );
  assert.equal(result.outcome?.met, true);
  const started = Date.now();
  result = await run('export default () => { while (true) {} }');
  assert.match(result.error!, /运行超过 5 秒/);
  assert.ok(Date.now() - started < 8000);
});

test('the script library and script goals validate and sync as their own documents', () => {
  const state = fixture();
  state.timelog.scripts = [
    { id: 's', name: '示例', code: 'export default () => true', updatedAt: 2 },
  ];
  state.timelog.goals = [scriptGoal({ limit: 10, apps: ['bili'], strict: true })];
  const loaded = validateState(state.timelog);
  assert.deepEqual(loaded.scripts, state.timelog.scripts);
  assert.deepEqual((loaded.goals[0] as ScriptGoal).params, {
    limit: 10,
    apps: ['bili'],
    strict: true,
  });
  assert.throws(() =>
    validateState({ ...state.timelog, goals: [{ ...scriptGoal(), params: { 'a-b': 1 } }] }),
  );
  assert.equal(validateState({ ...state.timelog, scripts: [] }).scripts, undefined);
  const doc = toDocument(state);
  assert.ok(isDocumentKey('scripts/s'));
  assert.equal((doc['scripts/s'] as { code: string }).code, 'export default () => true');
  const back = fromDocument(doc, emptyState());
  assert.deepEqual(back.timelog.scripts, state.timelog.scripts);
  assert.equal((back.timelog.goals[0] as Goal).kind, 'script');
});

test('the rest-before-fun template fails on entertainment before the rest decision', async () => {
  const state = fixture();
  let result = await runTemplate('rest-before-fun.js', state, []);
  assert.equal(result.met, false);
  assert.match(result.note, /30 分钟/, 'only the 13:00 scrolling is before the 21:00 rest');
  state.timelog.records = state.timelog.records.filter((row) => row.id !== 'scroll');
  result = await runTemplate('rest-before-fun.js', state, []);
  assert.equal(result.met, true, 'scrolling after deciding to rest is allowed');
  result = await runTemplate('rest-before-fun.js', state, [], { fun: ['学习'] });
  assert.equal(result.met, false, 'the activity list replaces the negative-nature default');
});

test('the focus-apps template counts distracting app time inside study records', async () => {
  const state = fixture();
  const events = [
    usage('tv.danmaku.bilibili', '09:10', '09:14'),
    usage('tv.danmaku.bilibili', '09:15', '09:17'),
    usage('com.tencent.mm', '10:50', '11:20'),
    usage('com.android.chrome', '09:30', '09:40'),
  ];
  let result = await runTemplate('focus-apps.js', state, events, {
    apps: ['bilibili', 'tencent.mm'],
  });
  assert.match(result.note, /16 分钟 · 2 次/, '6 + 10 minutes inside 09:00–11:00, two sessions');
  assert.equal(result.met, false);
  result = await runTemplate('focus-apps.js', state, events, {
    apps: ['bilibili', 'tencent.mm'],
    maxMinutes: 20,
  });
  assert.equal(result.met, true);
  result = await runTemplate(
    'focus-apps.js',
    { ...state, timelog: { ...state.timelog, records: [] } },
    events,
  );
  assert.equal(result.met, null);
});
