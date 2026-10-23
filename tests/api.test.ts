import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from '../electron/storage';
import { StateService } from '../electron/state-service';
import { request as httpRequest } from 'node:http';
import { startApi } from '../electron/api';
import { applyDelta, diffState, StateConflict } from '../src/state-delta';
import { emptyState, newTask, now } from '../src/model';

test('start-only record is a live timer and stopping closes the same record ID', async () =>
  fixture(async ({ request }) => {
    const startAt = Date.now() - 60000;
    const response = await request('POST', '/time-records', { startAt, note: 'AI 统一计时' });
    assert.equal(response.status, 200);
    const { data: record } = await response.json();
    assert.equal(record.startAt, startAt);
    assert.equal(record.endAt, null);
    assert.ok(record.elapsedMs >= 60000);
    const stopped = await request('POST', `/time-records/${record.id}/stop`, {});
    assert.equal(stopped.status, 200);
    const { data: closed } = await stopped.json();
    assert.equal(closed.id, record.id);
    assert.ok(closed.endAt > startAt);
    assert.equal((await request('POST', `/time-records/${record.id}/stop`, {})).status, 409);
    const { data: records } = await (await request('GET', '/time-records')).json();
    assert.equal(records.length, 1);
  }));

test('unified context, timetable writes and stale course revisions share the persisted API state', async () =>
  fixture(async ({ request }) => {
    let response = await request('PATCH', '/schedule', {
      semesterStart: '2026-09-07',
      totalWeeks: 18,
      timeZone: 'Asia/Shanghai',
    });
    assert.equal(response.status, 200);
    const input = {
      name: 'API Chemistry',
      weekday: 1,
      start: '08:00',
      end: '09:40',
      weeks: [1, 3],
      location: 'H4306',
      teacher: '',
      color: '#4264b2',
      excludedDates: [],
    };
    response = await request('POST', '/schedule/courses', input);
    assert.equal(response.status, 200);
    const etag = response.headers.get('etag')!,
      { data: course } = await response.json();
    assert.equal(
      (
        await request(
          'PATCH',
          `/schedule/courses/${course.id}`,
          { location: 'H3304' },
          { 'If-Match': etag },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          'PATCH',
          `/schedule/courses/${course.id}`,
          { location: 'stale' },
          { 'If-Match': etag },
        )
      ).status,
      409,
    );
    const { data: events } = await (
      await request('GET', '/schedule/occurrences?from=1788737400000&until=1791329400000')
    ).json();
    assert.equal(events[0].start, Date.parse('2026-09-07T00:00:00Z'));
    assert.equal(events[0].location, 'H3304');
    const { data: context } = await (await request('GET', '/context')).json();
    assert.equal(context.timeZone, 'Asia/Shanghai');
    assert.equal(context.courseTimeZone, 'Asia/Shanghai');
    assert.ok(Array.isArray(context.tasks));
  }));

test('task tracking appears in shared timer, survives pause/resume and writes the task-linked record', async () =>
  fixture(async ({ request, service }) => {
    const { data: task } = await (await request('POST', '/tasks', { title: 'Track this' })).json();
    const response = await request('POST', `/tasks/${task.id}/track`, {});
    assert.equal(response.status, 200);
    const { data: timer } = await response.json();
    assert.equal(timer.taskId, task.id);
    assert.equal((await request('POST', '/timelog/timer/pause', { timerId: 'stale' })).status, 409);
    assert.equal(
      (await request('POST', '/timelog/timer/pause', { timerId: timer.id })).status,
      200,
    );
    await service.mutate((s) => ({
      ...s,
      timelog: {
        ...s.timelog,
        timer: {
          ...s.timelog.timer!,
          startedAt: Date.now() - 60000,
          runningSince: Date.now() - 60000,
          spans: [],
        },
      },
    }));
    assert.equal((await request('POST', '/timelog/timer/stop', { timerId: timer.id })).status, 200);
    const { data: records } = await (await request('GET', '/timelog/records')).json();
    assert.equal(records.items[0].taskId, task.id);
    assert.equal((await service.snapshot()).state.timelog.records[0].taskId, task.id);
  }));

