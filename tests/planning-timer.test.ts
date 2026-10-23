import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  newTask,
  reorderTasks,
  selectTasks,
  startTaskTimer,
  stateSchema,
} from '../src/model.js';
import { applyDelta, diffState, StateConflict } from '../src/state-delta.js';
import {
  activeActivity,
  adjustTimerStart,
  countdownRemaining,
  deleteActivity,
  duration,
  finishDueTimer,
  nextActivity,
  startTimer,
  toggleTimer,
  validateState,
} from '../src/timelog/domain.js';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document.js';

const start = Date.UTC(2026, 9, 23, 2);

test('inbox follows planned date across lists; natural week includes Monday and Sunday only', () => {
  const state = emptyState();
  state.lists.push({ id: 'research', name: '研究', color: '#123456', order: 1 });
  state.tasks = [
    newTask('未分组无日期'),
    newTask('研究无日期', { listId: 'research' }),
    newTask('周一', { due: '2026-10-19' }),
    newTask('周日', { due: '2026-10-25', listId: 'research' }),
    newTask('下周一', { due: '2026-10-26' }),
    newTask('已删除', { deletedAt: new Date(start).toISOString() }),
  ];
  assert.deepEqual(
    selectTasks(state, 'inbox').map((t) => t.title),
    ['未分组无日期', '研究无日期'],
  );
  state.tasks[1].due = '2026-10-23';
  assert.deepEqual(
    selectTasks(state, 'inbox').map((t) => t.title),
    ['未分组无日期'],
  );
  assert.equal(state.tasks[1].listId, 'research');
  assert.deepEqual(
    selectTasks(state, 'upcoming', '', 'date', '2026-10-23').map((t) => t.title),
    ['周一', '研究无日期', '周日'],
  );
  state.tasks[1].due = null;
  assert.equal(selectTasks(state, 'inbox').length, 2);
});

test('countdown pauses remaining duration, resumes deadline and saves exact planned end once', () => {
  let state = startTimer(emptyState().timelog, 'study', '倒计时', start, {
    plannedEndAt: start + 300000,
    tags: ['复习'],
    taskId: 'task',
  });
  const id = state.timer!.id;
  state = toggleTimer(state, start + 60000);
  assert.equal(countdownRemaining(state.timer!, start + 900000), 240000);
  assert.equal(finishDueTimer(state, start + 900000), state);
  state = toggleTimer(state, start + 900000);
  assert.equal(state.timer!.plannedEndAt, start + 1140000);
  state = finishDueTimer(state, start + 2000000);
  assert.equal(state.timer, null);
  assert.equal(state.records[0].id, id);
  assert.equal(duration(state.records[0].spans), 300000);
  assert.equal(state.records[0].spans.at(-1)!.end, start + 1140000);
  assert.deepEqual(state.records[0].tags, ['复习']);
  assert.equal(state.records[0].taskId, 'task');
  assert.equal(finishDueTimer(state, start + 3000000).records.length, 1);
});

test('adjusting start preserves pauses; next activity atomically saves metadata and shares boundary', () => {
  let state = startTimer(emptyState().timelog, 'study', '阅读', start, {
    tags: ['化学'],
    taskId: 'plan',
  });
  state = toggleTimer(state, start + 60000);
  state = toggleTimer(state, start + 120000);
  state = adjustTimerStart(state, start - 60000, start + 180000);
  const id = state.timer!.id;
  assert.deepEqual(state.timer!.spans, [{ start: start - 60000, end: start + 60000 }]);
  state = nextActivity(state, 'work', start + 180000);
  assert.equal(state.records[0].id, id);
  assert.equal(state.records[0].spans.at(-1)!.end, state.timer!.startedAt);
  assert.equal(duration(state.records[0].spans), 180000);
  assert.equal(state.records[0].note, '阅读');
  assert.equal(state.records[0].taskId, 'plan');
  assert.deepEqual(state.records[0].tags, ['化学']);
  assert.notEqual(state.timer!.id, id);
  assert.equal(state.timer!.activityId, 'work');
  assert.throws(() => adjustTimerStart(state, start + 180001, start + 180000), /晚于/);
});

