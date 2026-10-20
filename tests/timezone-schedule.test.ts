import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  mergeImport,
  newTask,
  dateKey,
  statistics,
  stateSchema,
} from '../src/model.js';
import {
  setTimeZone,
  wallTime,
  zoneDateKey,
  zoneClock,
  dayStart,
  shiftDay,
} from '../src/timezone.js';
import {
  emptySchedule,
  courseOccurrences,
  nextClasses,
  parseWeeks,
  mergeSchedule,
  scheduleSchema,
} from '../src/schedule.js';
import { importCourses, parseCsv } from '../src/course-import.js';
import {
  initialState,
  makeBackup,
  startTimer,
  finishTimer,
  dayRange,
  validateState,
} from '../src/timelog/domain.js';
import { applyDelta, diffState, StateConflict } from '../src/state-delta.js';

const course = {
  id: 'chem',
  name: '量子化学',
  weekday: 1,
  start: '08:00',
  end: '09:40',
  weeks: [1, 3],
  teacher: '',
  location: 'H4306',
  color: '#4264b2',
  excludedDates: [],
  updatedAt: 1,
};
const schedule = () =>
  scheduleSchema.parse({
    ...emptySchedule(),
    semesterStart: '2026-09-07',
    totalWeeks: 18,
    courses: [course],
  });
