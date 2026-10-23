import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  courseOccurrences,
  coursePeriodsSchema,
  defaultCoursePeriods,
  emptySchedule,
  scheduleSchema,
  type CoursePeriod,
} from '../src/schedule.js';
import { emptyState, newTask, stateSchema } from '../src/model.js';
import { applyDelta, diffState } from '../src/state-delta.js';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document.js';
import { startApi } from '../electron/api.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';

const customPeriods: CoursePeriod[] = [
  { start: '09:15', end: '10:00', section: 'morning' },
  { start: '10:10', end: '10:55', section: 'morning' },
  { start: '19:00', end: '19:45', section: 'evening' },
];
const course = {
  id: 'chemistry',
  name: '物理化学',
  teacher: '教师',
  location: 'H4306',
  color: '#4488cc',
  weekday: 1,
  start: '08:00',
  end: '09:40',
  weeks: [1, 3],
  excludedDates: [],
  updatedAt: Date.UTC(2026, 8, 1),
};

test('old schedules receive independent default course-period arrays without modifying source defaults', () => {
  const { periods: _periods, ...legacy } = emptySchedule();
  const first = scheduleSchema.parse(legacy);
  const second = scheduleSchema.parse(legacy);
  assert.deepEqual(first.periods, defaultCoursePeriods);
  assert.notEqual(first.periods, defaultCoursePeriods);
  assert.notEqual(first.periods[0], defaultCoursePeriods[0]);
  assert.notEqual(first.periods, second.periods);
  first.periods[0].start = '07:30';
  assert.equal(second.periods[0].start, '08:00');
  assert.equal(defaultCoursePeriods[0].start, '08:00');
  const fresh = emptySchedule();
  fresh.periods[0].start = '07:45';
  assert.equal(emptySchedule().periods[0].start, '08:00');
  const oldState = { ...emptyState(), schedule: legacy };
  assert.deepEqual(stateSchema.parse(oldState).schedule.periods, defaultCoursePeriods);
});

test('course periods accept empty day sections and adjacent boundaries while requiring an ordered nonempty day', () => {
  assert.deepEqual(coursePeriodsSchema.parse(customPeriods), customPeriods);
  assert.equal(
    customPeriods.some((period) => period.section === 'afternoon'),
    false,
  );
  assert.equal(
    coursePeriodsSchema.safeParse([{ start: '19:00', end: '19:45', section: 'evening' }]).success,
    true,
  );
  assert.equal(
    coursePeriodsSchema.safeParse([
      { start: '08:00', end: '08:45', section: 'morning' },
      { start: '08:45', end: '09:30', section: 'morning' },
    ]).success,
    true,
  );
  for (const invalid of [
    [],
    [{ start: '08:45', end: '08:45', section: 'morning' }],
    [{ start: '08:45', end: '08:00', section: 'morning' }],
    [{ start: '24:00', end: '24:45', section: 'evening' }],
    [{ start: '08:00', end: '08:45', section: 'noon' }],
    [
      { start: '08:00', end: '09:00', section: 'morning' },
      { start: '08:45', end: '09:30', section: 'afternoon' },
    ],
    [
      { start: '14:00', end: '14:45', section: 'afternoon' },
      { start: '15:00', end: '15:45', section: 'morning' },
    ],
    [
      { start: '09:00', end: '09:45', section: 'morning' },
      { start: '08:00', end: '08:45', section: 'morning' },
    ],
  ]) {
    assert.equal(coursePeriodsSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('course-period deltas and sync preserve unrelated edits and retain independent remote schedule fields', () => {
  const base = emptyState();
  base.tasks = [newTask('复习课程', { id: 'review' })];
  const local = structuredClone(base);
  local.schedule.periods = structuredClone(customPeriods);
  const remote = structuredClone(base);
  remote.tasks[0].notes = '另一设备上的备注';
  const applied = applyDelta(remote, diffState(base, local));
  assert.deepEqual(applied.schedule.periods, customPeriods);
  assert.equal(applied.tasks[0].notes, '另一设备上的备注');
  remote.schedule.holidays = ['2026-10-01'];
  const merged = mergeDocuments(toDocument(base), toDocument(local), toDocument(remote));
  assert.equal(merged.conflicts.length, 0);
  const restored = fromDocument(merged.doc, emptyState());
  assert.deepEqual(restored.schedule.periods, customPeriods);
  assert.deepEqual(restored.schedule.holidays, ['2026-10-01']);
  assert.equal(restored.tasks[0].notes, '另一设备上的备注');
  assert.deepEqual(
    fromDocument(toDocument(restored), emptyState()).schedule.periods,
    customPeriods,
  );
});

test('changing course periods cannot reinterpret existing course clocks or actual occurrence instants', () => {
  const schedule = scheduleSchema.parse({
    ...emptySchedule(),
    semesterStart: '2026-09-07',
    timeZone: 'Asia/Shanghai',
    courses: [course],
  });
  const before = courseOccurrences(schedule);
  assert.equal(before[0].start, Date.parse('2026-09-07T00:00:00.000Z'));
  assert.equal(before[0].end, Date.parse('2026-09-07T01:40:00.000Z'));
  const edited = scheduleSchema.parse({ ...schedule, periods: customPeriods });
  assert.equal(edited.courses[0].start, '08:00');
  assert.equal(edited.courses[0].end, '09:40');
  assert.deepEqual(edited.courses, schedule.courses);
  assert.deepEqual(courseOccurrences(edited), before);
});

test('authenticated schedule API persists period customization without shifting courses or resetting it on unrelated patches', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-course-periods-'));
  const service = new StateService(new FileStore(directory));
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
    await service.mutate((state) => ({
      ...state,
      schedule: scheduleSchema.parse({
        ...state.schedule,
        semesterStart: '2026-09-07',
        timeZone: 'Asia/Shanghai',
        courses: [course],
      }),
    }));
    const before = courseOccurrences((await service.snapshot()).state.schedule);
    let response = await request('PATCH', '/schedule', { periods: customPeriods });
    assert.equal(response.status, 200, await response.clone().text());
    const saved = (await response.json()).data;
    assert.deepEqual(saved.periods, customPeriods);
    assert.equal(saved.courses[0].start, '08:00');
    assert.equal(saved.courses[0].end, '09:40');
    assert.deepEqual(courseOccurrences(saved), before);
    response = await request('PATCH', '/schedule', { holidays: ['2026-10-01'] });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).data.periods, customPeriods);
    assert.equal((await request('PATCH', '/schedule', { periods: [] })).status, 400);
    const loaded = (await new FileStore(directory).load()).state.schedule;
    assert.deepEqual(loaded.periods, customPeriods);
    assert.deepEqual(loaded.holidays, ['2026-10-01']);
    assert.deepEqual(courseOccurrences(loaded), before);
  } finally {
    await api.close();
    service.dispose();
    await service.flush();
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
