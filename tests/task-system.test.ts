import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  emptyState,
  newTask,
  copyTask,
  stateSchema,
  taskPrefix,
  taskSequence,
  repeatingTaskIds,
  taskOverview,
  selectTasks,
  newPlanGroup,
  deletePlanGroup,
  taskPlanGroup,
  taskCompleted,
  taskDoneOn,
  taskCompletedOnDay,
  changeSubtask,
  normalizeTaskChanges,
  mergeImport,
  toggleTask,
  subtaskDay,
  taskDaySubtasks,
  type AppState,
} from '../src/model.js';
import { seal } from '../src/sync/crypto.js';
import { setDayStart, setTimeZone, businessDayStart, businessDateKey } from '../src/timezone.js';
import { configureRepeat, generateRepeatedTasks, validateCron } from '../src/task-repeat.js';
import {
  fromDocument,
  mergeDocuments,
  overlayNewEdits,
  toDocument,
  migrateLegacyDocument,
} from '../src/sync/document.js';
import { applyDelta, diffState, StateConflict } from '../src/state-delta.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';
import { startApi } from '../electron/api.js';
import { DesktopSync } from '../electron/sync.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';

setTimeZone('Asia/Shanghai');
setDayStart('04:00');
const today = '2026-11-05',
  at = Date.parse('2026-11-05T08:00:00Z');
const baseTask = () =>
  newTask('复习生物化学', {
    dates: { '2026-11-04': null, [today]: null },
    estimatedMinutes: 120,
    actualMinutes: 10,
    difficulty: 'hard',
    tags: ['复习'],
    subtasks: [
      { id: 'dna', title: 'DNA 复制', done: false },
      { id: 'rna', title: '转录', done: false },
    ],
  });
const withTask = (task = baseTask()): AppState => ({
  ...emptyState(),
  settings: { ...emptyState().settings, dayStartsAt: '04:00' },
  tasks: [task],
});
const merge = (base: AppState, incoming: AppState, hub: AppState) =>
  fromDocument(mergeDocuments(toDocument(base), toDocument(incoming), toDocument(hub)).doc, hub);

test('finite dates expire without changing data; infinity and inbox have distinct membership', () => {
  const state = withTask();
  state.tasks.push(
    newTask('只在昨天', { dates: { '2026-11-04': null } }),
    newTask('长期', { dates: { '∞': null } }),
    newTask('待办'),
  );
  const before = structuredClone(state);
  assert.deepEqual(
    selectTasks(state, 'all', '', 'manual', today).map((row) => row.title),
    ['复习生物化学', '长期'],
  );
  assert.deepEqual(
    selectTasks(state, 'today', '', 'manual', today).map((row) => row.title),
    ['复习生物化学'],
  );
  assert.deepEqual(
    selectTasks(state, 'inbox').map((row) => row.title),
    ['待办'],
  );
  assert.equal(selectTasks(state, 'all', '', 'manual', '2026-11-06').length, 1);
  assert.equal(selectTasks(state, 'all', '只在昨天').length, 1);
  assert.deepEqual(state, before);
  assert.throws(() =>
    stateSchema.parse({ ...state, tasks: [newTask('错', { dates: { '∞': 'slot' } })] }),
  );
});
test('a copy has a new prefix, fresh children and retains the task’s independent planning fields', () => {
  const state = withTask();
  const original = toggleTask(state, state.tasks[0].id).tasks[0];
  const copied = copyTask(original);
  assert.notEqual(taskPrefix(copied.id), taskPrefix(original.id));
  assert.equal(taskSequence(copied.id), 0);
  assert.deepEqual(copied.dates, original.dates);
  assert.equal(copied.difficulty, original.difficulty);
  assert.equal(copied.estimatedMinutes, original.estimatedMinutes);
  assert.equal(copied.actualMinutes, null);
  assert.equal(copied.completedAt, null);
  assert.equal(copied.history.length, 0);
  assert.notEqual(copied.subtasks[0].id, original.subtasks[0].id);
});

