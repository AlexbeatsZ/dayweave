import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  emptyState,
  newTask,
  recordedTaskMinutes,
  stateSchema,
  taskSchema,
  toggleTask,
} from '../src/model.js';
import { taskInputSchema, taskPatchSchema } from '../src/api-contract.js';
import { applyDelta, diffState } from '../src/state-delta.js';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document.js';
import { finishTimer, startTimer } from '../src/timelog/domain.js';
import { startApi } from '../electron/api.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';

const at = Date.UTC(2026, 9, 23, 8);

test('task effort is optional in legacy data and accepts separate nullable, nonnegative minute values', () => {
  const legacy = newTask('旧任务');
  assert.equal(Object.hasOwn(legacy, 'estimatedMinutes'), false);
  assert.equal(Object.hasOwn(legacy, 'actualMinutes'), false);
  assert.deepEqual(stateSchema.parse({ ...emptyState(), tasks: [legacy] }).tasks[0], legacy);
  for (const field of ['estimatedMinutes', 'actualMinutes'] as const) {
    for (const value of [null, 0, 0.5, 90]) {
      assert.equal(taskSchema.parse({ ...legacy, [field]: value })[field], value);
      assert.equal(taskInputSchema.parse({ title: '新任务', [field]: value })[field], value);
      assert.equal(taskPatchSchema.parse({ [field]: value })[field], value);
    }
    for (const value of [-1, NaN, Infinity, -Infinity, '30', true]) {
      assert.equal(taskSchema.safeParse({ ...legacy, [field]: value }).success, false);
      assert.equal(taskInputSchema.safeParse({ title: '新任务', [field]: value }).success, false);
      assert.equal(taskPatchSchema.safeParse({ [field]: value }).success, false);
    }
  }
});

test('saved linked records are read-only reference minutes and never fill an empty actual value', () => {
  const state = emptyState();
  const task = newTask('样品分析', { id: 'analysis', actualMinutes: null });
  state.tasks = [task];
  let timelog = startTimer(state.timelog, 'study', '', at, { taskId: task.id });
  timelog = finishTimer(timelog, at + 90000);
  timelog = startTimer(timelog, 'work', '', at + 120000, { taskId: task.id });
  timelog = finishTimer(timelog, at + 240000);
  timelog = startTimer(timelog, 'study', '', at + 300000, { taskId: 'another-task' });
  timelog = finishTimer(timelog, at + 600000);
  timelog = startTimer(timelog, 'study', '', at + 700000, { taskId: task.id });
  timelog = finishTimer(timelog, at + 1000000);
  timelog.records.at(-1)!.deletedAt = at + 1000001;
  state.timelog = startTimer(timelog, 'study', '尚未保存', at + 1100000, { taskId: task.id });
  const before = structuredClone(state);
  assert.equal(recordedTaskMinutes(state, task.id), 3.5);
  assert.equal(recordedTaskMinutes(state, 'missing'), 0);
  assert.equal(state.tasks[0].actualMinutes, null);
  state.tasks[0].actualMinutes = 12;
  assert.equal(recordedTaskMinutes(state, task.id), 3.5);
  assert.equal(state.tasks[0].actualMinutes, 12);
  assert.deepEqual(state.timelog, before.timelog);
});

test('repeated tasks inherit their estimate while each occurrence starts with no actual value', () => {
  const task = newTask('每周整理', {
    due: '2026-10-23',
    repeat: 'weekly',
    estimatedMinutes: 30,
    actualMinutes: 42,
  });
  const completed = toggleTask({ ...emptyState(), tasks: [task] }, task.id);
  assert.equal(completed.tasks[0].actualMinutes, 42);
  const next = completed.tasks.find((item) => item.parentId === task.id)!;
  assert.equal(next.estimatedMinutes, 30);
  assert.equal(next.actualMinutes == null, true);
});

