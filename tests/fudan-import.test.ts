import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFudanCourses } from '../src/fudan-import';
import { emptySchedule, courseOccurrences, mergeSchedule } from '../src/schedule';
import { zoneDateKey, zoneClock } from '../src/timezone';

const at = Date.UTC(2026, 9, 23);
const capture = {
  semester: { id: 520, startDate: '2026-09-07', endDate: '2027-01-24', weekStartOnSunday: false },
  activities: [
    {
      lessonId: 10,
      courseName: '量子化学原理及应用(H)',
      weekday: 1,
      startTime: '08:00',
      endTime: '09:40',
      room: 'H4306',
      weekIndexes: [1, 3, 5],
      teacherName: '徐老师',
    },
    {
      lessonId: 10,
      courseName: '量子化学原理及应用(H)',
      weekday: 1,
      startTime: '08:00',
      endTime: '09:40',
      room: 'H4306',
      weekIndexes: [3, 7],
      teacherName: '徐老师',
    },
    {
      lessonId: 11,
      courseName: '物理化学实验',
      weekday: 3,
      startTime: 855,
      endTime: '12:30:00',
      room: '化学楼',
      weekIndexes: [2, 4],
      teacherNames: ['黄老师', '刘老师'],
    },
  ],
};
test('Fudan minimal capture becomes a timezone-correct preview with stable IDs and merged teaching weeks', () => {
  const base = emptySchedule();
  const snapshot = structuredClone(base);
  const first = parseFudanCourses(JSON.stringify(capture), base, at),
    second = parseFudanCourses(JSON.stringify(capture), base, at + 1000);
  assert.deepEqual(base, snapshot);
  assert.equal(first.schedule.timeZone, 'Asia/Shanghai');
  assert.equal(first.schedule.semesterStart, '2026-09-07');
  assert.equal(first.schedule.totalWeeks, 20);
  assert.equal(first.schedule.courses.length, 2);
  assert.deepEqual(first.schedule.courses[0].weeks, [1, 3, 5, 7]);
  assert.equal(first.schedule.courses[1].start, '08:55');
  assert.equal(first.schedule.courses[1].teacher, '黄老师、刘老师');
  assert.deepEqual(
    first.schedule.courses.map((course) => course.id),
    second.schedule.courses.map((course) => course.id),
  );
  assert.equal(mergeSchedule(first.schedule, second.schedule).courses.length, 2);
  const occurrence = courseOccurrences(first.schedule)[0];
  assert.equal(zoneClock(occurrence.start, 'Asia/Shanghai'), '08:00');
  assert.equal(zoneDateKey(occurrence.start, '-04:00'), '2026-09-06');
  assert.equal(zoneClock(occurrence.start, '-04:00'), '20:00');
});
test('Fudan Sunday-based weeks preserve Sunday instants without shifting them into the next week', () => {
  const source = {
    ...capture,
    semester: { ...capture.semester, startDate: '2026-09-06', weekStartOnSunday: true },
    activities: [
      { ...capture.activities[0], weekday: 7, weekIndexes: [1, 2] },
      { ...capture.activities[0], weekday: 1, weekIndexes: [1] },
    ],
  };
  const result = parseFudanCourses(JSON.stringify(source), emptySchedule(), at);
  assert.equal(result.schedule.semesterStart, '2026-09-07');
  assert.equal(result.schedule.events.length, 2);
  assert.equal(result.schedule.courses.length, 1);
  assert.deepEqual(
    courseOccurrences(result.schedule).map((row) => zoneDateKey(row.start, 'Asia/Shanghai')),
    ['2026-09-06', '2026-09-07', '2026-09-13'],
  );
  assert.equal(result.warnings.length, 1);
});
test('Fudan import rejects login pages, missing semester dates, partial rows and unsupported times before changing a schedule', () => {
  const base = emptySchedule();
  const before = JSON.stringify(base);
  for (const value of [
    '<html>统一身份认证</html>',
    JSON.stringify({ activities: capture.activities }),
    JSON.stringify({ ...capture, activities: [{ ...capture.activities[0], weekIndexes: [0] }] }),
    JSON.stringify({ ...capture, activities: [{ ...capture.activities[0], endTime: '07:00' }] }),
  ])
    assert.throws(() => parseFudanCourses(value, base));
  assert.throws(
    () =>
      parseFudanCourses(
        JSON.stringify({
          ...capture,
          activities: [{ ...capture.activities[0], startTime: '25:00' }],
        }),
        base,
      ),
    /时间无法识别/,
  );
  assert.equal(JSON.stringify(base), before);
});