test('overview advances through eligible instances in numeric ID order, including an older instance rescheduled to today', () => {
  const state = emptyState();
  state.tasks = [
    newTask('同名任务', { id: 'series-10', dates: { [today]: null }, order: 0, pinned: true }),
    newTask('同名任务', { id: 'series-2', dates: { '2026-11-09': null }, order: 20 }),
    newTask('昨天没完成', { id: 'series-1', dates: { '2026-11-04': null } }),
    newTask('已完成', {
      id: 'series-0',
      dates: { [today]: null },
      completedAt: new Date(at).toISOString(),
    }),
    newTask('已删除', {
      id: 'series-3',
      dates: { [today]: null },
      deletedAt: new Date(at).toISOString(),
    }),
    newTask('只待定的实例', { id: 'series-4', dates: { '∞': null } }),
    newTask('无日期实例', { id: 'series-5' }),
    newTask('同名任务', { id: 'independent-0', dates: { '∞': null }, order: 10 }),
    newTask('同名任务', { id: 'another-0', dates: { [today]: null }, order: 30 }),
  ];
  const snapshot = structuredClone(state);
  const visible = () =>
    taskOverview(
      selectTasks(state, 'all', '', 'date', today),
      today,
      repeatingTaskIds(state.tasks),
    ).map((task) => task.id);
  assert.deepEqual(visible(), ['another-0', 'series-2', 'independent-0']);
  assert.deepEqual(state, snapshot);
  state.tasks.find((task) => task.id === 'series-1')!.dates[today] = null;
  assert.equal(visible().filter((id) => id.startsWith('series-'))[0], 'series-1');
  state.tasks = toggleTask(state, 'series-1').tasks;
  assert.equal(visible().filter((id) => id.startsWith('series-'))[0], 'series-2');
  state.tasks = toggleTask(state, 'series-2').tasks;
  assert.equal(visible().filter((id) => id.startsWith('series-'))[0], 'series-10');
  state.tasks = toggleTask(state, 'series-10').tasks;
  assert.deepEqual(visible(), ['another-0', 'independent-0']);
  assert.equal(state.tasks.length, snapshot.tasks.length);
  assert.equal(state.repeatRules.length, 0);
});

test('only a higher sequence in the same series marks a task as repeating, independently of repeat rules', () => {
  let state = emptyState();
  const first = newTask('第一项', { id: 'loop-0', dates: { '∞': null } });
  state.tasks = [first];
  state = configureRepeat(state, first, '0 4 * * *');
  assert.deepEqual([...repeatingTaskIds(state.tasks)], []);
  assert.deepEqual(taskOverview(state.tasks, today, repeatingTaskIds(state.tasks)), [first]);
  const last = newTask('最后一项', { id: 'loop-2', dates: { [today]: null } });
  state.tasks.push(last, newTask('同名任务', { id: 'independent-10', dates: { [today]: null } }));
  state.repeatRules = [];
  const repeating = repeatingTaskIds(state.tasks);
  assert.deepEqual([...repeating], ['loop-0']);
  assert.deepEqual(
    taskOverview(state.tasks, today, repeating).map((task) => task.id),
    ['loop-2', 'independent-10'],
  );
  first.dates[today] = null;
  assert.deepEqual(
    taskOverview(state.tasks, today, repeating).map((task) => task.id),
    ['loop-0', 'independent-10'],
  );
  assert.deepEqual(
    taskOverview(state.tasks, '2026-11-06', repeating).map((task) => task.id),
    [],
  );
});

test('thirty precreated instances without Cron end after the thirtieth completion', () => {
  let state = emptyState();
  state.tasks = Array.from({ length: 30 }, (_, index) =>
    newTask('有限循环', {
      id: `finite-${index}`,
      dates: { [today]: null },
      order: 30 - index,
    }),
  );
  for (let index = 0; index < 30; index++) {
    const repeating = repeatingTaskIds(state.tasks);
    const visible = taskOverview(state.tasks, today, repeating);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, `finite-${index}`);
    assert.equal(repeating.has(visible[0].id), index < 29);
    state = toggleTask(state, visible[0].id);
  }
  assert.deepEqual(taskOverview(state.tasks, today, repeatingTaskIds(state.tasks)), []);
  assert.equal(state.tasks.length, 30);
  assert.equal(state.repeatRules.length, 0);
});

