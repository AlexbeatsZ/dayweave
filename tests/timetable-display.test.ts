import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  emptySchedule,
  scheduleSchema,
  timetableDayCount,
  courseOccurrences,
} from '../src/schedule.js';
import { emptyState, stateSchema } from '../src/model.js';
import { applyDelta, diffState } from '../src/state-delta.js';
import { fromDocument, mergeDocuments, toDocument } from '../src/sync/document.js';
import { wallTime } from '../src/timezone.js';
import { startApi } from '../electron/api.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';

function schedule() {
  return scheduleSchema.parse({ ...emptySchedule(), semesterStart: '2026-09-07', totalWeeks: 12 });
}
const course = {
  id: 'weekend-course',
  name: '周末实验',
  teacher: '',
  location: '',
  color: '#4488cc',
  weekday: 6,
  start: '08:00',
  end: '09:40',
  weeks: [12],
  excludedDates: [],
  updatedAt: 1,
};
function event(startDate: string, startClock: string, endDate: string, endClock: string) {
  return {
    id: 'weekend-event',
    courseId: '',
    name: '日历课程',
    location: '',
    teacher: '',
    color: '#4488cc',
    start: wallTime(startDate, startClock, 'Asia/Shanghai'),
    end: wallTime(endDate, endClock, 'Asia/Shanghai'),
    timeZone: 'Asia/Shanghai',
    updatedAt: 1,
  };
}

test('automatic timetable checks actual recurring weekend courses across the entire semester', () => {
  const value = schedule();
  assert.equal(timetableDayCount(value), 5);
  value.courses = [{ ...course, weekday: 1 }];
  assert.equal(timetableDayCount(value), 5);
  value.courses = [{ ...course }];
  assert.equal(timetableDayCount(value), 7, 'a week-12 class must be visible from week 1');
  value.courses[0].excludedDates = ['2026-11-28'];
  assert.equal(timetableDayCount(value), 5);
  value.courses[0].excludedDates = [];
  value.holidays = ['2026-11-28'];
  assert.equal(timetableDayCount(value), 5);
  value.courses[0].weeks = [11, 12];
  assert.equal(
    timetableDayCount(value),
    7,
    'one cancelled weekend cannot hide another teaching week',
  );
});

test('automatic timetable evaluates calendar events in the schedule zone with exclusive end boundaries', () => {
  const value = schedule();
  // UTC Friday is already Saturday in Shanghai, regardless of the host UTC-4 date.
  value.events = [event('2026-10-17', '00:30', '2026-10-17', '02:00')];
  assert.equal(timetableDayCount(value), 7);
  value.events = [event('2026-10-16', '23:30', '2026-10-17', '00:00')];
  assert.equal(timetableDayCount(value), 5, 'midnight end does not occupy Saturday');
  value.events[0].end += 1;
  assert.equal(
    timetableDayCount(value),
    7,
    'a Friday event extending into Saturday occupies the weekend',
  );
  value.events = [event('2026-12-05', '08:00', '2026-12-05', '09:00')];
  assert.equal(
    timetableDayCount(value),
    5,
    'outside-semester events do not determine this semester width',
  );
  value.events = [event('2026-09-06', '23:30', '2026-09-07', '00:30')];
  assert.equal(
    timetableDayCount(value),
    5,
    'a pre-semester Sunday only overlaps Monday in this term',
  );
});

test('day-display defaults migrate old backups, fixed choices preserve courses, and deltas/sync retain the choice', () => {
  const { displayDays: _displayDays, ...legacy } = schedule();
  assert.equal(scheduleSchema.parse(legacy).displayDays, 'auto');
  assert.equal(
    stateSchema.parse({ ...emptyState(), schedule: legacy }).schedule.displayDays,
    'auto',
  );
  const base = emptyState();
  base.schedule = schedule();
  base.schedule.courses = [{ ...course }];
  const before = courseOccurrences(base.schedule);
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.schedule.displayDays = 5;
  remote.schedule.holidays = ['2026-10-01'];
  assert.equal(timetableDayCount(local.schedule), 5);
  assert.deepEqual(courseOccurrences(local.schedule), before);
  assert.equal(applyDelta(base, diffState(base, local)).schedule.displayDays, 5);
  const merged = mergeDocuments(toDocument(base), toDocument(local), toDocument(remote));
  assert.equal(merged.conflicts.length, 0);
  const restored = fromDocument(merged.doc, emptyState());
  assert.equal(restored.schedule.displayDays, 5);
  assert.deepEqual(restored.schedule.holidays, ['2026-10-01']);
  assert.deepEqual(restored.schedule.courses, base.schedule.courses);
  restored.schedule.courses = [];
  restored.schedule.displayDays = 7;
  assert.equal(timetableDayCount(restored.schedule), 7);
  for (const invalid of [0, 6, 8, '5', 'weekend', null])
    assert.equal(scheduleSchema.safeParse({ ...legacy, displayDays: invalid }).success, false);
});

test('schedule API saves automatic/fixed day display without resetting it in unrelated patches', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-timetable-display-'));
  const service = new StateService(new FileStore(directory));
  const api = await startApi(service, 0);
  const patch = (body: unknown) =>
    fetch(`${api.info.url}/schedule`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${api.info.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  try {
    let response = await patch({ displayDays: 7 });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).data.displayDays, 7);
    response = await patch({ holidays: ['2026-10-01'] });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).data.displayDays, 7);
    assert.equal((await new FileStore(directory).load()).state.schedule.displayDays, 7);
    assert.equal((await patch({ displayDays: 6 })).status, 400);
    response = await patch({ displayDays: 'auto' });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).data.displayDays, 'auto');
  } finally {
    await api.close();
    service.dispose();
    await service.flush();
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
