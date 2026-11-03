import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  dateKey,
  dayPlanGroups,
  deletePlanGroup,
  emptyState,
  newPlanGroup,
  newTask,
  reorderTasks,
  stateSchema,
  taskPlanGroup,
  withTaskDay,
} from '../src/model';
import { setDayStart, setTimeZone, zoneDateKey } from '../src/timezone';
import {
  dayKey,
  dayRange,
  goalStatus,
  initialState,
  validateState,
  weekRange,
} from '../src/timelog/domain';
import type { Goal, GoalTask } from '../src/timelog/domain';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document';
import { applyDelta, diffState } from '../src/state-delta';
import { FileStore } from '../electron/storage';
import { StateService } from '../electron/state-service';
import { startApi } from '../electron/api';

test('a 04:00 day start keeps late-night work on the previous business day', () => {
  setTimeZone('Asia/Shanghai');
  setDayStart('04:00');
  try {
    // 02:30 on 11-04 in Shanghai is still the business day 11-03; 04:00 starts 11-04.
    const lateNight = Date.parse('2026-11-03T18:30:00Z');
    assert.equal(dateKey(new Date(lateNight)), '2026-11-03');
    assert.equal(dayKey(lateNight), '2026-11-03');
    assert.equal(zoneDateKey(lateNight), '2026-11-04', 'courses keep the civil date');
    assert.equal(dayKey(Date.parse('2026-11-03T20:00:00Z')), '2026-11-04');
    const range = dayRange('2026-11-03');
    assert.equal(range.start, Date.parse('2026-11-02T20:00:00Z'));
    assert.equal(range.end, Date.parse('2026-11-03T20:00:00Z'));
    assert.equal(weekRange('2026-11-04').start, Date.parse('2026-11-01T20:00:00Z'), 'Monday 04:00');
    assert.throws(() => setDayStart('07:00'));
  } finally {
    setDayStart();
  }
  assert.equal(dayKey(Date.parse('2026-11-03T18:30:00Z')), '2026-11-04');
});

test('the day start is optional state that syncs as a preference and clears when removed', () => {
  const state = emptyState();
  assert.equal('dayStartsAt' in stateSchema.parse(state).settings, false);
  assert.throws(() =>
    stateSchema.parse({ ...state, settings: { ...state.settings, dayStartsAt: '07:00' } }),
  );
  const later = stateSchema.parse({
    ...state,
    settings: { ...state.settings, dayStartsAt: '04:00' },
  });
  assert.equal(toDocument(later).preferences.dayStartsAt, '04:00');
  assert.equal(fromDocument(toDocument(later), state).settings.dayStartsAt, '04:00');
  assert.equal(fromDocument(toDocument(state), later).settings.dayStartsAt, undefined);
});

test('plan sections belong to one day and never hold tasks of another day', () => {
  let state = emptyState();
  const lunch = newPlanGroup('2026-11-03', { title: '午饭前', minutes: 180, order: 1 });
  const meeting = newPlanGroup('2026-11-03', { title: '开会前', until: '15:00', order: 2 });
  const other = newPlanGroup('2026-11-04', { title: '午饭前', order: 1 });
  const a = newTask('物化作业', { due: '2026-11-03', planGroupId: lunch.id, estimatedMinutes: 60 });
  const b = newTask('读论文', { due: '2026-11-03', planGroupId: meeting.id });
  state = stateSchema.parse({ ...state, planGroups: [meeting, lunch, other], tasks: [a, b] });
  assert.deepEqual(
    dayPlanGroups(state, '2026-11-03').map((group) => group.title),
    ['午饭前', '开会前'],
  );
  assert.equal(taskPlanGroup(state, a)?.id, lunch.id);
  // Changing the day leaves the section; naming a section keeps it.
  assert.equal(withTaskDay(a, '2026-11-04').planGroupId, undefined);
  assert.equal(withTaskDay(a, '2026-11-03').planGroupId, lunch.id);
  assert.equal(withTaskDay(a, '2026-11-04', other.id).planGroupId, other.id);
  // A stale reference to another day's section is shown outside every section.
  assert.equal(taskPlanGroup(state, { ...a, due: '2026-11-04' }), null);
  // Dropping next to a task of another section moves into it, only when asked.
  const moved = reorderTasks(state, [a.id, b.id], a.id, b.id, true);
  assert.equal(moved.tasks.find((task) => task.id === a.id)!.planGroupId, meeting.id);
  const kept = reorderTasks(state, [a.id, b.id], a.id, b.id);
  assert.equal(kept.tasks.find((task) => task.id === a.id)!.planGroupId, lunch.id);
  // Deleting a section keeps its tasks on the same day.
  const removed = deletePlanGroup(state, lunch.id);
  const task = removed.tasks.find((row) => row.id === a.id)!;
  assert.equal(task.due, '2026-11-03');
  assert.equal(task.planGroupId, undefined);
  assert.ok(removed.planGroups.find((group) => group.id === lunch.id)!.deletedAt);
});

