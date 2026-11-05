import { setTimeZone } from '../src/timezone';
setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  dateSchema,
  emptyState,
  mergeImport,
  newTask,
  selectTasks,
  shiftDate,
  stateSchema,
  statistics,
  toggleTask,
  type AppState,
} from '../src/model';

test('calendar dates validate real days and retain local calendar dates', () => {
  assert.equal(dateKey(new Date(2026, 9, 19, 23, 59)), '2026-10-19');
  assert.equal(dateSchema.safeParse('2026-02-29').success, false);
  assert.equal(dateSchema.safeParse('2028-02-29').success, true);
  assert.equal(dateSchema.safeParse('2026-13-01').success, false);
  assert.equal(shiftDate('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});
test('non-recurring and deleted tasks do not spawn follow-ups', () => {
  const task = newTask('One time');
  const state = { ...emptyState(), tasks: [task] };
  assert.equal(toggleTask(state, task.id).tasks.length, 1);
  const deleted = { ...state, tasks: [{ ...task, deletedAt: new Date().toISOString() }] };
  assert.equal(toggleTask(deleted, task.id), deleted);
});
test('filters distinguish unscheduled tasks, today including overdue, the natural calendar week, and trash', () => {
  const tasks = [
    newTask('Overdue', { dates: { ['2026-10-18']: null } }),
    newTask('Today', { dates: { ['2026-10-19']: null } }),
    newTask('Later', { dates: { ['2026-10-25']: null } }),
    newTask('Too far', { dates: { ['2026-10-26']: null } }),
    newTask('Inbox'),
    newTask('Deleted', { deletedAt: new Date().toISOString() }),
  ];
  const s = { ...emptyState(), tasks };
  assert.deepEqual(
    selectTasks(s, 'today', '', 'manual', '2026-10-19').map((t) => t.title),
    ['Today'],
  );
  assert.deepEqual(
    selectTasks(s, 'upcoming', '', 'manual', '2026-10-19').map((t) => t.title),
    ['Today', 'Later'],
  );
  assert.deepEqual(
    selectTasks(s, 'inbox').map((t) => t.title),
    ['Inbox'],
  );
  assert.deepEqual(
    selectTasks(s, 'trash').map((t) => t.title),
    ['Deleted'],
  );
});
test('search covers notes, tags and subtasks across the current filtered view', () => {
  const task = newTask('Read', {
    notes: 'Research alpha',
    tags: ['science'],
    subtasks: [{ id: 'sub', title: 'Beta step', done: false }],
  });
  const s = { ...emptyState(), tasks: [task] };
  for (const query of ['ALPHA', '#science', 'Beta'])
    assert.equal(selectTasks(s, 'today', query).length, 1);
});
test('difficulty is a manual choice independent of estimates', () => {
  assert.equal(newTask('旧默认', { estimatedMinutes: 999 }).difficulty, 'easy');
  assert.equal(newTask('手动', { estimatedMinutes: 1, difficulty: 'hard' }).difficulty, 'hard');
  assert.throws(() => newTask('错误', { difficulty: 'auto' as never }));
});
test('import merges newer edits and tombstones without removing local tasks or settings', () => {
  const task = newTask('Original', { updatedAt: '2026-10-18T10:00:00.000Z' });
  const local = {
    ...emptyState(),
    tasks: [task, newTask('Local only')],
    settings: { ...emptyState().settings, theme: 'dark' as const },
  };
  const incoming = {
    ...emptyState(),
    tasks: [
      {
        ...task,
        title: 'Newer',
        deletedAt: '2026-10-19T10:00:00.000Z',
        updatedAt: '2026-10-19T10:00:00.000Z',
      },
    ],
  };
  const merged = mergeImport(local, incoming);
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.tasks[0].title, 'Newer');
  assert.ok(merged.tasks[0].deletedAt);
  assert.equal(merged.settings.theme, 'dark');
  assert.equal(mergeImport(merged, local).tasks[0].title, 'Newer');
  assert.deepEqual(mergeImport(merged, incoming), merged);
});
test('malformed imports reject duplicate IDs, orphan lists, unknown versions and invalid dates', () => {
  const task = newTask('Test');
  const valid = { ...emptyState(), tasks: [task] };
  for (const value of [
    { ...valid, tasks: [task, task] },
    { ...valid, lists: [{ id: 'other', name: 'Other', color: '#123456', order: 0 }] },
    { ...valid, version: 3 },
    { ...valid, tasks: [{ ...task, dates: { ['2026-02-30']: null } }] },
  ])
    assert.throws(() => mergeImport(emptyState(), value));
  assert.deepEqual(stateSchema.parse(valid), valid);
});
test('statistics use actual completion dates rather than due dates and exclude trashed tasks', () => {
  const completed = new Date(2026, 9, 19, 12).toISOString();
  const s = {
    ...emptyState(),
    tasks: [
      newTask('Done', { dates: { ['2026-10-10']: null }, completedAt: completed }),
      newTask('Trash', { completedAt: completed, deletedAt: completed }),
    ],
    sessions: [{ id: 'focus', taskId: null, title: 'Focus', minutes: 25, completedAt: completed }],
  };
  const stats = statistics(s, '2026-10-19');
  assert.equal(stats.length, 7);
  assert.equal(stats.at(-1)?.completed, 1);
  assert.equal(stats.at(-1)?.minutes, 25);
});
