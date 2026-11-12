import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, stateSchema } from '../src/model';
import { activeActivity, startTimer, type Activity } from '../src/timelog/domain';
import { fromDocument, toDocument } from '../src/sync/document';

test('new profiles are empty and older profiles retire only unmodified, unused presets', () => {
  const state = emptyState();
  assert.deepEqual(state.timelog.activities, []);
  const row = (id: string, name: string, color: string): Activity => ({
    id,
    name,
    color,
    archived: false,
    nature: 'positive',
    updatedAt: 1,
  });
  state.timelog.activities = [
    row('study', '学习', '#357a9e'),
    row('work', '工作', '#4d8b73'),
    row('reading', '阅读', '#8e74a4'),
    row('exercise', '运动', '#8f9851'),
    { ...row('life', '日常生活', '#a98241'), nature: 'neutral' },
    { ...row('scroll', '无目的刷手机', '#bc7267'), nature: 'negative' },
    row('user-exercise', '运动', '#8f9851'),
  ];
  state.lists[0].activityId = 'work';
  state.timelog.records = [
    {
      id: 'record',
      activityId: 'study',
      spans: [{ start: 100, end: 200 }],
      deletedAt: null,
      nature: 'positive',
      tags: [],
      note: '',
      updatedAt: 200,
    },
  ];
  state.timelog = startTimer(state.timelog, 'reading', '', 300);
  state.timelog.goals = [
    {
      id: 'goal',
      name: '日常整理',
      period: 'day',
      archived: false,
      updatedAt: 1,
      minutes: 10,
      comparison: 'atLeast',
      rules: [{ activities: ['life'], tags: [], excludeTags: [] }],
    },
  ];
  state.timelog.activities.find((item) => item.id === 'scroll')!.order = 1;

  const migrated = fromDocument(toDocument(state), emptyState());
  assert.deepEqual(
    migrated.timelog.activities
      .filter(activeActivity)
      .map((item) => item.id)
      .sort(),
    ['life', 'reading', 'scroll', 'study', 'user-exercise', 'work'],
  );
  assert.ok(migrated.timelog.activities.find((item) => item.id === 'exercise')?.deletedAt);
  assert.deepEqual(migrated.timelog.records, state.timelog.records);
  assert.deepEqual(migrated.timelog.goals, state.timelog.goals);
  assert.deepEqual(migrated.timelog.timer, state.timelog.timer);
  assert.equal(migrated.lists[0].activityId, 'work');
  assert.deepEqual(stateSchema.parse(migrated), migrated);
});