test('course import preview is read-only and repeat import keeps a single stable course ID', async () =>
  fixture(async ({ request, service }) => {
    const content = 'name,weekday,start,end,weeks,location\nCSV Class,1,08:00,09:40,1-16,H4306';
    const input = { name: 'course.csv', content };
    assert.equal((await request('POST', '/schedule/import', input)).status, 200);
    assert.equal((await service.snapshot()).state.schedule.courses.length, 0);
    assert.equal(
      (await request('POST', '/schedule/import', { ...input, preview: false })).status,
      200,
    );
    assert.equal(
      (await request('POST', '/schedule/import', { ...input, preview: false })).status,
      200,
    );
    assert.equal((await service.snapshot()).state.schedule.courses.length, 1);
    assert.equal(
      (await request('POST', '/schedule/import', { ...input, content: 'bad', preview: false }))
        .status,
      400,
    );
    assert.equal((await service.snapshot()).state.schedule.courses.length, 1);
  }));

async function fixture(
  run: (context: {
    service: StateService;
    url: string;
    token: string;
    request: (
      method: string,
      route: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<Response>;
  }) => Promise<void>,
) {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'clearlist-api-'));
  const service = new StateService(new FileStore(directory));
  const api = await startApi(service, 0);
  const request = (
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${api.info.url}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${api.info.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    await run({ service, ...api.info, request });
  } finally {
    await api.close();
    assert.ok(directory.startsWith(base + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
}
test('API rejects missing authentication, browser origins and forged hosts', async () =>
  fixture(async ({ url, request, service }) => {
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal(
      (await request('GET', '/health', undefined, { Origin: 'https://example.com' })).status,
      403,
    );
    const forged = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${url}/health`, { headers: { Host: 'example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(forged, 403);
    const health = await request('GET', '/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('Access-Control-Allow-Origin'), null);
    const config = JSON.parse(
      await readFile(path.join(service.storage.directory, 'api.json'), 'utf8'),
    );
    assert.equal(config.url, url);
  }));
test('task creation, lookup, pagination, search and strict validation share persisted state', async () =>
  fixture(async ({ service, request }) => {
    let response = await request('POST', '/tasks', {
      title: 'API task',
      notes: 'searchable',
      due: '2026-10-26',
      priority: 1,
    });
    assert.equal(response.status, 200);
    const { data: task } = await response.json();
    assert.equal((await (await request('GET', `/tasks/${task.id}`)).json()).data.title, 'API task');
    const list = (await (await request('GET', '/tasks?q=searchable&limit=1')).json()).data;
    assert.equal(list.total, 1);
    assert.equal(list.items[0].id, task.id);
    for (const input of [
      { title: 'Invalid', due: '2026-02-30' },
      { title: 'Invalid', listId: 'missing' },
      { title: 'Invalid', completedAt: now() },
    ])
      assert.equal((await request('POST', '/tasks', input)).status, 400);
    assert.equal((await request('GET', '/tasks?limit=9999')).status, 400);
    assert.equal((await service.snapshot()).state.tasks.length, 1);
    assert.equal(
      JSON.parse(await readFile(service.storage.file, 'utf8')).tasks[0].title,
      'API task',
    );
  }));
test('ETag protects stale API writes and field deltas merge disjoint UI edits', async () =>
  fixture(async ({ service, request }) => {
    const created = await request('POST', '/tasks', { title: 'Original' });
    const etag = created.headers.get('etag')!;
    const task = (await created.json()).data;
    const base = (await service.snapshot()).state;
    const local = {
      ...base,
      tasks: base.tasks.map((t) => ({ ...t, notes: 'UI notes', updatedAt: now() })),
    };
    assert.equal(
      (await request('PATCH', `/tasks/${task.id}`, { title: 'AI title' }, { 'If-Match': etag }))
        .status,
      200,
    );
    assert.equal(
      (await request('PATCH', `/tasks/${task.id}`, { priority: 2 }, { 'If-Match': etag })).status,
      409,
    );
    await service.patch(diffState(base, local));
    const saved = (await service.snapshot()).state.tasks[0];
    assert.equal(saved.title, 'AI title');
    assert.equal(saved.notes, 'UI notes');
    const conflict = { ...base, tasks: [{ ...base.tasks[0], title: 'Conflicting UI title' }] };
    await assert.rejects(service.patch(diffState(base, conflict)), StateConflict);
    assert.equal((await service.snapshot()).state.tasks[0].title, 'AI title');
  }));
test('completion and reopening are idempotent and preserve recurring task history', async () =>
  fixture(async ({ request, service }) => {
    const task = (
      await (
        await request('POST', '/tasks', { title: 'Daily', due: '2026-10-19', repeat: 'daily' })
      ).json()
    ).data;
    for (let i = 0; i < 2; i++)
      assert.equal((await request('POST', `/tasks/${task.id}/complete`)).status, 200);
    assert.equal((await service.snapshot()).state.tasks.length, 2);
    await request('POST', `/tasks/${task.id}/reopen`);
    await request('POST', `/tasks/${task.id}/complete`);
    assert.equal((await service.snapshot()).state.tasks.length, 2);
    assert.equal(
      (await service.snapshot()).state.tasks.find((t) => t.parentId === task.id)?.due,
      '2026-10-20',
    );
  }));
test('soft deletion and list removal preserve task data and support restoration', async () =>
  fixture(async ({ request, service }) => {
    const list = (
      await (await request('POST', '/lists', { name: 'Research', color: '#326559' })).json()
    ).data;
    const task = (
      await (await request('POST', '/tasks', { title: 'Keep me', listId: list.id })).json()
    ).data;
    await request('DELETE', `/tasks/${task.id}`);
    assert.equal((await request('PATCH', `/tasks/${task.id}`, { notes: 'blocked' })).status, 409);
    assert.equal((await (await request('GET', '/tasks?view=trash')).json()).data.total, 1);
    await request('POST', `/tasks/${task.id}/restore`);
    await request('DELETE', `/lists/${list.id}`);
    const state = (await service.snapshot()).state;
    assert.equal(state.tasks[0].listId, 'inbox');
    assert.equal(state.tasks[0].title, 'Keep me');
    assert.equal((await request('DELETE', '/lists/inbox')).status, 409);
  }));
test('removed Pomodoro routes cannot create or modify legacy focus data', async () =>
  fixture(async ({ request, service }) => {
    const original = await service.mutate((state) => ({
      ...state,
      timer: {
        id: 'legacy-focus-timer',
        taskId: null,
        title: 'Old active focus',
        kind: 'focus',
        duration: 1500,
        remaining: 1500,
        endAt: null,
      },
      sessions: [
        {
          id: 'legacy-focus-session',
          taskId: null,
          title: 'Old completed focus',
          minutes: 25,
          completedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    }));
    assert.equal((await request('GET', '/focus')).status, 404);
    for (const action of ['start', 'pause', 'resume', 'cancel'])
      assert.equal(
        (await request('POST', `/focus/${action}`, { minutes: 1, kind: 'focus' })).status,
        404,
      );
    assert.equal((await request('PATCH', '/settings', { focusMinutes: 1 })).status, 400);
    assert.equal((await request('PATCH', '/settings', { breakMinutes: 1 })).status, 400);
    assert.deepEqual(await service.snapshot(), original);
    const spec = await (await request('GET', '/openapi.json')).json();
    assert.equal(
      Object.keys(spec.paths).some((route) => route.startsWith('/focus')),
      false,
    );
  }));
test('JSON import/export excludes credentials and invalid imports do not change data', async () =>
  fixture(async ({ request, token, service }) => {
    const incoming = { ...emptyState(), tasks: [newTask('Imported')] };
    assert.equal((await request('POST', '/import', incoming)).status, 200);
    assert.equal((await request('POST', '/import', incoming)).status, 200);
    assert.equal((await request('POST', '/import', { version: 2 })).status, 400);
    const exported = await (await request('GET', '/export')).text();
    assert.equal(exported.includes(token), false);
    assert.equal(JSON.parse(exported).data.tasks.length, 1);
    assert.equal((await service.snapshot()).state.tasks[0].title, 'Imported');
    const spec = await (await request('GET', '/openapi.json')).json();
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.paths['/tasks']);
  }));
test('field delta rejects orphan references and does not mutate its input', () => {
  const task = newTask('Original');
  const base = { ...emptyState(), tasks: [task] };
  const next = { ...base, tasks: [{ ...task, listId: 'missing' }] };
  assert.throws(() => applyDelta(base, diffState(base, next)));
  assert.equal(base.tasks[0].listId, 'inbox');
});

test('failed persistence does not publish a state and a later mutation can recover', async () =>
  fixture(async ({ service }) => {
    const original = await service.snapshot();
    const save = service.storage.save.bind(service.storage);
    let broadcasts = 0;
    service.subscribe(() => {
      broadcasts++;
    });
    service.storage.save = async () => {
      throw new Error('Simulated disk failure');
    };
    await assert.rejects(
      service.mutate((s) => ({ ...s, tasks: [newTask('Unsaved')] })),
      /disk failure/,
    );
    assert.deepEqual(await service.snapshot(), original);
    assert.equal(broadcasts, 0);
    service.storage.save = save;
    await service.mutate((s) => ({ ...s, tasks: [newTask('Saved')] }));
    assert.equal(broadcasts, 1);
    assert.equal((await service.snapshot()).state.tasks[0].title, 'Saved');
  }));