test('multiple days keep independent slots and invalid/deleted slots lose only their reference', () => {
  let state = withTask();
  const a = newPlanGroup('2026-11-04', {
    title: '午饭前',
    minutes: 60,
    until: '12:00',
    note: '保留',
  });
  const b = newPlanGroup(today, { title: '睡前', until: '02:00' });
  state.planGroups = [a, b];
  state.tasks[0].dates = { [a.date]: a.id, [b.date]: b.id };
  assert.equal(taskPlanGroup(state, state.tasks[0], a.date)?.id, a.id);
  assert.equal(taskPlanGroup(state, state.tasks[0], b.date)?.id, b.id);
  state = deletePlanGroup(state, a.id);
  assert.deepEqual(state.tasks[0].dates, { [a.date]: null, [b.date]: b.id });
  state.tasks[0].dates['2026-11-06'] = b.id;
  assert.deepEqual(stateSchema.parse(state).tasks[0].dates, {
    [a.date]: null,
    [b.date]: b.id,
    '2026-11-06': null,
  });
  assert.equal(state.tasks[0].estimatedMinutes, 120);
  assert.equal(state.tasks[0].difficulty, 'hard');
});

test('subtask transitions complete/reopen the parent, and parent transitions affect every live child', () => {
  let state = withTask();
  const id = state.tasks[0].id;
  state.tasks[0] = changeSubtask(state.tasks[0], 'dna', { done: true }, '2026-11-04T08:00:00.000Z');
  assert.equal(taskCompleted(state.tasks[0]), false);
  state.tasks[0] = changeSubtask(state.tasks[0], 'rna', { done: true }, '2026-11-05T08:00:00.000Z');
  assert.equal(state.tasks[0].completedAt, '2026-11-05T08:00:00.000Z');
  state = toggleTask(state, id);
  assert.equal(taskCompleted(state.tasks[0]), false);
  assert.ok(state.tasks[0].subtasks.every((row) => !row.done && !row.completedAt));
  state = toggleTask(state, id);
  assert.ok(state.tasks[0].subtasks.every((row) => row.done && row.completedAt));
  const next = structuredClone(state);
  next.tasks[0].subtasks.push({
    ...newTask('草稿', { subtasks: [{ id: 'new', title: '新章节', done: false }] }).subtasks[0],
  });
  state = normalizeTaskChanges(next, state);
  assert.equal(taskCompleted(state.tasks[0]), false);
  state = withTask(newTask('无子任务'));
  assert.equal(taskCompleted(state.tasks[0]), false);
  assert.equal(taskCompleted(toggleTask(state, state.tasks[0].id).tasks[0]), true);
});

test('historic completion facts survive later completion, undo, and deletion; no unknown time is invented', () => {
  let task = baseTask();
  task = changeSubtask(task, 'dna', { done: true }, '2026-11-04T08:00:00.000Z');
  task = changeSubtask(task, 'rna', { done: true }, '2026-11-05T08:00:00.000Z');
  assert.deepEqual(
    taskDaySubtasks(task, '2026-11-04', today).map((row) => row.id),
    ['dna'],
  );
  assert.equal(subtaskDay(task.subtasks[1], '2026-11-04'), null);
  task = changeSubtask(task, 'dna', { done: false }, '2026-11-05T09:00:00.000Z');
  task = changeSubtask(task, 'dna', { deletedAt: '2026-11-05T10:00:00.000Z' });
  assert.equal(subtaskDay(task.subtasks[0], '2026-11-04'), true);
  assert.equal(subtaskDay(task.subtasks[0], today), false);
  assert.equal(taskDoneOn(task, '2026-11-04'), false);
  const unknown = newTask('旧完成', { subtasks: [{ id: 'unknown', title: '未知', done: true }] });
  const parsed = stateSchema.parse(withTask(unknown)).tasks[0];
  assert.equal(parsed.subtasks[0].completedAt, null);
  assert.deepEqual(parsed.subtasks[0].history, []);
  assert.equal(taskCompleted(parsed), true);
  assert.equal(taskDaySubtasks(parsed, '2026-11-04', today).length, 0);
});

