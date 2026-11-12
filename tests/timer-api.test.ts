import { stateWithActivities, timelogWithActivities } from './fixtures/activities';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { StateService } from '../electron/state-service';
import { FileStore } from '../electron/storage';
import { startApi } from '../electron/api';
import { startTimer, toggleTimer } from '../src/timelog/domain';
import { diffState } from '../src/state-delta';
import { fromDocument, toDocument } from '../src/sync/document';

test('time writes and AI import reject new overlap atomically, including paused timers', async () =>
  apiFixture(async (service, request) => {
    const start = Date.now() - 180_000;
    const ranges = (left: number, right: number) => ({
      activityId: 'study',
      spans: [{ start: start + left, end: start + right }],
    });
    const conflict = async (response: Response, timer: boolean) => {
      assert.equal(response.status, 409);
      const { error } = await response.json();
      assert.equal(error.reason, 'TIME_OVERLAP');
      assert.equal(error.details.conflictingTimer, timer);
    };
    await data(await request('POST', '/timelog/records', ranges(-60_000, 0)), 201);
    const timer = await data(
      await request('POST', '/timelog/timer/start', { activityId: 'study', startAt: start }),
    );
    await data(await request('POST', '/timelog/timer/pause', { timerId: timer.id }));
    await conflict(
      await request('POST', '/time-records', { startAt: start, endAt: start + 1000 }),
      true,
    );
    await conflict(
      await request('POST', '/timelog/timer/configure', {
        timerId: timer.id,
        startAt: start - 1000,
      }),
      false,
    );
    const before = await service.snapshot();
    const incoming = structuredClone(before.state);
    incoming.timelog.records.push({
      ...incoming.timelog.records[0],
      id: randomUUID(),
      spans: ranges(60_000, 90_000).spans,
    });
    await conflict(
      await request('POST', '/import', incoming, { 'If-Match': `"${before.revision}"` }),
      true,
    );
    assert.deepEqual(await service.snapshot(), before);
    await data(await request('POST', '/timelog/timer/cancel', { timerId: timer.id }));
    const results = await Promise.all([
      request('POST', '/timelog/records', ranges(0, 10_000)),
      request('POST', '/timelog/records', ranges(5000, 15_000)),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    await conflict(
      results.find((result) => result.status === 409)!,
      false,
    );
    assert.equal((await service.snapshot()).state.timelog.records.length, 2);
  }));

test('legacy overlap can be read, edited without adding occupancy, and trimmed', async () => {
  const state = stateWithActivities();
  const start = Date.now() - 60_000;
  const record = (id: string, left: number, right: number) => ({
    id,
    activityId: 'study',
    note: '',
    tags: [],
    spans: [{ start: start + left, end: start + right }],
    nature: 'positive' as const,
    deletedAt: null,
    updatedAt: start,
  });
  state.timelog.records = [record('legacy-a', 0, 20_000), record('legacy-b', 10_000, 30_000)];
  await apiFixture(async (service, request) => {
    const original = await data(await request('GET', '/timelog/records/legacy-b'));
    const noted = await data(
      await request('PATCH', '/timelog/records/legacy-b', {
        expectedUpdatedAt: original.updatedAt,
        note: '保留原有重叠的备注修改',
      }),
    );
    await data(
      await request('PATCH', '/timelog/records/legacy-b', {
        expectedUpdatedAt: noted.updatedAt,
        spans: record('legacy-b', 20_000, 30_000).spans,
      }),
    );
    await data(
      await request('POST', '/timelog/records', {
        activityId: 'study',
        spans: record('adjacent', 30_000, 40_000).spans,
      }),
      201,
    );
    assert.equal((await service.snapshot()).state.timelog.records.length, 3);
  }, state);
});

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
    request: (
      method: string,
      route: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<Response>,
  ) => Promise<void>,
  seed?: ReturnType<typeof stateWithActivities>,
) {
  await fixture(async (service) => {
    await service.restore(seed ?? stateWithActivities());
    const api = await startApi(service, 0);
    try {
      await run(service, (method, route, body, headers = {}) =>
        fetch(`${api.info.url}${route}`, {
          method,
          headers: {
            Authorization: `Bearer ${api.info.token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
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
    assert.equal(
      (await request('POST', '/timelog/timer/configure', { timerId: timer.id, taskId: null }))
        .status,
      409,
    );
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
    const task = await data(await request('POST', '/tasks', { title: 'First task' }));
    const otherTask = await data(await request('POST', '/tasks', { title: 'Other task' }));
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
        taskId: task.id,
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
        taskId: otherTask.id,
      }),
    );
    assert.equal(configured.id, timer.id);
    assert.equal(configured.startedAt, previousEnd);
    assert.equal(configured.runningSince, previousEnd);
    assert.equal(configured.plannedEndAt, endAt);
    assert.equal(configured.taskId, otherTask.id);
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
        startAt: previousEnd + 1000,
        endAt: null,
        taskId: null,
      }),
    );
    const adjusted = (await service.snapshot()).state.timelog.timer!;
    assert.equal(adjusted.runningSince, null);
    assert.equal(adjusted.spans[0].end, paused.spans[0].end);
    assert.equal(adjusted.spans[0].start, previousEnd + 1000);
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
    // A range in the target text sets the stages; a plain target clears them again.
    const staged = await data(
      await request('PATCH', `/timelog/goals/${goal.id}`, {
        expectedUpdatedAt: goal.updatedAt,
        target: '<1-3h',
      }),
    );
    assert.deepEqual(
      [staged.minutes, staged.comparison, staged.stages],
      [60, 'atMost', [120, 180]],
    );
    const plain = await data(
      await request('PATCH', `/timelog/goals/${goal.id}`, {
        expectedUpdatedAt: staged.updatedAt,
        target: '9h',
      }),
    );
    assert.equal(plain.stages, undefined);
    assert.equal(
      (
        await request('PATCH', `/timelog/goals/${goal.id}`, {
          expectedUpdatedAt: plain.updatedAt,
          stages: '8-15',
        })
      ).status,
      400,
    );
    await data(
      await request('DELETE', `/timelog/goals/${goal.id}`, { expectedUpdatedAt: plain.updatedAt }),
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
      state.goals.some(
        (row) =>
          row.kind === undefined && row.rules.some((rule) => rule.activities.includes(activity.id)),
      ),
      false,
    );
    assert.ok(state.records.find((row) => row.id === record.id));
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

test('historical record links preserve pause gaps and metadata, allow many records per completed task and persist', async () => {
  await apiFixture(async (service, request) => {
    const activityId = (await service.snapshot()).state.timelog.activities[0].id;
    const task = await data(await request('POST', '/tasks', { title: 'Finished work' }));
    await data(await request('POST', `/tasks/${task.id}/complete`, {}));
    const otherTask = await data(await request('POST', '/tasks', { title: 'Another task' }));
    const now = Date.now();
    const original = await data(
      await request('POST', '/timelog/records', {
        activityId,
        note: 'Original note',
        tags: ['original'],
        spans: [
          { start: now - 600000, end: now - 480000 },
          { start: now - 420000, end: now - 300000 },
        ],
      }),
      201,
    );
    const timer = await data(
      await request('POST', '/timelog/timer/start', { activityId, note: 'Separate live timer' }),
    );
    const before = (await service.snapshot()).state;
    const linked = await data(
      await request('PATCH', `/timelog/records/${original.id}`, {
        expectedUpdatedAt: original.updatedAt,
        taskId: task.id,
      }),
    );
    assert.ok(linked.updatedAt > original.updatedAt);
    assert.deepEqual(linked, { ...original, taskId: task.id, updatedAt: linked.updatedAt });
    assert.deepEqual((await service.snapshot()).state.timelog.timer, timer);
    assert.deepEqual((await service.snapshot()).state.tasks, before.tasks);
    const second = await data(
      await request('POST', '/timelog/records', {
        activityId,
        taskId: task.id,
        spans: [{ start: now - 240000, end: now - 180000 }],
      }),
      201,
    );
    const rows = await data(await request('GET', `/timelog/records?taskId=${task.id}`));
    assert.equal(rows.total, 2);
    assert.deepEqual(
      new Set(rows.items.map((row: any) => row.id)),
      new Set([linked.id, second.id]),
    );
    assert.equal((await data(await request('GET', `/tasks/${task.id}`))).title, 'Finished work');
    assert.equal(
      (await data(await request('GET', '/time-records'))).find((row: any) => row.id === linked.id)
        .taskId,
      task.id,
    );
    const edited = await data(
      await request('PATCH', `/timelog/records/${linked.id}`, {
        expectedUpdatedAt: linked.updatedAt,
        note: 'User note edit',
      }),
    );
    assert.equal(edited.taskId, task.id);
    const rebound = await data(
      await request('PATCH', `/timelog/records/${linked.id}`, {
        expectedUpdatedAt: edited.updatedAt,
        taskId: otherTask.id,
      }),
    );
    assert.deepEqual(rebound, { ...edited, taskId: otherTask.id, updatedAt: rebound.updatedAt });
    const unlinked = await data(
      await request('PATCH', `/timelog/records/${linked.id}`, {
        expectedUpdatedAt: rebound.updatedAt,
        taskId: null,
      }),
    );
    const { taskId: removed, ...rest } = rebound;
    assert.equal(removed, otherTask.id);
    assert.deepEqual(unlinked, { ...rest, updatedAt: unlinked.updatedAt });
    const persisted = (await new FileStore(service.storage.directory).load()).state;
    assert.deepEqual(
      persisted.timelog.records.find((row) => row.id === unlinked.id),
      unlinked,
    );
    assert.equal(persisted.timelog.records.find((row) => row.id === second.id)?.taskId, task.id);
    assert.deepEqual(persisted.timelog.timer, timer);
    const synced = fromDocument(toDocument(persisted), stateWithActivities());
    assert.deepEqual(synced.timelog.records, persisted.timelog.records);
    assert.deepEqual(synced.timelog.timer, timer);
  });
});

test('all record and timer link inputs reject missing/deleted tasks atomically while old links remain readable', async () => {
  await apiFixture(async (service, request) => {
    const activityId = (await service.snapshot()).state.timelog.activities[0].id;
    const task = await data(await request('POST', '/tasks', { title: 'Deleted later' }));
    const startAt = Date.now() - 600000;
    const record = await data(
      await request('POST', '/timelog/records', {
        activityId,
        taskId: task.id,
        spans: [{ start: startAt, end: startAt + 60000 }],
      }),
      201,
    );
    const timer = await data(
      await request('POST', '/timelog/timer/start', {
        activityId,
        taskId: task.id,
        startAt: startAt + 60000,
      }),
    );
    await data(await request('DELETE', `/tasks/${task.id}`));
    const attempts: [unknown, number, string][] = [
      ['missing-task', 404, 'Task not found'],
      [task.id, 409, 'Task is deleted'],
      ['', 400, 'taskId'],
      [42, 400, 'taskId'],
      [['missing-task'], 400, 'taskId'],
    ];
    for (const [taskId, status, error] of attempts) {
      for (const [method, route, input] of [
        ['PATCH', `/timelog/records/${record.id}`, { expectedUpdatedAt: record.updatedAt }],
        ['POST', '/timelog/records', { activityId, spans: record.spans }],
        ['POST', '/timelog/timer/configure', { timerId: timer.id }],
      ] as const) {
        const before = await service.snapshot();
        const response = await request(method, route, { ...input, taskId });
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        assert.match(result.data.error, new RegExp(error));
        assert.deepEqual(await service.snapshot(), before);
      }
    }
    // A deleted target does not invalidate historical facts or unrelated edits/imports.
    const edited = await data(
      await request('PATCH', `/timelog/records/${record.id}`, {
        expectedUpdatedAt: record.updatedAt,
        note: 'Keep the historical link',
      }),
    );
    assert.equal(edited.taskId, task.id);
    const backup = (await service.snapshot()).state;
    await data(await request('POST', '/import', backup));
    assert.equal(
      (await data(await request('GET', `/timelog/records/${record.id}`))).taskId,
      task.id,
    );
    await data(
      await request('PATCH', `/timelog/records/${record.id}`, {
        expectedUpdatedAt: edited.updatedAt,
        taskId: null,
      }),
    );
    await data(
      await request('POST', '/timelog/timer/configure', { timerId: timer.id, taskId: null }),
    );
    await data(await request('POST', '/timelog/timer/cancel', { timerId: timer.id }));
    for (const [taskId, status] of attempts.slice(0, 2)) {
      for (const [route, input] of [
        ['/time-records', { startAt }],
        ['/time-records', { startAt, endAt: startAt + 60000 }],
        ['/timelog/timer/start', { activityId, startAt }],
      ] as const) {
        const before = await service.snapshot();
        assert.equal((await request('POST', route, { ...input, taskId })).status, status);
        assert.deepEqual(await service.snapshot(), before);
      }
    }
  });
});

test('record links honor entity timestamps and If-Match without overwriting a concurrent UI edit', async () => {
  await apiFixture(async (service, request) => {
    const task = await data(await request('POST', '/tasks', { title: 'Link target' }));
    const original = await data(
      await request('POST', '/time-records', {
        startAt: Date.now() - 120000,
        endAt: Date.now() - 60000,
        note: 'Before UI edit',
      }),
    );
    const read = await request('GET', `/timelog/records/${original.id}`);
    const etag = read.headers.get('etag')!;
    assert.equal(etag, `"${(await read.json()).revision}"`);
    assert.equal(
      (await request('PATCH', `/timelog/records/${original.id}`, { taskId: task.id })).status,
      428,
    );
    const before = (await service.snapshot()).state;
    const changed = structuredClone(before);
    changed.timelog.records[0].note = 'Concurrent user edit';
    changed.timelog.records[0].updatedAt = original.updatedAt + 1;
    await service.patch(diffState(before, changed));
    const current = (await service.snapshot()).state.timelog.records[0];
    assert.equal(
      (
        await request('PATCH', `/timelog/records/${original.id}`, {
          expectedUpdatedAt: original.updatedAt,
          taskId: task.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          'PATCH',
          `/timelog/records/${original.id}`,
          { expectedUpdatedAt: current.updatedAt, taskId: task.id },
          { 'If-Match': etag },
        )
      ).status,
      409,
    );
    assert.deepEqual((await service.snapshot()).state.timelog.records[0], current);
    const readLatest = await request('GET', `/timelog/records/${original.id}`);
    const headers = { 'If-Match': readLatest.headers.get('etag')! };
    const responses = await Promise.all([
      request(
        'PATCH',
        `/timelog/records/${original.id}`,
        {
          expectedUpdatedAt: current.updatedAt,
          taskId: task.id,
        },
        headers,
      ),
      request(
        'PATCH',
        `/timelog/records/${original.id}`,
        {
          expectedUpdatedAt: current.updatedAt,
          taskId: null,
        },
        headers,
      ),
    ]);
    assert.deepEqual(responses.map((row) => row.status).sort(), [200, 409]);
    assert.equal((await service.snapshot()).state.timelog.records[0].note, 'Concurrent user edit');
  });
});

test('pure timer links preserve full running/paused snapshots, use If-Match and reject ended timer IDs', async () => {
  await apiFixture(async (service, request) => {
    const task = await data(await request('POST', '/tasks', { title: 'Completed task' }));
    await data(await request('POST', `/tasks/${task.id}/complete`, {}));
    const activityId = (await service.snapshot()).state.timelog.activities[0].id;
    let timer = await data(
      await request('POST', '/timelog/timer/start', {
        activityId,
        startAt: Date.now() - 60000,
        endAt: Date.now() + 3600000,
        note: 'Preserve timer metadata',
        tags: ['keep'],
      }),
    );
    for (const paused of [false, true]) {
      if (paused)
        timer = await data(await request('POST', '/timelog/timer/pause', { timerId: timer.id }));
      assert.equal(timer.runningSince === null, paused);
      for (const taskId of [task.id, null]) {
        const read = await request('GET', '/timelog/timer');
        const etag = read.headers.get('etag')!;
        const { timer: before } = await data(read);
        timer = await data(
          await request(
            'POST',
            '/timelog/timer/configure',
            { timerId: timer.id, taskId },
            {
              'If-Match': etag,
            },
          ),
        );
        const { taskId: previousTask, ...unchanged } = before;
        assert.deepEqual(timer, { ...unchanged, ...(taskId === null ? {} : { taskId }) });
        assert.deepEqual((await data(await request('GET', '/timelog/timer'))).timer, timer);
        const persisted = (await new FileStore(service.storage.directory).load()).state;
        assert.deepEqual(persisted.timelog.timer, timer);
        assert.equal(
          (
            await request(
              'POST',
              '/timelog/timer/configure',
              { timerId: timer.id, taskId },
              {
                'If-Match': etag,
              },
            )
          ).status,
          409,
        );
      }
    }
    timer = await data(
      await request('POST', '/timelog/timer/configure', { timerId: timer.id, taskId: task.id }),
    );
    assert.deepEqual(
      await data(await request('POST', '/timelog/timer/configure', { timerId: timer.id })),
      timer,
    );
    assert.equal(
      (await request('POST', '/timelog/timer/configure', { timerId: 'stale', taskId: null }))
        .status,
      409,
    );
    const saved = await data(await request('POST', '/timelog/timer/stop', { timerId: timer.id }));
    assert.equal(saved.id, timer.id);
    assert.equal(saved.taskId, task.id);
    assert.deepEqual(saved.spans, timer.spans);
    const read = await request('GET', '/timelog/timer');
    assert.equal((await data(read)).timer, null);
    const response = await request(
      'POST',
      '/timelog/timer/configure',
      {
        timerId: timer.id,
        taskId: null,
      },
      { 'If-Match': read.headers.get('etag')! },
    );
    assert.equal(response.status, 409);
    assert.match((await response.json()).data.error, /No active timer/);
    assert.deepEqual((await service.snapshot()).state.timelog.records[0], saved);
  });
});

test('retrospective achievements complete a real task without fake subtasks or backdated native timestamps', async () => {
  await apiFixture(async (service, request) => {
    const actualDate = '2026-01-02';
    const activityId = (await service.snapshot()).state.timelog.activities[0].id;
    const timer = await data(
      await request('POST', '/timelog/timer/start', { activityId, startAt: Date.now() - 60000 }),
    );
    const input = {
      id: `${randomUUID()}-0`,
      title: 'Reported finished work',
      dates: { [actualDate]: null },
      notes: 'Actually performed on 2026-01-02; recorded retrospectively.',
      difficulty: 'hard',
      estimatedMinutes: 0,
      actualMinutes: 12.5,
      tags: ['achievement'],
    };
    assert.equal(
      (await request('POST', '/tasks', { ...input, id: 'not-a-v2-task-id' })).status,
      400,
    );
    assert.equal(
      (await request('POST', '/tasks', { ...input, completedAt: '2026-01-02T12:00:00Z' })).status,
      400,
    );
    const started = Date.now();
    const created = await request('POST', '/tasks', input);
    const etag = created.headers.get('etag')!;
    const task = await data(created);
    assert.equal(task.id, input.id);
    assert.equal(task.actualMinutes, 12.5);
    assert.equal(task.estimatedMinutes, 0);
    assert.equal(task.difficulty, 'hard');
    assert.deepEqual(task.tags, input.tags);
    const beforeDuplicate = await service.snapshot();
    assert.equal((await request('POST', '/tasks', input)).status, 409);
    assert.deepEqual(await service.snapshot(), beforeDuplicate);
    assert.equal((await request('PATCH', `/tasks/${task.id}`, { id: input.id })).status, 400);
    assert.equal(task.completedAt, null);
    assert.deepEqual(task.subtasks, []);
    assert.equal(
      (await request('PATCH', `/tasks/${task.id}`, { completedAt: '2026-01-02T12:00:00Z' })).status,
      400,
    );
    const done = await data(
      await request('POST', `/tasks/${task.id}/complete`, {}, { 'If-Match': etag }),
    );
    assert.ok(
      Date.parse(done.completedAt) >= started && Date.parse(done.completedAt) <= Date.now(),
    );
    assert.deepEqual(done.subtasks, []);
    assert.deepEqual(done.dates, input.dates);
    assert.equal(done.notes, input.notes);
    assert.equal(done.history.length, 1);
    assert.equal(done.history[0].at, done.completedAt);
    assert.equal(done.history[0].done, true);
    const read = await request('GET', `/tasks/${task.id}`);
    assert.deepEqual(await data(read), done);
    assert.deepEqual(
      await data(
        await request(
          'POST',
          `/tasks/${task.id}/complete`,
          {},
          {
            'If-Match': read.headers.get('etag')!,
          },
        ),
      ),
      done,
    );
    const persisted = (await new FileStore(service.storage.directory).load()).state;
    assert.deepEqual(
      persisted.tasks.find((row) => row.id === task.id),
      done,
    );
    assert.deepEqual(persisted.timelog.timer, timer);
    await data(await request('DELETE', `/tasks/${task.id}`));
    assert.equal((await request('POST', '/tasks', input)).status, 409);
    assert.equal((await service.snapshot()).state.tasks.length, 1);
  });
});

test('configure cannot revive a countdown that expires between the request read and queued mutation', async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  await apiFixture(async (service, request) => {
    const activityId = (await service.snapshot()).state.timelog.activities[0].id;
    const timer = await data(
      await request('POST', '/timelog/timer/start', {
        activityId,
        startAt: now - 60000,
        endAt: now + 60000,
      }),
    );
    const read = await request('GET', '/timelog/timer');
    const mutate = service.mutate.bind(service);
    service.mutate = (transform, expected) => {
      t.mock.timers.tick(60001);
      return mutate(transform, expected);
    };
    try {
      const response = await request(
        'POST',
        '/timelog/timer/configure',
        { timerId: timer.id, taskId: null, endAt: now + 3600000 },
        { 'If-Match': read.headers.get('etag')! },
      );
      assert.equal(response.status, 409);
      assert.match((await response.json()).data.error, /Timer has ended/);
    } finally {
      service.mutate = mutate;
    }
    const saved = (await service.snapshot()).state.timelog;
    assert.equal(saved.timer, null);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.records[0].id, timer.id);
    assert.deepEqual(saved.records[0].spans, [{ start: now - 60000, end: now + 60000 }]);
    assert.deepEqual((await new FileStore(service.storage.directory).load()).state.timelog, saved);
  });
});

test('StateService schedules exactly one deadline, shifts it across pause and resumes, and disposes it', async (t) => {
  const now = 1792700000000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  await fixture(async (service) => {
    const initial = await service.restore(stateWithActivities());
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
    const state = stateWithActivities();
    state.timelog = startTimer(
      timelogWithActivities(),
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
