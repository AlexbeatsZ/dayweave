import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { referenceBlocks, referenceSlots } from '../src/reference-calendar.js';
import { newEvent, eventBounds } from '../src/event-domain.js';
import { exportEventCalendar } from '../src/calendar-export.js';
import { dayStart } from '../src/timezone.js';

const date = '2026-11-24';
const midnight = dayStart(date, '+08:00');
const minutes = (value: number) => (value - midnight) / 60000;
test('background matches all fixed UTC8 rows and keeps the unlisted gap blank', () => {
  const blocks = referenceBlocks([], date, 1);
  assert.equal(blocks.length, 46);
  assert.deepEqual(
    blocks.map((b) => [minutes(b.start), minutes(b.end)]),
    referenceSlots.map((s) => [s.start, s.end]),
  );
  assert.equal(blocks.filter((b) => b.kind === 'study').length, 23);
  assert.deepEqual(referenceBlocks([], date, 1), blocks);
});
test('all actual arrangements override reference fragments, regardless of feed type and boundaries', () => {
  const events = [
    newEvent({ title: 'meeting', type: 'meeting', date, periods: [['08:10', '08:20']] }),
    newEvent({ title: 'course', type: 'course', date, periods: [['08:40', '09:05']] }),
  ];
  const blocks = referenceBlocks(events, date, 1);
  assert.deepEqual(
    blocks
      .filter((b) => minutes(b.start) >= 480 && minutes(b.start) < 580)
      .map((b) => [minutes(b.start), minutes(b.end)]),
    [
      [480, 490],
      [500, 520],
      [545, 580],
    ],
  );
  for (const event of events) {
    const e = eventBounds(event);
    assert.equal(
      blocks.some((b) => b.start < e.end && e.start < b.end),
      false,
    );
  }
  const raw = exportEventCalendar(
    events,
    { name: 'reference', types: ['exam'], content: 'reference' },
    date,
  );
  assert.doesNotMatch(raw, /SUMMARY:meeting|SUMMARY:course/);
  const pieces = new ICAL.Component(ICAL.parse(raw)).getAllSubcomponents('vevent');
  for (const piece of pieces) {
    assert.equal(piece.getFirstPropertyValue('transp'), 'TRANSPARENT');
    assert.equal(
      (
        piece.getFirstSubcomponent('valarm')!.getFirstPropertyValue('trigger') as ICAL.Duration
      ).toSeconds(),
      0,
    );
  }
});
test('all-day and overnight events remove exactly their coverage; deletion restores blanks', () => {
  const allDay = newEvent({ title: 'rest day', date, allDay: true });
  assert.equal(referenceBlocks([allDay], date, 1).length, 0);
  assert.equal(
    referenceBlocks([{ ...allDay, deletedAt: '2026-11-24T00:00:00Z' }], date, 1).length,
    46,
  );
  const overnight = newEvent({
    title: 'night',
    date,
    periods: [['23:20', '00:30']],
    durationDays: 2,
  });
  const blocks = referenceBlocks([overnight], date, 2),
    e = eventBounds(overnight);
  assert.equal(
    blocks.some((b) => b.start < e.end && e.start < b.end),
    false,
  );
  assert.ok(blocks.some((b) => b.end === e.start));
  assert.ok(blocks.some((b) => b.start === e.end));
});
test('combined feed preserves real event reminders and uses start-time reminders for reference', () => {
  const event = newEvent({ title: 'exam', type: 'exam', date, periods: [['08:00', '09:00']] });
  const raw = exportEventCalendar(
    [event],
    { name: 'combined', types: [], content: 'combined' },
    date,
  );
  const pieces = new ICAL.Component(ICAL.parse(raw)).getAllSubcomponents('vevent');
  const actual = pieces.find((p) => p.getFirstPropertyValue('uid') === event.id + '@dayweave')!;
  assert.deepEqual(
    actual
      .getAllSubcomponents('valarm')
      .map((a) => (a.getFirstPropertyValue('trigger') as ICAL.Duration).toSeconds()),
    [-1800, -900],
  );
  assert.ok(pieces.some((p) => p.getFirstPropertyValue('x-dayweave-reference') === 'study'));
  assert.equal(
    exportEventCalendar([event], { name: 'events', types: [] }, date).includes(
      'X-DAYWEAVE-REFERENCE',
    ),
    false,
  );
});
