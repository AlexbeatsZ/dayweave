import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayRange,
  goalStatus,
  goalTargetText,
  initialState,
  parseGoalTarget,
  deleteActivity,
  describeRules,
  emptyRule,
  matchesRules,
  reorderRows,
  sortGoals,
  validateState,
  type Goal,
  type State,
} from '../src/timelog/domain';

test('goal target text accepts hours, minutes and a ceiling marker', () => {
  assert.deepEqual(parseGoalTarget('9h'), { minutes: 540, comparison: 'atLeast' });
  assert.deepEqual(parseGoalTarget('90'), { minutes: 90, comparison: 'atLeast' });
  assert.deepEqual(parseGoalTarget('> 1h30m'), { minutes: 90, comparison: 'atLeast' });
  assert.deepEqual(parseGoalTarget('<2小时'), { minutes: 120, comparison: 'atMost' });
  assert.deepEqual(parseGoalTarget('≤45分钟'), { minutes: 45, comparison: 'atMost' });
  assert.throws(() => parseGoalTarget('abc'));
  assert.throws(() => parseGoalTarget('<0'));
  for (const text of ['9h', '<1h30m', '45'])
    assert.equal(goalTargetText(parseGoalTarget(text)), text);
});

test('goals are judged only after their period ends', () => {
  const state: State = initialState();
  const day = '2026-11-02';
  const { start, end } = dayRange(day);
  state.records = [
    {
      id: 'r',
      activityId: 'study',
      note: '',
      tags: [],
      spans: [{ start: start + 3600000, end: start + 3 * 3600000 }],
      nature: 'positive',
      deletedAt: null,
      updatedAt: 1,
    },
  ];
  const floor: Goal = {
    id: 'g1',
    name: '学习',
    rules: [{ activities: ['study'], tags: [], excludeTags: [] }],
    minutes: 60,
    comparison: 'atLeast',
    period: 'day',
    archived: false,
    updatedAt: 1,
  };
  const ceiling: Goal = { ...floor, id: 'g2', minutes: 60, comparison: 'atMost' };
  // During the day a met floor is not yet counted and a ceiling is not met early.
  assert.deepEqual(goalStatus(state, floor, day, end - 1), {
    progress: 120,
    target: 60,
    settled: false,
    met: null,
    within: true,
    reached: 1,
    levels: 1,
  });
  assert.equal(goalStatus(state, ceiling, day, end - 1).met, null);
  assert.equal(goalStatus(state, floor, day, end).met, true);
  assert.equal(goalStatus(state, ceiling, day, end).met, false);
});

test('older data without comparison or with points still loads', () => {
  const base = initialState();
  const legacy = {
    ...base,
    activities: base.activities.map((row) => ({ ...row, pointsPerHour: 20 })),
    goals: [
      {
        id: 'g',
        name: '学习',
        activityId: 'study',
        minutes: 30,
        period: 'day',
        archived: false,
        updatedAt: 1,
      },
    ],
    rewards: [{ id: 'x', name: '奖励', cost: 10, archived: false, updatedAt: 1 }],
    redemptions: [],
  };
  const state = validateState(legacy);
  const [goal] = state.goals;
  assert.equal(goal.kind === undefined && goal.comparison, 'atLeast');
  assert.deepEqual(goal.kind === undefined && goal.rules, [
    { ...emptyRule(), activities: ['study'] },
  ]);
  assert.equal('pointsPerHour' in state.activities[0], false);
  assert.equal('rewards' in state, false);
});