test('completion at 02:00 follows the selected business day', () => {
  const task = changeSubtask(baseTask(), 'dna', { done: true }, '2026-11-04T18:00:00.000Z');
  assert.equal(subtaskDay(task.subtasks[0], '2026-11-04'), true);
  assert.equal(subtaskDay(task.subtasks[0], today), null);
});
test('completion statistics retain the original day after a later undo', () => {
  let task = baseTask();
  task = changeSubtask(task, 'dna', { done: true }, '2026-11-04T08:00:00.000Z');
  task = changeSubtask(task, 'rna', { done: true }, '2026-11-04T09:00:00.000Z');
  task = changeSubtask(task, 'rna', { done: false }, '2026-11-05T08:00:00.000Z');
  assert.equal(taskCompletedOnDay(task, '2026-11-04'), true);
  assert.equal(taskDoneOn(task, '2026-11-04'), true);
  assert.equal(taskDoneOn(task, today), false);
});

test('hub daily generation is ahead of completion, serializable, idempotent and preserves edited instances', () => {
  const task = newTask('背单词', {
    dates: { [today]: null },
    difficulty: 'medium',
    estimatedMinutes: 20,
  });
  let state = configureRepeat(withTask(task), task, '0 4 * * *');
  state = generateRepeatedTasks(state, '2026-11-12', at);
  assert.equal(state.tasks.length, 8);
  assert.ok(state.tasks.every((row) => !row.completedAt));
  assert.deepEqual(
    state.tasks.map((row) => taskSequence(row.id)),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  const next = state.tasks[1];
  next.title = '这一次单独修改';
  next.notes = '自己的描述';
  next.deletedAt = new Date(at).toISOString();
  const restarted = stateSchema.parse(JSON.parse(JSON.stringify(state)));
  const again = generateRepeatedTasks(restarted, '2026-11-12', at);
  assert.deepEqual(again, restarted);
  const extended = generateRepeatedTasks(again, '2026-11-13', at);
  assert.equal(extended.tasks.length, 9);
  assert.equal(extended.tasks[8].title, '背单词');
  assert.equal(extended.tasks[8].difficulty, 'medium');
  assert.equal(extended.tasks[8].actualMinutes, undefined);
  assert.equal(extended.repeatRules[0].template.title, '背单词');
  assert.equal(extended.tasks[1].notes, '自己的描述');
  const stopped = configureRepeat(extended, task, null);
  assert.equal(generateRepeatedTasks(stopped, '2026-11-20', at).tasks.length, 9);
});

test('one Monday trigger produces one ordinary task with three dates', () => {
  const monday = '2026-11-02';
  const task = newTask('每周实验', {
    dates: { [monday]: null, '2026-11-03': null, '2026-11-04': null },
  });
  const state = generateRepeatedTasks(
    configureRepeat(withTask(task), task, '0 4 * * 1', [0, 1, 2]),
    '2026-11-16',
    at,
  );
  assert.equal(state.tasks.length, 3);
  assert.deepEqual(state.tasks[1].dates, {
    '2026-11-09': null,
    '2026-11-10': null,
    '2026-11-11': null,
  });
  assert.equal(new Set(state.tasks.map((row) => taskPrefix(row.id))).size, 1);
});

test('backup import retains newer repeat templates and unions generation ledgers without rewinding a changed schedule', () => {
  const task = newTask('重复模板', { dates: { [today]: null } });
  const initial = configureRepeat(withTask(task), task, '0 4 * * *');
  const local = generateRepeatedTasks(initial, '2026-11-08', at);
  const incoming = generateRepeatedTasks(initial, '2026-11-07', at);
  incoming.repeatRules[0].template.title = '更新后的模板';
  incoming.repeatRules[0].updatedAt = '2026-11-05T09:00:00.000Z';
  incoming.repeatRules[0].occurrences['2026-11-04T04:00'] = task.id;
  const merged = mergeImport(local, incoming);
  assert.equal(merged.repeatRules[0].template.title, '更新后的模板');
  assert.equal(merged.repeatRules[0].generatedThrough, local.repeatRules[0].generatedThrough);
  assert.deepEqual(merged.repeatRules[0].occurrences, {
    ...local.repeatRules[0].occurrences,
    ...incoming.repeatRules[0].occurrences,
  });
  assert.deepEqual(mergeImport(merged, incoming), merged);
  assert.equal(generateRepeatedTasks(merged, '2026-11-08', at).tasks.length, merged.tasks.length);
  const rescheduled = structuredClone(incoming);
  rescheduled.repeatRules[0].cron = '0 4 * * 1';
  rescheduled.repeatRules[0].startAt = '2026-11-05T10:00:00.000Z';
  rescheduled.repeatRules[0].updatedAt = '2026-11-05T10:00:00.000Z';
  rescheduled.repeatRules[0].generatedThrough = null;
  const restored = mergeImport(merged, rescheduled);
  assert.equal(restored.repeatRules[0].cron, '0 4 * * 1');
  assert.equal(restored.repeatRules[0].generatedThrough, null);
  assert.ok(restored.repeatRules[0].occurrences['2026-11-08T04:00']);
});

test('Cron observes IANA DST and fixed offsets without a competing local date engine', () => {
  for (const [zone, first, through] of [
    ['America/New_York', '2026-03-07', '2026-03-10'],
    ['America/New_York', '2026-10-31', '2026-11-03'],
    ['-04:00', '2026-03-07', '2026-03-10'],
  ]) {
    const state = withTask(newTask('DST', { dates: { [first]: null } }));
    state.settings.timeZone = zone;
    const configured = configureRepeat(state, state.tasks[0], '30 4 * * *');
    const generated = generateRepeatedTasks(
      configured,
      through,
      businessDayStart(first, zone, '04:00') + 3600000,
    );
    assert.equal(generated.tasks.length, 4);
    assert.equal(Object.keys(generated.repeatRules[0].occurrences).length, 4);
    assert.equal(new Set(generated.tasks.flatMap((row) => Object.keys(row.dates))).size, 4);
  }
  for (const invalid of ['* * * * * *', 'H 4 * * *', '@daily', '0 4 1 * 1', '0 4 30 2 *'])
    assert.throws(() => validateCron(invalid));
});

test('three-way merges retain independent subtask additions, nested edits, date additions and deletions', () => {
  const base = withTask();
  const left = structuredClone(base),
    right = structuredClone(base);
  left.tasks[0].subtasks.push(
    newTask('x', { subtasks: [{ id: 'left', title: '手机新增', done: false }] }).subtasks[0],
  );
  right.tasks[0].subtasks.push(
    newTask('x', { subtasks: [{ id: 'right', title: 'AI 新增', done: false }] }).subtasks[0],
  );
  left.tasks[0].subtasks[0].title = '手机修改标题';
  right.tasks[0] = changeSubtask(right.tasks[0], 'dna', { done: true }, '2026-11-05T08:00:00.000Z');
  delete left.tasks[0].dates['2026-11-04'];
  left.tasks[0].dates['2026-11-06'] = null;
  right.tasks[0].dates['2026-11-07'] = null;
  const saved = merge(base, left, right);
  assert.deepEqual(
    saved.tasks[0].subtasks.map((row) => row.id).sort(),
    ['dna', 'rna', 'left', 'right'].sort(),
  );
  assert.equal(saved.tasks[0].subtasks[0].title, '手机修改标题');
  assert.equal(saved.tasks[0].subtasks[0].done, true);
  assert.deepEqual(saved.tasks[0].dates, { [today]: null, '2026-11-06': null, '2026-11-07': null });
  const localSave = applyDelta(right, diffState(base, left));
  assert.deepEqual(localSave.tasks[0].dates, saved.tasks[0].dates);
});

test('different dates can independently select slots and in-flight overlay retains their edits', () => {
  const base = withTask(),
    left = structuredClone(base),
    right = structuredClone(base);
  const a = newPlanGroup('2026-11-04', { title: '一' }),
    b = newPlanGroup(today, { title: '二' });
  for (const state of [base, left, right]) state.planGroups = [a, b];
  left.tasks[0].dates[a.date] = a.id;
  right.tasks[0].dates[b.date] = b.id;
  assert.deepEqual(merge(base, left, right).tasks[0].dates, { [a.date]: a.id, [b.date]: b.id });
  const overlay = fromDocument(
    overlayNewEdits(toDocument(base), toDocument(left), toDocument(right)),
    base,
  );
  assert.deepEqual(overlay.tasks[0].dates, { [a.date]: a.id, [b.date]: b.id });
});

test('same-field LWW follows acceptance order instead of local clocks; local optimistic conflicts still reject', () => {
  const base = withTask(),
    a = structuredClone(base),
    b = structuredClone(base);
  a.tasks[0].title = '先提交';
  a.tasks[0].updatedAt = '2199-01-01T00:00:00.000Z';
  b.tasks[0].title = '后提交';
  b.tasks[0].updatedAt = '2000-01-01T00:00:00.000Z';
  assert.equal(merge(base, b, a).tasks[0].title, '后提交');
  assert.throws(() => applyDelta(a, diffState(base, b)), StateConflict);
});

test('task/subtask deletion defeats stale edits, explicit restore works, and completion is recalculated', () => {
  const base = withTask(),
    deleted = structuredClone(base),
    edited = structuredClone(base);
  deleted.tasks[0].deletedAt = new Date(at).toISOString();
  edited.tasks[0].notes = '旧设备修改';
  assert.ok(merge(base, edited, deleted).tasks[0].deletedAt);
  assert.ok(merge(base, deleted, edited).tasks[0].deletedAt);
  const restored = structuredClone(deleted);
  restored.tasks[0].deletedAt = null;
  assert.equal(merge(deleted, restored, deleted).tasks[0].deletedAt, null);
  const complete = toggleTask(base, base.tasks[0].id),
    add = structuredClone(base);
  add.tasks[0].subtasks.push(
    newTask('x', { subtasks: [{ id: 'new', title: '新增', done: false }] }).subtasks[0],
  );
  assert.equal(taskCompleted(merge(base, add, complete).tasks[0]), false);
  assert.equal(taskCompleted(merge(base, complete, add).tasks[0]), false);
  deleted.tasks[0].subtasks[0].deletedAt = new Date(at).toISOString();
  edited.tasks[0].subtasks[0].title = '离线改名';
  assert.ok(merge(base, edited, deleted).tasks[0].subtasks[0].deletedAt);
  const removed = structuredClone(base);
  removed.tasks[0].subtasks.splice(0, 1);
  assert.ok(
    merge(base, removed, edited).tasks[0].subtasks.find((row) => row.id === 'dna')?.deletedAt,
  );
});

const legacyTask = (id: string, parentId: string | null = null) => {
  const { dates, difficulty, history, ...task } = newTask('同名旧任务', {
    id,
    subtasks: [{ id: 'sub', title: '旧子任务', done: true }],
    estimatedMinutes: 50,
    actualMinutes: 60,
  });
  return {
    ...task,
    due: parentId ? '2026-11-06' : today,
    planGroupId: undefined,
    repeat: 'daily',
    repeatDay: 5,
    parentId,
    spawnedId: parentId ? null : 'child',
    priority: 1,
    effort: 'large',
  };
};
test('v1 migration preserves all tasks/references, exact subtask IDs and unknown dates, with easy difficulty', () => {
  const legacy = {
    ...emptyState(),
    version: 1,
    tasks: [
      legacyTask('root'),
      legacyTask('child', 'root'),
      { ...legacyTask('unrelated'), repeat: 'none', spawnedId: null },
    ],
    sessions: [
      {
        id: 'session',
        taskId: 'root',
        title: '记录',
        minutes: 25,
        completedAt: new Date(at).toISOString(),
      },
    ],
  };
  const timer = {
    id: 'open',
    activityId: 'study',
    note: '正在计时',
    tags: [],
    nature: 'positive' as const,
    startedAt: at,
    runningSince: at,
    spans: [],
    taskId: 'root',
  };
  legacy.timelog = {
    ...legacy.timelog,
    records: [
      {
        id: 'record',
        activityId: 'study',
        note: '已记录',
        tags: [],
        nature: 'positive',
        spans: [{ start: at - 60000, end: at }],
        updatedAt: at,
        deletedAt: null,
        taskId: 'child',
      },
    ],
    timer,
    conflictedTimers: [{ ...timer, id: 'other-timer', taskId: 'unrelated' }],
  };
  const migrated = stateSchema.parse(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.tasks.length, 3);
  assert.equal(migrated.sessions[0].taskId, migrated.tasks[0].id);
  assert.equal(migrated.timelog.records[0].taskId, migrated.tasks[1].id);
  assert.equal(migrated.timelog.timer?.taskId, migrated.tasks[0].id);
  assert.equal(migrated.timelog.conflictedTimers?.[0].taskId, migrated.tasks[2].id);
  assert.equal(taskPrefix(migrated.tasks[0].id), taskPrefix(migrated.tasks[1].id));
  assert.notEqual(taskPrefix(migrated.tasks[0].id), taskPrefix(migrated.tasks[2].id));
  assert.deepEqual(
    migrated.tasks.map((row) => taskSequence(row.id)),
    [0, 1, 0],
  );
  assert.ok(
    migrated.tasks.every(
      (row) => row.difficulty === 'easy' && row.estimatedMinutes === 50 && row.actualMinutes === 60,
    ),
  );
  assert.ok(
    migrated.tasks.every(
      (row) =>
        row.subtasks[0].id === 'sub' &&
        row.subtasks[0].completedAt === null &&
        !row.subtasks[0].history.length,
    ),
  );
  assert.equal(migrated.repeatRules.length, 1);
  assert.equal(Object.keys(migrated.repeatRules[0].occurrences).length, 2);
  assert.deepEqual(stateSchema.parse(migrated), migrated);
  assert.deepEqual(stateSchema.parse(legacy), migrated);
  const oldDoc: ReturnType<typeof toDocument> = { ...toDocument(emptyState()) };
  for (const task of legacy.tasks) oldDoc[`tasks/${task.id}`] = task;
  oldDoc['sessions/session'] = legacy.sessions[0];
  const baseline = fromDocument(migrateLegacyDocument(oldDoc), emptyState());
  assert.deepEqual(
    baseline.tasks.map((row) => row.id),
    migrated.tasks.map((row) => row.id),
  );
  assert.equal(baseline.sessions[0].taskId, migrated.tasks[0].id);
  assert.throws(() =>
    stateSchema.parse({ ...legacy, tasks: [legacyTask('a', 'b'), legacyTask('b', 'a')] }),
  );
  assert.throws(() =>
    stateSchema.parse({
      ...legacy,
      tasks: [legacyTask('a'), legacyTask('b', 'a'), legacyTask('c', 'a')],
    }),
  );
});

test('real API and encrypted hub serialize generation across restart, expose incremental child writes and reject v1 protocol', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-tasks-v2-'));
  let service = new StateService(new FileStore(directory));
  let hub = new DesktopSync(service, directory, false);
  await hub.initialize();
  await hub.enableHub(0);
  const api = await startApi(service, 0, () => hub);
  const request = (method: string, route: string, body?: unknown, revision?: string) =>
    fetch(api.info.url + route, {
      method,
      headers: {
        Authorization: `Bearer ${api.info.token}`,
        'Content-Type': 'application/json',
        ...(revision ? { 'If-Match': revision } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const task = (
      await (
        await request('POST', '/tasks', {
          title: 'API',
          dates: { [businessDateKey()]: null },
          difficulty: 'hard',
        })
      ).json()
    ).data;
    let response = await request('POST', `/tasks/${task.id}/subtasks`, {
      id: 'a',
      title: '第一项',
    });
    assert.equal(response.status, 200);
    response = await request('POST', `/tasks/${task.id}/subtasks`, { id: 'b', title: '第二项' });
    assert.equal(response.status, 200);
    await request('PATCH', `/tasks/${task.id}/subtasks/a`, { done: true });
    await request('PATCH', `/tasks/${task.id}/subtasks/b`, { done: true });
    assert.ok((await (await request('GET', `/tasks/${task.id}`)).json()).data.completedAt);
    await request('PATCH', `/tasks/${task.id}/subtasks/a`, { done: false });
    assert.equal((await (await request('GET', `/tasks/${task.id}`)).json()).data.completedAt, null);
    response = await request('PUT', `/tasks/${task.id}/repeat`, {
      cron: '0 4 * * *',
      dateOffsets: [0],
    });
    assert.equal(response.status, 200);
    const through = businessDateKey(Date.now() + 21 * 86400000);
    await Promise.all(Array.from({ length: 3 }, () => hub.ensureTasks(through)));
    const before = (await service.snapshot()).state;
    assert.ok(before.tasks.length >= 21);
    const clientState = withTask(newTask('离线'));
    let local = clientState;
    const client = new SyncClient(
      { read: async () => null, write: async () => {} },
      {
        snapshot: async () => ({ state: local }),
        mutate: async (transform) => {
          local = transform(local);
        },
      },
      fetchEnvelope,
      'v2 client',
    );
    await client.load();
    await client.pair(await hub.invite(), `http://127.0.0.1:${hub.client.config.hub!.port}`);
    await client.now();
    assert.equal(client.connected, true, client.error);
    assert.equal(local.tasks.length, before.tasks.length + 1);
    const oldEnvelope = await seal(
      { seq: client.config.seq + 1 },
      client.config.key!,
      '/sync',
      client.config.deviceId,
    );
    const rejected = await fetch(`http://127.0.0.1:${hub.client.config.hub!.port}/sync`, {
      method: 'POST',
      body: JSON.stringify(oldEnvelope),
    });
    assert.equal(rejected.status, 409);
    await client.now();
    assert.equal(client.connected, true, client.error);
    await api.close();
    await hub.close();
    service.dispose();
    await service.flush();
    service = new StateService(new FileStore(directory));
    hub = new DesktopSync(service, directory, false);
    await hub.initialize();
    await hub.ensureTasks(through);
    const after = (await service.snapshot()).state;
    assert.equal(
      after.tasks.filter((row) => taskPrefix(row.id) === taskPrefix(task.id)).length,
      before.tasks.length,
    );
    assert.deepEqual(after.repeatRules[0].occurrences, before.repeatRules[0].occurrences);
  } finally {
    await api.close().catch(() => {});
    await hub.close();
    service.dispose();
    await service.flush();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the first v1 file and sync baseline survive migration with pairing, sequences and conflict candidates intact', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-migrate-v2-'));
  try {
    const source = {
      ...emptyState(),
      version: 1,
      tasks: [{ ...legacyTask('legacy'), repeat: 'none', spawnedId: null }],
    };
    const raw = JSON.stringify(source);
    await writeFile(path.join(directory, 'data.json'), raw);
    const storage = new FileStore(directory);
    const state = (await storage.load()).state;
    await storage.save({ ...state, tasks: [{ ...state.tasks[0], notes: '后续修改' }] });
    assert.equal(await readFile(path.join(directory, 'data.before-task-v2.json'), 'utf8'), raw);
    const oldDoc = { ...toDocument(emptyState()), 'tasks/legacy': source.tasks[0] };
    const config = {
      version: 1,
      enabled: true,
      deviceId: 'device',
      name: 'phone',
      seq: 57,
      hubId: 'original-hub',
      key: 'original-pairing-key',
      base: oldDoc,
      conflicts: [
        {
          key: 'tasks/legacy',
          field: 'title',
          local: '保留候选',
          remote: '旧标题',
          reason: '历史冲突',
        },
      ],
    };
    let preserved = '';
    const client = new SyncClient(
      {
        read: async () => JSON.stringify(config),
        write: async () => {},
        preserve: async (value) => {
          preserved = value;
        },
      },
      { snapshot: async () => ({ state }), mutate: async () => {} },
      async () => {
        throw new Error('unused');
      },
      'phone',
    );
    await client.load();
    assert.equal(client.config.seq, 57);
    assert.equal(client.config.key, config.key);
    assert.equal(client.config.hubId, config.hubId);
    assert.equal(preserved, JSON.stringify(config));
    assert.equal(client.config.conflicts.length, 1);
    assert.equal(client.config.conflicts[0].field, '*');
    assert.equal((client.config.conflicts[0].local as { title: string }).title, '保留候选');
    assert.equal(client.config.conflicts[0].key, 'tasks/' + state.tasks[0].id);
    assert.ok(client.config.base?.['tasks/' + state.tasks[0].id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
