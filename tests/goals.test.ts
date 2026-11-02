import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayRange,
  goalStatus,
  goalTargetText,
  initialState,
  parseGoalTarget,
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
    activityId: 'study',
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
    settled: false,
    met: null,
    within: true,
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
  assert.equal(state.goals[0].comparison, 'atLeast');
  assert.equal('pointsPerHour' in state.activities[0], false);
  assert.equal('rewards' in state, false);
});