test('a range in the target time sets one stage per unit and grades each period', () => {
  const hours = (...values: number[]) => values.map((value) => value * 60);
  const floor = parseGoalTarget('8-16h');
  assert.deepEqual(floor, {
    minutes: 960,
    comparison: 'atLeast',
    stages: hours(8, 9, 10, 11, 12, 13, 14, 15),
  });
  const ceiling = parseGoalTarget('<1-3h');
  assert.deepEqual(ceiling, { minutes: 60, comparison: 'atMost', stages: hours(2, 3) });
  assert.deepEqual(parseGoalTarget('≤ 1h - 3h'), ceiling);
  assert.deepEqual(parseGoalTarget('8到16小时'), floor);
  assert.deepEqual(parseGoalTarget('8,10,16h'), {
    minutes: 960,
    comparison: 'atLeast',
    stages: hours(8, 10),
  });
  assert.deepEqual(parseGoalTarget('30-33'), {
    minutes: 33,
    comparison: 'atLeast',
    stages: [30, 31, 32],
  });
  assert.deepEqual(parseGoalTarget('0.5-2h'), {
    minutes: 120,
    comparison: 'atLeast',
    stages: [30, 90],
  });
  assert.throws(() => parseGoalTarget('1-100h'), /阶段最多/);
  assert.throws(() => parseGoalTarget('8-16x'));
  // The editable text round-trips, collapsing unit runs back into a range.
  for (const text of ['8-16h', '<1-3h', '8,10,16h', '30-33', '<2,3h'])
    assert.equal(goalTargetText(parseGoalTarget(text)), text);
  assert.equal(goalTargetText(parseGoalTarget('<1,2,3h')), '<1-3h');
  assert.equal(
    goalTargetText({ minutes: 960, comparison: 'atLeast', stages: [480, 750] }),
    '480,750,960',
  );

  const state: State = initialState();
  const day = '2026-11-02';
  const { start, end } = dayRange(day);
  const record = (hours: number) => ({
    id: `r${hours}`,
    activityId: 'study',
    note: '',
    tags: [],
    spans: [{ start, end: start + hours * 3600000 }],
    nature: 'positive' as const,
    deletedAt: null,
    updatedAt: 1,
  });
  const study: Goal = {
    id: 'g',
    name: '学习',
    rules: [{ activities: ['study'], tags: [], excludeTags: [] }],
    ...floor,
    period: 'day',
    archived: false,
    updatedAt: 1,
  };
  state.records = [record(10.5)];
  const status = goalStatus(state, study, day, end);
  assert.equal(status.reached, 3);
  assert.equal(status.levels, 9);
  assert.equal(status.met, false, 'stages never replace the final target');
  const phone: Goal = { ...study, ...ceiling, stages: [120, 180] };
  for (const [hours, reached] of [
    [0.5, 3],
    [1.5, 2],
    [2.5, 1],
    [3.5, 0],
  ] as const) {
    state.records = [record(hours)];
    assert.equal(goalStatus(state, phone, day, end).reached, reached, `${hours}h`);
  }
  // Stored stages are normalized and checked against the target on load.
  const loaded = validateState({
    ...initialState(),
    goals: [{ ...study, stages: [600, 480, 960] }],
  });
  assert.deepEqual((loaded.goals[0] as typeof study).stages, [480, 600]);
  assert.throws(() => validateState({ ...initialState(), goals: [{ ...study, stages: [1200] }] }));
});

test('drag order renumbers rows and sorts goals and activities', () => {
  const base = initialState();
  const goal = (id: string, period: 'day' | 'week', group?: string): Goal => ({
    id,
    name: id,
    kind: 'manual',
    checks: {},
    period,
    ...(group ? { group } : {}),
    archived: false,
    updatedAt: 1,
  });
  const goals = [
    goal('w1', 'week'),
    goal('d1', 'day'),
    goal('x', 'day', '其他'),
    goal('d2', 'day'),
  ];
  // Never-ordered goals keep the older daily-before-weekly display inside each group.
  assert.deepEqual(
    sortGoals(goals).map((row) => row.id),
    ['d1', 'd2', 'w1', 'x'],
  );
  const moved = reorderRows(sortGoals(goals), ['d1', 'd2', 'w1'], 'w1', 'd1');
  assert.deepEqual(
    moved.map((row) => [row.id, row.order]),
    [
      ['w1', 1],
      ['d1', 2],
      ['d2', 3],
      ['x', 4],
    ],
  );
  assert.deepEqual(
    sortGoals(moved).map((row) => row.id),
    ['w1', 'd1', 'd2', 'x'],
  );
  assert.equal(reorderRows(moved, ['w1'], 'w1', 'w1'), moved);
  const activities = reorderRows(base.activities, ['study', 'work', 'reading'], 'reading', 'study');
  const loaded = validateState({ ...base, activities: [...activities].reverse() });
  assert.deepEqual(loaded.activities.map((row) => row.id).slice(0, 3), [
    'reading',
    'study',
    'work',
  ]);
});

