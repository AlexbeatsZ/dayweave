import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFudanCourses } from '../src/fudan-import.js';
import { fudanSource, refreshFudanSchedule } from '../src/fudan-refresh.js';
import { emptySchedule, scheduleSchema, type Schedule } from '../src/schedule.js';
import { wallTime } from '../src/timezone.js';

const at = Date.UTC(2026, 9, 23);
const semester = {
  id: 520,
  startDate: '2026-09-07',
  endDate: '2027-01-24',
  weekStartOnSunday: false,
};
function activity(lessonId = 10, room = 'H4306', weekday = 1) {
  return {
    lessonId,
    courseName: `课程 ${lessonId}`,
    weekday,
    startTime: '08:00',
    endTime: '09:40',
    room,
    weekIndexes: [1, 3, 5],
    teacherName: '示例教师',
  };
}
function preview(
  activities = [activity()],
  options: { base?: Schedule; at?: number; sunday?: boolean } = {},
) {
  return parseFudanCourses(
    JSON.stringify({
      semester: options.sunday
        ? { ...semester, startDate: '2026-09-06', weekStartOnSunday: true }
        : semester,
      activities,
    }),
    options.base ?? emptySchedule(),
    options.at ?? at,
    true,
  );
}
function withManual(local: Schedule) {
  return scheduleSchema.parse({
    ...local,
    displayDays: 7,
    periods: [{ start: '07:30', end: '08:15', section: 'morning' }],
    holidays: ['2026-10-01'],
    courses: [
      ...local.courses,
      { ...local.courses[0], id: 'manual-course', name: '手动安排', updatedAt: at + 10 },
    ],
    events: [
      ...local.events,
      {
        id: 'manual-event',
        courseId: '',
        name: '手动事件',
        location: '自定地点',
        teacher: '',
        color: '#4488cc',
        start: wallTime('2026-10-23', '14:00', 'Asia/Shanghai'),
        end: wallTime('2026-10-23', '15:00', 'Asia/Shanghai'),
        timeZone: 'Asia/Shanghai',
        updatedAt: at + 20,
      },
    ],
  });
}

test('unchanged school data returns the exact local schedule despite later timestamps, ordering and manual rows', () => {
  const initial = preview([activity(), activity(11, 'H4104', 3)]);
  const local = withManual(initial.schedule);
  const before = structuredClone(local);
  const next = preview([activity(11, 'H4104', 3), activity()], { at: at + 1000 });
  assert.equal(refreshFudanSchedule(local, next, fudanSource(initial, at)), local);
  assert.deepEqual(local, before);
});

test('changed school rows replace their previous IDs while preserving manual courses, events and display settings', () => {
  const initial = preview([activity(), activity(11, 'H4104', 3)]);
  const source = fudanSource(initial, at);
  const local = withManual(initial.schedule);
  const before = structuredClone(local);
  const next = preview([activity(10, '新教室')], { at: at + 1000 });
  const result = refreshFudanSchedule(local, next, source);
  assert.deepEqual(local, before, 'input state remains immutable');
  assert.deepEqual(
    result.courses.filter((row) => row.id === 'manual-course'),
    [before.courses[2]],
  );
  assert.deepEqual(result.events, before.events);
  assert.deepEqual(
    result.courses.filter((row) => row.id !== 'manual-course'),
    next.schedule.courses,
  );
  for (const oldId of source.courseIds)
    assert.equal(
      result.courses.some((row) => row.id === oldId),
      false,
    );
  assert.deepEqual(result.periods, before.periods);
  assert.deepEqual(result.holidays, before.holidays);
  assert.equal(result.displayDays, 7);
  assert.equal(result.semesterStart, before.semesterStart);
  assert.equal(result.totalWeeks, before.totalWeeks);
  assert.equal(result.timeZone, before.timeZone);
});

test('a now-empty school semester deletes only subscribed courses and keeps local configuration', () => {
  const initial = preview();
  const source = fudanSource(initial, at);
  const local = withManual(initial.schedule);
  const next = preview([], { at: at + 1000 });
  const result = refreshFudanSchedule(local, next, source);
  assert.deepEqual(
    result.courses.map((row) => row.id),
    ['manual-course'],
  );
  assert.deepEqual(result.events, local.events);
  assert.deepEqual(result.periods, local.periods);
  assert.deepEqual(result.holidays, local.holidays);
  assert.equal(result.displayDays, local.displayDays);
});

test('Sunday dated instances are replaced together with weekly classes and leave manual events intact', () => {
  const initial = preview([activity(), activity(11, 'H4104', 7)], { sunday: true });
  const source = fudanSource(initial, at);
  const local = withManual(initial.schedule);
  assert.equal(source.eventIds.length, 3);
  const next = preview([activity(), { ...activity(11, '新教室', 7), weekIndexes: [3] }], {
    at: at + 1000,
    sunday: true,
  });
  const result = refreshFudanSchedule(local, next, source);
  assert.deepEqual(
    result.events.filter((row) => row.id !== 'manual-event'),
    next.schedule.events,
  );
  assert.deepEqual(
    result.events.find((row) => row.id === 'manual-event'),
    local.events.at(-1),
  );
  assert.equal(
    result.events.some((row) => source.eventIds.includes(row.id)),
    false,
  );
});

test('refresh checks current semester and timezone before changing any data', () => {
  const initial = preview();
  const source = fudanSource(initial, at);
  const next = preview([activity(10, '新教室')], { at: at + 1000 });
  const cases = [
    { ...initial.schedule, semesterStart: '2026-09-14' },
    { ...initial.schedule, totalWeeks: 19 },
    { ...initial.schedule, timeZone: 'America/New_York' },
  ];
  for (const local of cases) {
    const before = structuredClone(local);
    assert.throws(() => refreshFudanSchedule(local, next, source), /学期或时区已改变/);
    assert.deepEqual(local, before);
  }
  assert.throws(
    () =>
      refreshFudanSchedule(
        initial.schedule,
        { ...next, source: { kind: 'fudan', semesterId: '521' } },
        source,
      ),
    /学期或时区已改变/,
  );
});

test('refresh merges against the latest local state so manual edits made during capture survive', () => {
  const initial = preview();
  const source = fudanSource(initial, at);
  const next = preview([activity(10, '新教室')], { at: at + 1000 });
  const latest = withManual(initial.schedule);
  latest.courses.find((row) => row.id === 'manual-course')!.name = '读取期间新增的修改';
  const result = refreshFudanSchedule(latest, next, source);
  assert.equal(
    result.courses.find((row) => row.id === 'manual-course')?.name,
    '读取期间新增的修改',
  );
  assert.equal(
    result.courses.find((row) => row.id === next.schedule.courses[0].id)?.location,
    '新教室',
  );
});