test('Shanghai course instants do not depend on UTC-4 device timezone and next class crosses local midnight', () => {
  const s = schedule(),
    now = Date.parse('2026-09-06T23:30:00Z');
  const next = nextClasses(s, now).next!;
  assert.equal(next.start, Date.parse('2026-09-07T00:00:00Z'));
  assert.equal(zoneDateKey(next.start, '-04:00'), '2026-09-06');
  assert.equal(zoneClock(next.start, '-04:00'), '20:00');
  assert.equal(zoneDateKey(next.start, s.timeZone), '2026-09-07');
  assert.equal(next.start - now, 30 * 60000);
});
test('odd/even weeks, gaps, holidays and term end choose the actual next class', () => {
  assert.deepEqual(parseWeeks('1-16双', 18), [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(parseWeeks('1,3,5-7', 18), [1, 3, 5, 6, 7]);
  const s = schedule();
  assert.equal(courseOccurrences(s).length, 2);
  assert.equal(nextClasses(s, Date.parse('2026-09-07T01:40:00Z')).current.length, 0);
  assert.equal(
    nextClasses(s, Date.parse('2026-09-07T01:40:00Z')).next!.start,
    Date.parse('2026-09-21T00:00:00Z'),
  );
  assert.equal(courseOccurrences({ ...s, holidays: ['2026-09-07'] }).length, 1);
  assert.equal(nextClasses(s, Date.parse('2026-12-30T00:00:00Z')).next, null);
});
test('IANA summer time has 23/25 hour day boundaries while fixed UTC-4 stays fixed', () => {
  setTimeZone('America/New_York');
  assert.equal(dayRange('2026-03-08').end - dayRange('2026-03-08').start, 23 * 3600000);
  assert.equal(dayRange('2026-11-01').end - dayRange('2026-11-01').start, 25 * 3600000);
  assert.equal(wallTime('2026-12-01', '08:00', '-04:00'), Date.parse('2026-12-01T12:00:00Z'));
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
  setTimeZone('Asia/Shanghai');
});
test('task today and completion statistics follow selected schedule timezone', () => {
  setTimeZone('Asia/Shanghai');
  assert.equal(dateKey(new Date('2026-10-19T20:00:00Z')), '2026-10-20');
  const s = emptyState();
  s.tasks = [newTask('A', { completedAt: '2026-10-19T20:00:00.000Z' })];
  assert.equal(statistics(s, '2026-10-20').at(-1)!.completed, 1);
});
test('CSV quoted fields and Chinese headers import safely and reject invalid weeks/times', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,y","two\nlines"'), [
    ['a', 'b'],
    ['x,y', 'two\nlines'],
  ]);
  const p = importCourses(
    '课程名称,星期,开始时间,结束时间,周次,教室\n"化学,实验",周三,08:00,11:30,1-15单,329B',
    'courses.csv',
    schedule(),
  );
  assert.equal(p.schedule.courses.length, 1);
  assert.equal(p.schedule.courses[0].weekday, 3);
  assert.equal(p.schedule.courses[0].weeks.length, 8);
  assert.throws(() =>
    importCourses('name,weekday,start,end,weeks\nA,1,10:00,09:00,1-16', 'x.csv', schedule()),
  );
  assert.throws(() => parseWeeks('1-90', 20));
});
test('ICS weekly recurrence, EXDATE, UTC and floating schedule zone are expanded to real instants', () => {
  const ics =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:chemistry\r\nDTSTART;TZID=Asia/Shanghai:20260907T080000\r\nDTEND;TZID=Asia/Shanghai:20260907T094000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=Asia/Shanghai:20260914T080000\r\nSUMMARY:Chemistry\r\nLOCATION:H4306\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const p = importCourses(ics, 'x.ics', schedule());
  assert.equal(p.schedule.events.length, 2);
  assert.equal(p.schedule.events[0].start, Date.parse('2026-09-07T00:00:00Z'));
  assert.equal(p.schedule.events[1].start, Date.parse('2026-09-21T00:00:00Z'));
  const floating = ics.replaceAll(';TZID=Asia/Shanghai', '');
  assert.equal(
    importCourses(floating, 'x.ics', schedule()).schedule.events[0].start,
    p.schedule.events[0].start,
  );
});
test('ICS DST recurrence stays on its wall clock, explicit moved occurrence wins', () => {
  const base = scheduleSchema.parse({
    ...emptySchedule(),
    semesterStart: '2026-10-26',
    totalWeeks: 4,
    timeZone: 'America/New_York',
  });
  const ics =
    'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:dst\nDTSTART;TZID=America/New_York:20261026T080000\nDTEND;TZID=America/New_York:20261026T090000\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:DST\nEND:VEVENT\nBEGIN:VEVENT\nUID:dst\nRECURRENCE-ID;TZID=America/New_York:20261109T080000\nDTSTART;TZID=America/New_York:20261109T100000\nDTEND;TZID=America/New_York:20261109T110000\nSUMMARY:Moved\nEND:VEVENT\nEND:VCALENDAR';
  const events = importCourses(ics, 'x.ics', base).schedule.events;
  assert.equal(events.length, 3);
  assert.equal(events[0].start, Date.parse('2026-10-26T12:00:00Z'));
  assert.equal(events[1].start, Date.parse('2026-11-02T13:00:00Z'));
  assert.equal(events[2].start, Date.parse('2026-11-09T15:00:00Z'));
});
test('old Clearlist and Timelog backups merge into the same store and retain task links', () => {
  const old = JSON.parse(JSON.stringify(emptyState()));
  delete old.timelog;
  delete old.schedule;
  delete old.settings.timeZone;
  old.tasks = [newTask('Old task')];
  const migrated = stateSchema.parse(old);
  assert.equal(migrated.settings.timeZone, 'Asia/Shanghai');
  const t = initialState();
  t.records = [
    {
      id: 'r',
      activityId: 'study',
      note: 'read',
      tags: [],
      spans: [{ start: 100, end: 300000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: 1,
    },
  ];
  const merged = mergeImport(migrated, makeBackup(t));
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.timelog.records.length, 1);
  const running = startTimer(merged.timelog, 'study', 'task', 1000);
  running.timer!.taskId = merged.tasks[0].id;
  assert.equal(
    validateState(finishTimer(running, 3000)).records.at(-1)!.taskId,
    merged.tasks[0].id,
  );
});
test('module optimistic concurrency preserves disjoint task edits and rejects stale course changes', () => {
  const before = emptyState();
  before.schedule = schedule();
  const after = structuredClone(before);
  after.schedule.courses[0].name = 'Changed';
  const delta = diffState(before, after);
  const concurrent = structuredClone(before);
  concurrent.tasks = [newTask('Concurrent')];
  assert.equal(applyDelta(concurrent, delta).tasks.length, 1);
  concurrent.schedule.courses[0].name = 'Other';
  assert.throws(() => applyDelta(concurrent, delta), StateConflict);
  assert.throws(() => mergeSchedule(schedule(), { ...schedule(), semesterStart: '2026-09-14' }));
});