test('countdown and custom presets survive sync while unrelated timezone edits merge', () => {
  const base = emptyState();
  const a = structuredClone(base),
    b = structuredClone(base);
  a.timelog = startTimer(a.timelog, 'study', '', start, { plannedEndAt: start + 300000 });
  a.timelog.settings = { ...a.timelog.settings, timerPresets: [5, 25, 45], updatedAt: start };
  b.settings.timeZone = '-04:00';
  const restored = fromDocument(
    mergeDocuments(toDocument(base), toDocument(a), toDocument(b)).doc,
    base,
  );
  assert.equal(restored.timelog.timer!.plannedEndAt, start + 300000);
  assert.deepEqual(restored.timelog.settings.timerPresets, [5, 25, 45]);
  assert.equal(restored.settings.timeZone, '-04:00');
  assert.throws(
    () => startTimer(base.timelog, 'study', '', start, { plannedEndAt: start + 999 }),
    /至少/,
  );
  assert.throws(
    () =>
      validateState({
        ...base.timelog,
        settings: { ...base.timelog.settings, timerPresets: [1.5] },
      }),
    /整数/,
  );
});

test('activity deletion removes goals and choices but preserves historical references', () => {
  let state = startTimer(emptyState().timelog, 'study', '历史', start);
  assert.throws(() => deleteActivity(state, 'study'), /先结束/);
  state = nextActivity(state, 'work', start + 60000);
  state.goals.push({
    id: 'study-goal',
    name: '学习',
    activityId: 'study',
    minutes: 30,
    period: 'day',
    archived: false,
    updatedAt: start,
  });
  state = deleteActivity(state, 'study', start + 120000);
  assert.equal(
    state.activities.filter(activeActivity).some((a) => a.id === 'study'),
    false,
  );
  assert.equal(state.goals.length, 0);
  assert.equal(state.records[0].activityId, 'study');
  assert.equal(validateState(state).records.length, 1);
  state = deleteActivity(state, 'exercise', start + 120000);
  assert.equal(
    state.activities.some((a) => a.id === 'exercise'),
    false,
  );
});

test('list defaults start the intended activity and retain the associated task metadata', () => {
  for (const [listName, activityName, nature] of [
    ['学习', '学习', 'positive'],
    ['工作', '实操', 'positive'],
    ['生活', '日常', 'neutral'],
  ] as const) {
    const state = emptyState();
    state.lists.push({ id: 'subject', name: listName, color: '#4488cc', order: 1 });
    state.tasks = [newTask('完成本日计划', { listId: 'subject', tags: ['课程', '准备'] })];
    const next = startTaskTimer(state, state.tasks[0].id, start);
    const timer = next.timelog.timer!;
    const activity = next.timelog.activities.find((item) => item.id === timer.activityId)!;
    assert.equal(activity.name, activityName);
    assert.equal(timer.nature, nature);
    assert.equal(timer.taskId, state.tasks[0].id);
    assert.equal(timer.note, '完成本日计划');
    assert.deepEqual(timer.tags, ['课程', '准备']);
    assert.equal(timer.startedAt, start);
    assert.equal(timer.runningSince, start);
    assert.equal(state.timelog.timer, null);
    assert.equal(stateSchema.safeParse(next).success, true);
    const again = startTaskTimer(
      { ...next, timelog: { ...next.timelog, timer: null } },
      state.tasks[0].id,
      start + 60000,
    );
    assert.equal(again.timelog.timer!.activityId, activity.id);
    assert.equal(
      again.timelog.activities.filter((item) => activeActivity(item) && item.name === activityName)
        .length,
      1,
    );
  }
});

test('explicit list activity mapping overrides defaults and survives renaming the list', () => {
  const state = emptyState();
  state.lists.push({
    id: 'subject',
    name: '学习',
    color: '#4488cc',
    activityId: 'reading',
    order: 1,
  });
  state.tasks = [newTask('阅读文献', { listId: 'subject' })];
  const mapped = startTaskTimer(state, state.tasks[0].id, start);
  assert.equal(mapped.timelog.timer!.activityId, 'reading');
  assert.equal(mapped.timelog.timer!.pointsPerHour, 15);
  assert.equal(mapped.timelog.activities.length, state.timelog.activities.length);
  state.lists[1].name = '专业资料';
  const restored = fromDocument(toDocument(state), emptyState());
  assert.equal(restored.lists.find((item) => item.id === 'subject')!.activityId, 'reading');
  assert.equal(
    startTaskTimer(restored, state.tasks[0].id, start).timelog.timer!.activityId,
    'reading',
  );
  assert.equal(
    startTaskTimer(restored, state.tasks[0].id, start, 'exercise').timelog.timer!.activityId,
    'exercise',
  );
});