test('time goals count records matching any rule of activities and tags', () => {
  const record = (activityId: string, tags: string[]) => ({ activityId, tags });
  // 学习 with #英语 but not #摸鱼, or anything tagged #阅读.
  const rules = [
    { activities: ['study', 'reading'], tags: ['英语'], excludeTags: ['摸鱼'] },
    { ...emptyRule(), tags: ['阅读'] },
  ];
  assert.equal(matchesRules(rules, record('study', ['英语'])), true);
  assert.equal(matchesRules(rules, record('reading', ['英语', '听力'])), true);
  assert.equal(matchesRules(rules, record('work', ['英语'])), false, 'activity not chosen');
  assert.equal(matchesRules(rules, record('study', [])), false, 'needs the included tag');
  assert.equal(matchesRules(rules, record('study', ['英语', '摸鱼'])), false, 'excluded tag');
  assert.equal(matchesRules(rules, record('work', ['阅读'])), true, 'second rule');
  // Included tags inside one rule are all required; "or" is a second rule.
  const both = [{ ...emptyRule(), tags: ['英语', '听力'] }];
  assert.equal(matchesRules(both, record('work', ['英语'])), false);
  assert.equal(matchesRules(both, record('work', ['英语', '听力'])), true);
  // Excluding alone counts everything else, untagged records included; an empty rule counts all.
  const notScroll = [{ ...emptyRule(), excludeTags: ['刷手机'] }];
  assert.equal(matchesRules(notScroll, record('life', [])), true);
  assert.equal(matchesRules(notScroll, record('life', ['刷手机'])), false);
  assert.equal(matchesRules([emptyRule()], record('life', [])), true);
  const base = initialState();
  assert.equal(
    describeRules(rules, base.activities),
    '学习或阅读，带 #英语，不带 #摸鱼；或 任意活动，带 #阅读',
  );
  const timeGoal = (id: string, ruleList: unknown[]) => ({
    id,
    name: id,
    rules: ruleList,
    minutes: 30,
    comparison: 'atLeast',
    period: 'day',
    archived: false,
    updatedAt: 1,
  });
  assert.throws(
    () =>
      validateState({
        ...base,
        goals: [timeGoal('g', [{ ...emptyRule(), tags: ['a'], excludeTags: ['a'] }])],
      }),
    /既包含又排除/,
  );
  assert.throws(() => validateState({ ...base, goals: [timeGoal('g', [])] }), /至少需要一条/);
  // Deleting an activity drops rules only about it and goals left with no rule.
  const after = deleteActivity(
    {
      ...base,
      goals: [
        timeGoal('only', [{ ...emptyRule(), activities: ['study'] }]),
        timeGoal('both', [{ ...emptyRule(), activities: ['study', 'work'] }]),
        timeGoal('split', [
          { ...emptyRule(), activities: ['study'] },
          { ...emptyRule(), tags: ['英语'] },
        ]),
      ] as Goal[],
    },
    'study',
  );
  assert.deepEqual(
    after.goals.map((row) => [row.id, row.kind === undefined && row.rules]),
    [
      ['both', [{ ...emptyRule(), activities: ['work'] }]],
      ['split', [{ ...emptyRule(), tags: ['英语'] }]],
    ],
  );
});
