import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StateService } from '../electron/state-service';
import { FileStore } from '../electron/storage';
import { startApi } from '../electron/api';
import { emptyState } from '../src/model';
import { initialState, startTimer, toggleTimer } from '../src/timelog/domain';

async function fixture(run: (service: StateService) => Promise<void>) {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-countdown-'));
  const service = new StateService(new FileStore(directory));
  try {
    await run(service);
  } finally {
    service.dispose();
    await service.flush();
    assert.ok(directory.startsWith(root + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
}
async function apiFixture(
  run: (
    service: StateService,
    request: (method: string, route: string, body?: unknown) => Promise<Response>,
  ) => Promise<void>,
) {
  await fixture(async (service) => {
    const api = await startApi(service, 0);
    try {
      await run(service, (method, route, body) =>
        fetch(`${api.info.url}${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${api.info.token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    } finally {
      await api.close();
    }
  });
}
async function data(response: Response, status = 200): Promise<any> {
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result.data;
}

test('future endAt starts a synchronized open record and the service closes the same ID at its deadline', async () => {
  await apiFixture(async (service, request) => {
    const startAt = Date.now() - 60000;
    const endAt = Date.now() + 300;
    let remove = () => {};
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        remove();
        reject(new Error('Countdown did not persist at deadline'));
      }, 3000);
      remove = service.subscribe((snapshot) => {
        if (snapshot.state.timelog.records.some((record) => record.note === 'Deadline record')) {
          clearTimeout(timeout);
          remove();
          resolve();
        }
      });
    });
    const timer = await data(
      await request('POST', '/time-records', { startAt, endAt, note: 'Deadline record' }),
    );
    assert.equal(timer.endAt, null);
    assert.equal(timer.plannedEndAt, endAt);
    await completed;
    const rows = await data(await request('GET', '/time-records'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, timer.id);
    assert.equal(rows[0].endAt, endAt);
    assert.equal(rows[0].elapsedMs, endAt - startAt);
    assert.equal((await service.snapshot()).state.timelog.timer, null);
    assert.equal((await request('POST', `/time-records/${timer.id}/stop`, {})).status, 409);
  });
});

test('AI configures one timer start/end/task/tags and manages synchronized countdown presets', async () => {
  await apiFixture(async (service, request) => {
    await service.mutate((state) => ({
      ...state,
      timer: {
        id: 'old-paused-focus',
        taskId: null,
        title: 'Legacy timer',
        kind: 'focus',
        duration: 1500,
        remaining: 1500,
        endAt: null,
      },
    }));
    const state = await service.snapshot();
    const activityId = state.state.timelog.activities[0].id;
    const previousEnd = Date.now() - 5000;
    await data(
      await request('POST', '/time-records', {
        startAt: previousEnd - 60000,
        endAt: previousEnd,
        activityId,
      }),
    );
    const timer = await data(
      await request('POST', '/timelog/timer/start', {
        activityId,
        tags: ['学习'],
        taskId: 'task-reference',
      }),
    );
    const endAt = Date.now() + 60000;
    const configured = await data(
      await request('POST', '/timelog/timer/configure', {
        timerId: timer.id,
        fromPreviousRecord: true,
        endAt,
        note: 'Adjusted by AI',
        tags: ['化学'],
        taskId: 'different-task',
      }),
    );
    assert.equal(configured.id, timer.id);
    assert.equal(configured.startedAt, previousEnd);
    assert.equal(configured.runningSince, previousEnd);
    assert.equal(configured.plannedEndAt, endAt);
    assert.equal(configured.taskId, 'different-task');
    assert.deepEqual(configured.tags, ['化学']);
    assert.equal((await service.snapshot()).state.timer?.id, 'old-paused-focus');
    assert.equal((await request('POST', '/timelog/timer/start', { activityId })).status, 409);
    assert.equal(
      (
        await request('POST', '/timelog/timer/configure', {
          timerId: timer.id,
          endAt: Date.now() - 1000,
        })
      ).status,
      400,
    );
    assert.equal((await service.snapshot()).state.timelog.timer?.plannedEndAt, endAt);
    assert.equal(
      (await request('POST', '/timelog/timer/configure', { timerId: 'stale', endAt: null })).status,
      409,
    );
    await data(await request('POST', '/timelog/timer/pause', { timerId: timer.id }));
    const paused = (await service.snapshot()).state.timelog.timer!;
    await data(
      await request('POST', '/timelog/timer/configure', {
        timerId: timer.id,
        startAt: previousEnd - 1000,
        endAt: null,
        taskId: null,
      }),
    );
    const adjusted = (await service.snapshot()).state.timelog.timer!;
    assert.equal(adjusted.runningSince, null);
    assert.equal(adjusted.spans[0].end, paused.spans[0].end);
    assert.equal(adjusted.spans[0].start, previousEnd - 1000);
    assert.equal(adjusted.plannedEndAt, null);
    assert.equal(adjusted.taskId, undefined);
    const settings = await data(await request('GET', '/timelog/settings'));
    assert.deepEqual(settings.timerPresets, [5, 30, 45, 60]);
    const changed = await data(
      await request('PATCH', '/timelog/settings', {
        expectedUpdatedAt: settings.updatedAt,
        timerPresets: [5, 15, 15, 90],
      }),
    );
    assert.deepEqual(changed.timerPresets, [5, 15, 90]);
    assert.equal(
      (
        await request('PATCH', '/timelog/settings', {
          expectedUpdatedAt: settings.updatedAt,
          timerPresets: [],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request('PATCH', '/timelog/settings', {
          expectedUpdatedAt: changed.updatedAt,
          timerPresets: [-1],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('PATCH', '/timelog/settings', {
          expectedUpdatedAt: changed.updatedAt,
          timerPresets: [1.5],
        })
      ).status,
      400,
    );
  });
});

test('deleting activities and goals removes usable entities while retaining historical record rates', async () => {
  await apiFixture(async (service, request) => {
    const activity = await data(
      await request('POST', '/timelog/activities', {
        name: 'Temporary activity',
        pointsPerHour: 35,
      }),
      201,
    );
    const now = Date.now();
    const record = await data(
      await request('POST', '/time-records', {
        startAt: now - 120000,
        endAt: now - 60000,
        activityId: activity.id,
      }),
    );
    const goal = await data(
      await request('POST', '/timelog/goals', {
        name: 'Temporary goal',
        activityId: activity.id,
        minutes: 15,
      }),
      201,
    );
    await data(
      await request('DELETE', `/timelog/goals/${goal.id}`, { expectedUpdatedAt: goal.updatedAt }),
    );
    assert.equal(
      (await service.snapshot()).state.timelog.goals.some((row) => row.id === goal.id),
      false,
    );
    await data(
      await request('POST', '/timelog/goals', {
        name: 'Cascade goal',
        activityId: activity.id,
        minutes: 30,
      }),
      201,
    );
    await data(
      await request('DELETE', `/timelog/activities/${activity.id}`, {
        expectedUpdatedAt: activity.updatedAt,
      }),
    );
    assert.equal((await request('GET', `/timelog/activities/${activity.id}`)).status, 404);
    const state = (await service.snapshot()).state.timelog;
    assert.equal(
      state.goals.some((row) => row.activityId === activity.id),
      false,
    );
    assert.equal(state.records.find((row) => row.id === record.id)?.pointsPerHour, 35);
    assert.ok(state.activities.find((row) => row.id === activity.id)?.deletedAt);
    assert.equal(state.activities.find((row) => row.id === activity.id)?.archived, false);
    assert.equal(
      (await request('POST', '/timelog/timer/start', { activityId: activity.id })).status,
      400,
    );
    assert.equal(
      (
        await request('POST', '/time-records', {
          startAt: Date.now() - 1000,
          activityId: activity.id,
        })
      ).status,
      400,
    );
  });
});

test('StateService schedules exactly one deadline, shifts it across pause and resumes, and disposes it', async (t) => {
  const now = 1792700000000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  await fixture(async (service) => {
    const initial = await service.snapshot();
    const activityId = initial.state.timelog.activities[0].id;
    await service.mutate((state) => ({
      ...state,
      timelog: startTimer(state.timelog, activityId, 'Scheduled', now, {
        plannedEndAt: now + 60000,
      }),
    }));
    t.mock.timers.tick(10000);
    await service.mutate((state) => ({
      ...state,
      timelog: toggleTimer(state.timelog, Date.now()),
    }));
    t.mock.timers.tick(90000);
    await service.flush();
    assert.equal((await service.snapshot()).state.timelog.records.length, 0);
    await service.mutate((state) => ({
      ...state,
      timelog: toggleTimer(state.timelog, Date.now()),
    }));
    assert.equal((await service.snapshot()).state.timelog.timer?.plannedEndAt, now + 150000);
    t.mock.timers.tick(50000);
    await service.flush();
    let state = (await service.snapshot()).state.timelog;
    assert.equal(state.timer, null);
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].spans.at(-1)?.end, now + 150000);
    t.mock.timers.tick(60000);
    await service.flush();
    assert.equal((await service.snapshot()).state.timelog.records.length, 1);
    await service.mutate((value) => ({
      ...value,
      timelog: startTimer(value.timelog, activityId, 'Disposed timer', Date.now(), {
        plannedEndAt: Date.now() + 60000,
      }),
    }));
    service.dispose();
    t.mock.timers.tick(60000);
    await service.flush();
    state = (await service.storage.load()).state.timelog;
    assert.ok(state.timer);
    assert.equal(state.records.length, 1);
  });
});

test('loading a persisted expired countdown finishes at its stored deadline exactly once', async () => {
  await fixture(async (service) => {
    await service.snapshot();
    service.dispose();
    const now = Date.now();
    const state = emptyState();
    state.timelog = startTimer(
      initialState(),
      state.timelog.activities[0].id,
      'Expired while closed',
      now - 120000,
      { plannedEndAt: now - 60000 },
    );
    await service.storage.save(state);
    const restarted = new StateService(new FileStore(service.storage.directory));
    try {
      const loaded = (await restarted.snapshot()).state.timelog;
      assert.equal(loaded.timer, null);
      assert.equal(loaded.records.length, 1);
      assert.equal(loaded.records[0].spans.at(-1)?.end, now - 60000);
      assert.equal((await restarted.snapshot()).state.timelog.records.length, 1);
    } finally {
      restarted.dispose();
      await restarted.flush();
    }
  });
});
