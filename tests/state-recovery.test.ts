import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, newTask } from '../src/model.js';
import { applyDelta, diffState, StateConflict } from '../src/state-delta.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';
import { startTimer, toggleTimer, finishTimer } from '../src/timelog/domain.js';

test('module deltas merge unrelated entities, fields and numeric timestamps', () => {
  const base = emptyState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.timelog.activities[0].name = 'Local name';
  local.timelog.activities[0].updatedAt += 10;
  remote.timelog.activities[0].color = '#123456';
  remote.timelog.activities[0].updatedAt += 20;
  remote.timelog.activities[1].name = 'Remote work';
  local.tagColors.tasks.local = '#123456';
  remote.tagColors.tasks.remote = '#654321';
  const merged = applyDelta(remote, diffState(base, local));
  assert.equal(merged.timelog.activities[0].name, 'Local name');
  assert.equal(merged.timelog.activities[0].color, '#123456');
  assert.equal(merged.timelog.activities[0].updatedAt, remote.timelog.activities[0].updatedAt);
  assert.equal(merged.timelog.activities[1].name, 'Remote work');
  assert.deepEqual(merged.tagColors.tasks, { local: '#123456', remote: '#654321' });
  assert.equal(remote.timelog.activities[0].name, base.timelog.activities[0].name);
});

test('real field conflicts and delete-versus-edit remain explicit', () => {
  const base = emptyState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.timelog.activities[0].name = 'Local';
  remote.timelog.activities[0].name = 'Remote';
  assert.throws(() => applyDelta(remote, diffState(base, local)), StateConflict);
  local.timelog.activities.shift();
  assert.throws(() => applyDelta(remote, diffState(base, local)), StateConflict);
});

test('optional field removal and independent record edits survive concurrent module changes', () => {
  const base = emptyState();
  const task = newTask('Linked task');
  base.tasks.push(task);
  base.timelog.records.push({
    id: 'record',
    activityId: 'study',
    taskId: task.id,
    note: 'Before',
    tags: [],
    spans: [{ start: 1000, end: 61000 }],
    pointsPerHour: 20,
    nature: 'positive',
    deletedAt: null,
    updatedAt: 61000,
  });
  const local = structuredClone(base);
  delete local.timelog.records[0].taskId;
  local.timelog.records[0].updatedAt = 62000;
  const remote = structuredClone(base);
  remote.timelog.records[0].note = 'Remote note';
  remote.timelog.activities[0].name = 'Remote activity';
  remote.timelog.records[0].updatedAt = 63000;
  const result = applyDelta(remote, diffState(base, local));
  assert.equal(result.timelog.records[0].taskId, undefined);
  assert.equal(result.timelog.records[0].note, 'Remote note');
  assert.equal(result.timelog.records[0].updatedAt, 63000);
  assert.equal(result.timelog.activities[0].name, 'Remote activity');
});

test('timer transitions remain atomic and conflicting order changes remain explicit', () => {
  const base = emptyState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.timelog.activities.reverse();
  remote.timelog.activities[0].name = 'Remote activity';
  assert.throws(() => applyDelta(remote, diffState(base, local)), StateConflict);
  const draft = applyDelta(remote, diffState(base, local), false);
  assert.deepEqual(
    draft.timelog.activities.map((row) => row.id),
    local.timelog.activities.map((row) => row.id),
  );
  assert.equal(draft.timelog.activities.find((row) => row.id === 'study')!.name, 'Remote activity');
  base.timelog = startTimer(base.timelog, 'study', 'Timer', 1000);
  const paused = { ...base, timelog: toggleTimer(base.timelog, 60000) };
  const stopped = { ...base, timelog: finishTimer(base.timelog, 61000) };
  assert.throws(() => applyDelta(stopped, diffState(base, paused)), StateConflict);
  assert.equal(stopped.timelog.timer, null);
  assert.equal(stopped.timelog.records.length, 1);
});

test('independent collection additions preserve both sides and local ordering without concurrency', () => {
  const base = emptyState();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.timelog.activities.push({ ...base.timelog.activities[0], id: 'local' });
  remote.timelog.activities.push({ ...base.timelog.activities[0], id: 'remote' });
  const merged = applyDelta(remote, diffState(base, local));
  assert.ok(merged.timelog.activities.some((row) => row.id === 'local'));
  assert.ok(merged.timelog.activities.some((row) => row.id === 'remote'));
  local.timelog.activities.reverse();
  assert.deepEqual(
    applyDelta(base, diffState(base, local)).timelog.activities,
    local.timelog.activities,
  );
});

test('failed service initialization is retryable and restore notifies subscribers', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-recovery-'));
  const storage = new FileStore(directory);
  const service = new StateService(storage);
  try {
    await writeFile(storage.file, 'broken');
    await assert.rejects(service.snapshot());
    const repaired = { ...emptyState(), tasks: [newTask('Repaired')] };
    await writeFile(storage.file, JSON.stringify(repaired));
    assert.equal((await service.snapshot()).state.tasks[0].title, 'Repaired');
  } finally {
    service.dispose();
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('manual restore publishes recovered state and permits subsequent queued edits', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-restore-'));
  const storage = new FileStore(directory);
  const service = new StateService(storage);
  try {
    await writeFile(storage.file, 'broken');
    await assert.rejects(service.snapshot());
    const notifications: string[] = [];
    service.subscribe((snapshot) => notifications.push(snapshot.state.tasks[0].title));
    await service.restore({ ...emptyState(), tasks: [newTask('Restored')] });
    assert.deepEqual(notifications, ['Restored']);
    await service.mutate((state) => ({
      ...state,
      tasks: [{ ...state.tasks[0], title: 'Edited' }],
    }));
    assert.equal((await service.snapshot()).state.tasks[0].title, 'Edited');
  } finally {
    service.dispose();
    await service.flush();
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