test('a deleted custom mapping reports the stale binding instead of silently starting another activity', () => {
  const state = emptyState();
  state.timelog.activities.push({
    id: 'custom-lab',
    name: '实验操作',
    color: '#9955bb',
    nature: 'positive',
    pointsPerHour: 12,
    archived: false,
    updatedAt: start,
  });
  state.lists.push({
    id: 'lab',
    name: '工作',
    color: '#4488cc',
    activityId: 'custom-lab',
    order: 1,
  });
  state.tasks = [newTask('测定样品', { listId: 'lab' })];
  assert.equal(
    startTaskTimer(state, state.tasks[0].id, start).timelog.timer!.activityId,
    'custom-lab',
  );
  state.timelog = deleteActivity(state.timelog, 'custom-lab', start + 60000);
  const before = structuredClone(state);
  assert.throws(() => startTaskTimer(state, state.tasks[0].id, start), /绑定的活动已删除/);
  assert.deepEqual(state, before);
  state.lists[1].activityId = 'reading';
  assert.equal(
    startTaskTimer(state, state.tasks[0].id, start).timelog.timer!.activityId,
    'reading',
  );
});

test('dragging visible tasks changes their manual order while preserving filtered-out tasks and data', () => {
  const state = emptyState();
  state.tasks = [
    newTask('第一项', { id: 'a', order: 10, tags: ['当前'], priority: 4 }),
    newTask('其他清单任务', { id: 'hidden-a', order: 20, notes: '保留原内容' }),
    newTask('第二项', { id: 'b', order: 30, tags: ['当前'], priority: 1 }),
    newTask('其他标签任务', { id: 'hidden-b', order: 40 }),
    newTask('第三项', { id: 'c', order: 50, tags: ['当前'], priority: 2 }),
  ];
  const before = structuredClone(state);
  const reordered = reorderTasks(state, ['a', 'b', 'c'], 'a', 'c');
  assert.deepEqual(
    selectTasks(reordered, 'tag:当前', '', 'manual').map((task) => task.id),
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    [...reordered.tasks].sort((a, b) => a.order - b.order).map((task) => task.id),
    ['b', 'hidden-a', 'c', 'hidden-b', 'a'],
  );
  assert.equal(reordered.tasks.find((task) => task.id === 'hidden-a')!.notes, '保留原内容');
  assert.deepEqual(
    reordered.tasks.map(({ order: _order, updatedAt: _updatedAt, ...task }) => task),
    state.tasks.map(({ order: _order, updatedAt: _updatedAt, ...task }) => task),
  );
  assert.deepEqual(state, before);
  const restored = applyDelta(state, diffState(state, reordered));
  assert.deepEqual(
    selectTasks(restored, 'tag:当前', '', 'manual').map((task) => task.id),
    ['b', 'c', 'a'],
  );
  const movedBack = reorderTasks(restored, ['b', 'c', 'a'], 'a', 'b');
  assert.deepEqual(
    selectTasks(movedBack, 'tag:当前', '', 'manual').map((task) => task.id),
    ['a', 'b', 'c'],
  );
});

test('completed and deleted rows cannot become reorder targets or displace the current task sequence', () => {
  const state = emptyState();
  const completedAt = new Date(start).toISOString();
  state.tasks = [
    newTask('第一项', { id: 'a', order: 10, due: '2026-10-23' }),
    newTask('已完成', { id: 'done', order: 20, due: '2026-10-23', completedAt }),
    newTask('已删除', { id: 'deleted', order: 30, deletedAt: completedAt }),
    newTask('第二项', { id: 'b', order: 40, due: '2026-10-23' }),
  ];
  const ids = ['a', 'done', 'deleted', 'b'];
  assert.equal(reorderTasks(state, ids, 'done', 'a'), state);
  assert.equal(reorderTasks(state, ids, 'a', 'done'), state);
  assert.equal(reorderTasks(state, ids, 'deleted', 'b'), state);
  const reordered = reorderTasks(state, ids, 'a', 'b');
  assert.deepEqual(
    selectTasks(reordered, 'today', '', 'manual', '2026-10-23').map((task) => task.id),
    ['b', 'a', 'done'],
  );
  assert.deepEqual(
    selectTasks(reordered, 'all', '', 'manual').map((task) => task.id),
    ['b', 'a'],
  );
  assert.equal(reordered.tasks.find((task) => task.id === 'done')!.completedAt, completedAt);
});