test('plan sections round-trip through sync documents and field deltas', () => {
  const base = emptyState();
  const group = newPlanGroup('2026-11-03', { title: '睡前' });
  const local = stateSchema.parse({ ...base, planGroups: [group] });
  const merged = mergeDocuments(toDocument(base), toDocument(local), toDocument(base));
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(fromDocument(merged.doc, base).planGroups, [group]);
  const renamed = { ...local, planGroups: [{ ...group, title: '洗漱前' }] };
  assert.equal(applyDelta(local, diffState(local, renamed)).planGroups[0].title, '洗漱前');
});

test('task-bound and manual goals are judged after their period with the same rules', () => {
  const state = initialState();
  const day = '2026-11-02';
  const after = dayRange(day).end;
  const english: Goal = {
    id: 'g1',
    name: '背单词',
    kind: 'tasks',
    taskTag: '英语',
    period: 'day',
    archived: false,
    updatedAt: 1,
  };
  const task = (tags: string[], completedAt: string | null, due = day): GoalTask => ({
    due,
    tags,
    completedAt,
    deletedAt: null,
  });
  const done = '2026-11-02T10:00:00.000Z';
  assert.equal(goalStatus(state, english, day, after, []).met, false, 'no task is not met');
  assert.deepEqual(
    goalStatus(state, english, day, after - 1, [task(['英语'], done), task(['英语'], null)]),
    { progress: 1, target: 2, settled: false, met: null, within: false },
  );
  assert.equal(
    goalStatus(state, english, day, after, [
      task(['英语'], done),
      task(['英语'], done),
      task(['数学'], null),
      task(['英语'], null, '2026-11-03'),
    ]).met,
    true,
  );
  const weekly: Goal = { ...english, period: 'week' };
  assert.equal(
    goalStatus(state, weekly, '2026-11-04', weekRange('2026-11-04').end, [
      task(['英语'], done, '2026-11-02'),
      task(['英语'], done, '2026-11-08'),
    ]).target,
    2,
  );
  const calm: Goal = {
    id: 'g2',
    name: '早睡',
    kind: 'manual',
    checks: { '2026-11-02': { done: true, by: 'ai', at: 1 } },
    period: 'day',
    archived: false,
    updatedAt: 1,
  };
  assert.equal(goalStatus(state, calm, day, after).met, true);
  assert.equal(goalStatus(state, calm, '2026-11-01', dayRange('2026-11-01').end).met, false);
  const loaded = validateState({ ...state, goals: [{ ...english, group: '英语' }, calm] });
  assert.equal(loaded.goals[0].group, '英语');
  assert.throws(() => validateState({ ...state, goals: [{ ...english, taskTag: ' ' }] }));
  assert.throws(() =>
    validateState({
      ...state,
      goals: [{ ...calm, checks: { x: { done: true, by: 'ai', at: 1 } } }],
    }),
  );
});