test('effort deltas add and clear values independently while retaining unrelated task edits', () => {
  const base = emptyState();
  base.tasks = [newTask('编写报告', { id: 'report', estimatedMinutes: 60, actualMinutes: 75 })];
  const local = structuredClone(base);
  local.tasks[0].estimatedMinutes = null;
  const remote = structuredClone(base);
  remote.tasks[0].actualMinutes = 81.5;
  remote.tasks[0].notes = '来自其他设备';
  const applied = applyDelta(remote, diffState(base, local));
  assert.equal(applied.tasks[0].estimatedMinutes, null);
  assert.equal(applied.tasks[0].actualMinutes, 81.5);
  assert.equal(applied.tasks[0].notes, '来自其他设备');
  const cleared = structuredClone(applied);
  cleared.tasks[0].actualMinutes = null;
  assert.equal(applyDelta(applied, diffState(applied, cleared)).tasks[0].actualMinutes, null);
});

test('estimated and actual minutes merge as independent task fields and explicit clearing survives sync', () => {
  const base = emptyState();
  base.tasks = [newTask('复习', { id: 'review', estimatedMinutes: 30, actualMinutes: null })];
  const local = structuredClone(base);
  local.tasks[0].estimatedMinutes = 45;
  const remote = structuredClone(base);
  remote.tasks[0].actualMinutes = 32.5;
  const merged = mergeDocuments(toDocument(base), toDocument(local), toDocument(remote));
  assert.equal(merged.conflicts.length, 0);
  const saved = fromDocument(merged.doc, emptyState());
  assert.equal(saved.tasks[0].estimatedMinutes, 45);
  assert.equal(saved.tasks[0].actualMinutes, 32.5);
  const cleared = structuredClone(saved);
  cleared.tasks[0].actualMinutes = null;
  const restored = fromDocument(toDocument(cleared), saved);
  assert.equal(restored.tasks[0].estimatedMinutes, 45);
  assert.equal(restored.tasks[0].actualMinutes, null);
});

test('authenticated task API persists optional effort fields, partial edits and explicit null clearing', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-task-effort-'));
  const storage = new FileStore(directory);
  const service = new StateService(storage);
  const api = await startApi(service, 0);
  const request = (method: string, route: string, body?: unknown) =>
    fetch(`${api.info.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${api.info.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    let response = await request('POST', '/tasks', { title: '保留旧接口用法' });
    assert.equal(response.status, 200);
    const legacy = (await response.json()).data;
    assert.equal(Object.hasOwn(legacy, 'estimatedMinutes'), false);
    response = await request('POST', '/tasks', {
      title: '编写实验报告',
      estimatedMinutes: 120,
      actualMinutes: 95.5,
    });
    assert.equal(response.status, 200);
    const created = (await response.json()).data;
    assert.equal(created.estimatedMinutes, 120);
    assert.equal(created.actualMinutes, 95.5);
    response = await request('PATCH', `/tasks/${created.id}`, { notes: '明天交' });
    assert.equal(response.status, 200);
    const edited = (await response.json()).data;
    assert.equal(edited.estimatedMinutes, 120);
    assert.equal(edited.actualMinutes, 95.5);
    response = await request('PATCH', `/tasks/${created.id}`, {
      estimatedMinutes: 0,
      actualMinutes: null,
    });
    assert.equal(response.status, 200);
    const cleared = (await response.json()).data;
    assert.equal(cleared.estimatedMinutes, 0);
    assert.equal(cleared.actualMinutes, null);
    assert.equal(cleared.notes, '明天交');
    response = await request('PATCH', `/tasks/${created.id}`, { estimatedMinutes: null });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.estimatedMinutes, null);
    for (const input of [{ actualMinutes: -1 }, { estimatedMinutes: '30' }]) {
      assert.equal((await request('PATCH', `/tasks/${created.id}`, input)).status, 400);
    }
    const persisted = (await new FileStore(directory).load()).state.tasks.find(
      (task) => task.id === created.id,
    )!;
    assert.equal(persisted.estimatedMinutes, null);
    assert.equal(persisted.actualMinutes, null);
  } finally {
    await api.close();
    service.dispose();
    await service.flush();
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