test('dragging across a pinned boundary follows the chosen position without changing other pins', () => {
  const state = emptyState();
  state.tasks = [
    newTask('置顶二', { id: 'a', order: 50, tags: ['当前'], pinned: true }),
    newTask('置顶一', { id: 'b', order: 10, tags: ['当前'], pinned: true }),
    newTask('普通一', { id: 'c', order: 20, tags: ['当前'] }),
    newTask('普通二', { id: 'd', order: 60, tags: ['当前'] }),
    newTask('其他普通任务', { id: 'hidden-a', order: 30 }),
    newTask('其他置顶任务', { id: 'hidden-b', order: 40, pinned: true }),
  ];
  assert.deepEqual(
    selectTasks(state, 'tag:当前').map((task) => task.id),
    ['b', 'a', 'c', 'd'],
  );
  for (const [source, target, expected, pinned] of [
    ['c', 'b', ['c', 'b', 'a', 'd'], true],
    ['a', 'd', ['b', 'c', 'd', 'a'], false],
  ] as const) {
    const reordered = reorderTasks(state, ['b', 'a', 'c', 'd'], source, target);
    assert.deepEqual(
      selectTasks(reordered, 'tag:当前').map((task) => task.id),
      expected,
    );
    assert.equal(reordered.tasks.find((task) => task.id === source)!.pinned, pinned);
    assert.deepEqual(
      reordered.tasks.filter((task) => task.id !== source).map((task) => task.pinned),
      state.tasks.filter((task) => task.id !== source).map((task) => task.pinned),
    );
    assert.deepEqual(
      selectTasks(reordered, 'all')
        .filter((task) => task.id.startsWith('hidden'))
        .map((task) => task.id),
      ['hidden-b', 'hidden-a'],
    );
  }
});

test('tag color changes and deletions persist through deltas without overwriting unrelated changes', () => {
  const base = emptyState();
  base.tasks = [newTask('同一任务', { id: 'task', tags: ['化学'] })];
  base.tagColors = {
    tasks: { 化学: '#123456', 待删除: '#778899' },
    records: { 化学: '#abcdef' },
  };
  const edited = structuredClone(base);
  edited.tagColors.tasks = { 化学: '#4466aa', 物理: '#aa5544' };
  const remote = structuredClone(base);
  remote.tasks[0].notes = 'AI 同时补充的内容';
  remote.timelog.activities[0].name = '自主学习';
  const delta = diffState(base, edited);
  const saved = applyDelta(remote, delta);
  assert.deepEqual(saved.tagColors, edited.tagColors);
  assert.equal(saved.tasks[0].notes, 'AI 同时补充的内容');
  assert.equal(saved.timelog.activities[0].name, '自主学习');
  assert.deepEqual(applyDelta(saved, delta), saved);
  assert.deepEqual(applyDelta(saved, diffState(edited, base)).tagColors, base.tagColors);
  const conflict = structuredClone(base);
  conflict.tagColors.tasks.化学 = '#bb3344';
  assert.throws(() => applyDelta(conflict, delta), StateConflict);
});

test('task and activity tag colors remain independent and merge across devices with task metadata intact', () => {
  const base = emptyState();
  base.tasks = [newTask('复习课程', { tags: ['重要'] })];
  const phone = structuredClone(base);
  const desktop = structuredClone(base);
  phone.tagColors.tasks = { 重要: '#4488cc' };
  desktop.tagColors.records = { 重要: '#cc8844' };
  desktop.timelog.activities[0].color = '#557799';
  const merged = mergeDocuments(toDocument(base), toDocument(phone), toDocument(desktop));
  assert.equal(merged.conflicts.length, 0);
  const restored = fromDocument(merged.doc, emptyState());
  assert.deepEqual(restored.tagColors, {
    tasks: { 重要: '#4488cc' },
    records: { 重要: '#cc8844' },
  });
  assert.deepEqual(restored.tasks[0].tags, ['重要']);
  assert.equal(restored.timelog.activities[0].color, '#557799');
  assert.deepEqual(fromDocument(toDocument(restored), emptyState()).tagColors, restored.tagColors);
  const cleared = structuredClone(restored);
  delete cleared.tagColors.tasks.重要;
  assert.deepEqual(fromDocument(toDocument(cleared), restored).tagColors, {
    tasks: {},
    records: { 重要: '#cc8844' },
  });
  const legacy = structuredClone(base) as Partial<typeof base>;
  delete legacy.tagColors;
  assert.deepEqual(stateSchema.parse(legacy).tagColors, { tasks: {}, records: {} });
});
