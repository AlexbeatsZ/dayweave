import { setTimeZone } from '../src/timezone';
setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  dateSchema,
  emptyState,
  finishTimer,
  mergeImport,
  newTask,
  nextRepeatDate,
  quadrant,
  remainingSeconds,
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
test('monthly repeats preserve the original anchor through short months', () => {
  const task = newTask('Monthly', { due: '2026-01-31', repeat: 'monthly', repeatDay: 31 });
  assert.equal(nextRepeatDate(task), '2026-02-28');
  assert.equal(nextRepeatDate({ ...task, due: '2026-02-28' }), '2026-03-31');
  assert.equal(nextRepeatDate({ ...task, due: '2028-01-31' }), '2028-02-29');
});
test('completing a recurring task once, undoing and re-completing does not duplicate the next occurrence', () => {
  const task = newTask('Repeat', {
    due: '2026-10-19',
    repeat: 'weekly',
    tags: ['test'],
    subtasks: [{ id: 'sub', title: 'Step', done: true }],
  });
  const base = { ...emptyState(), tasks: [task] };
  const done = toggleTask(base, task.id);
  assert.equal(done.tasks.length, 2);
  const child = done.tasks.find((t) => t.parentId === task.id)!;
  assert.equal(child.due, '2026-10-26');
  assert.equal(child.subtasks[0].done, false);
  assert.notEqual(child.subtasks[0].id, 'sub');
  assert.equal(done.tasks[0].spawnedId, child.id);
  const undone = toggleTask(done, task.id);
  assert.equal(undone.tasks[0].completedAt, null);
  assert.equal(toggleTask(undone, task.id).tasks.length, 2);
  const deletedNext = {
    ...undone,
    tasks: undone.tasks.map((t) =>
      t.id === child.id ? { ...t, deletedAt: new Date().toISOString() } : t,
    ),
  };
  assert.equal(toggleTask(deletedNext, task.id).tasks.length, 2);
});
test('non-recurring and deleted tasks do not spawn follow-ups', () => {
  const task = newTask('One time');
  const state = { ...emptyState(), tasks: [task] };
  assert.equal(toggleTask(state, task.id).tasks.length, 1);
  const deleted = { ...state, tasks: [{ ...task, deletedAt: new Date().toISOString() }] };
  assert.equal(toggleTask(deleted, task.id), deleted);
});
test('filters distinguish unscheduled tasks, today including overdue, the next seven days, and trash', () => {
  const tasks = [
    newTask('Overdue', { due: '2026-10-18' }),
    newTask('Today', { due: '2026-10-19' }),
    newTask('Later', { due: '2026-10-25' }),
    newTask('Too far', { due: '2026-10-26' }),
    newTask('Inbox'),
    newTask('Deleted', { deletedAt: new Date().toISOString() }),
  ];
  const s = { ...emptyState(), tasks };
  assert.deepEqual(
    selectTasks(s, 'today', '', 'manual', '2026-10-19').map((t) => t.title),
    ['Overdue', 'Today'],
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
test('quadrants derive importance from priority and urgency from the local date', () => {
  assert.equal(quadrant(newTask('A', { priority: 1, due: '2026-10-18' }), '2026-10-19'), 0);
  assert.equal(quadrant(newTask('B', { priority: 2, due: '2026-10-20' }), '2026-10-19'), 1);
  assert.equal(quadrant(newTask('C', { priority: 3, due: '2026-10-19' }), '2026-10-19'), 2);
  assert.equal(quadrant(newTask('D'), '2026-10-19'), 3);
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
    { ...valid, version: 2 },
    { ...valid, tasks: [{ ...task, due: '2026-02-30' }] },
  ])
    assert.throws(() => mergeImport(emptyState(), value));
  assert.deepEqual(stateSchema.parse(valid), valid);
});
test('timer survives elapsed wall-clock time and records exactly once at the scheduled end time', () => {
  const end = Date.parse('2026-10-19T12:00:00.000Z');
  const timer = {
    id: 'timer',
    taskId: null,
    title: 'Deep work',
    kind: 'focus' as const,
    duration: 1500,
    remaining: 1500,
    endAt: end,
  };
  const state = { ...emptyState(), timer };
  assert.equal(remainingSeconds(timer, end - 1001), 2);
  const done = finishTimer(state, end + 3600000);
  assert.equal(done.timer, null);
  assert.equal(done.sessions.length, 1);
  assert.equal(done.sessions[0].minutes, 25);
  assert.equal(done.sessions[0].completedAt, '2026-10-19T12:00:00.000Z');
  assert.equal(finishTimer(done, end + 3600000), done);
  assert.equal(finishTimer({ ...state, sessions: done.sessions }, end + 1).sessions.length, 1);
});
test('paused timers and breaks do not create focus credit', () => {
  const timer = {
    id: 'timer',
    taskId: null,
    title: 'Rest',
    kind: 'break' as const,
    duration: 300,
    remaining: 100,
    endAt: null,
  };
  const state: AppState = { ...emptyState(), timer };
  assert.equal(remainingSeconds(timer, Date.now() + 999999), 100);
  assert.equal(finishTimer(state), state);
  assert.equal(finishTimer({ ...state, timer: { ...timer, endAt: 1 } }).sessions.length, 0);
});
test('statistics use actual completion dates rather than due dates and exclude trashed tasks', () => {
  const completed = new Date(2026, 9, 19, 12).toISOString();
  const s = {
    ...emptyState(),
    tasks: [
      newTask('Done', { due: '2026-10-10', completedAt: completed }),
      newTask('Trash', { completedAt: completed, deletedAt: completed }),
    ],
    sessions: [{ id: 'focus', taskId: null, title: 'Focus', minutes: 25, completedAt: completed }],
  };
  const stats = statistics(s, '2026-10-19');
  assert.equal(stats.length, 7);
  assert.equal(stats.at(-1)?.completed, 1);
  assert.equal(stats.at(-1)?.minutes, 25);
});