test('AI API manages plan sections, task-bound goals and manual checks', async () => {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'dayweave-plan-'));
  const service = new StateService(new FileStore(directory));
  const api = await startApi(service, 0);
  const request = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${api.info.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${api.info.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    let response = await request('PATCH', '/settings', { dayStartsAt: '04:00' });
    assert.equal(response.status, 200);
    const today = (await request('GET', '/context')).body.data.today as string;
    response = await request('POST', '/plan-groups', {
      date: today,
      title: '午饭前',
      minutes: 180,
    });
    assert.equal(response.status, 200);
    const group = response.body.data;
    response = await request('POST', '/tasks', {
      title: '物化作业',
      due: today,
      planGroupId: group.id,
    });
    assert.equal(response.status, 200);
    const task = response.body.data;
    assert.equal(
      (
        await request('POST', '/tasks', {
          title: '错日期',
          due: '2026-01-01',
          planGroupId: group.id,
        })
      ).status,
      400,
    );
    // Moving a task to another day leaves its section.
    response = await request('PATCH', `/tasks/${task.id}`, { due: '2026-01-01' });
    assert.equal(response.body.data.planGroupId, undefined);
    response = await request('PATCH', `/tasks/${task.id}`, { due: today, planGroupId: group.id });
    assert.equal(response.body.data.planGroupId, group.id);
    let context = (await request('GET', '/context')).body.data;
    assert.equal(context.dayStartsAt, '04:00');
    assert.deepEqual(
      context.planGroups.map((row: { title: string }) => row.title),
      ['午饭前'],
    );
    response = await request('DELETE', `/plan-groups/${group.id}`);
    assert.equal(response.status, 200);
    assert.equal((await request('GET', `/tasks/${task.id}`)).body.data.planGroupId, undefined);

    response = await request('POST', '/timelog/goals', {
      name: '背单词',
      kind: 'tasks',
      taskTag: '英语',
      group: '英语',
    });
    assert.equal(response.status, 201);
    response = await request('POST', '/timelog/goals', { name: '早睡', kind: 'manual' });
    const manual = response.body.data;
    response = await request('PATCH', `/timelog/goals/${manual.id}`, {
      expectedUpdatedAt: manual.updatedAt,
      check: { period: today, done: true },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      { done: response.body.data.checks[today].done, by: response.body.data.checks[today].by },
      { done: true, by: 'ai' },
    );
    context = (await request('GET', '/context')).body.data;
    const goals = Object.fromEntries(
      context.goals.map((goal: { name: string }) => [goal.name, goal]),
    );
    assert.equal(goals['早睡'].current.within, true);
    assert.equal(goals['早睡'].current.met, null);
    assert.equal(goals['背单词'].kind, 'tasks');
    assert.equal(goals['背单词'].group, '英语');
    const list = (await request('GET', '/timelog/goals')).body.data;
    assert.equal(list.items.find((goal: { name: string }) => goal.name === '背单词').target, 0);
  } finally {
    await api.close();
    setDayStart();
    assert.ok(directory.startsWith(base + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('a full-state import from the AI keeps the running timer instead of rejecting the write', async () => {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'dayweave-import-'));
  const service = new StateService(new FileStore(directory));
  const api = await startApi(service, 0);
  const request = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${api.info.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${api.info.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const started = await request('POST', '/time-records', { startAt: Date.now() - 60000 });
    assert.equal(started.status, 200);
    const exported = (await request('GET', '/export')).body.data;
    exported.tasks.push(newTask('计时中由 AI 新建'));
    const imported = await request('POST', '/import', exported);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    const state = (await service.snapshot()).state;
    assert.equal(state.timelog.timer?.id, started.body.data.id);
    assert.ok(state.tasks.some((task) => task.title === '计时中由 AI 新建'));
  } finally {
    await api.close();
    assert.ok(directory.startsWith(base + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
