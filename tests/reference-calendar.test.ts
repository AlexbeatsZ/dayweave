import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { referenceBlocks, referenceSlots } from '../src/reference-calendar.js';
import { newEvent } from '../src/event-domain.js';
import { exportEventCalendar } from '../src/calendar-export.js';
import { dayStart } from '../src/timezone.js';

const date = '2026-11-24';
const midnight = dayStart(date, '+08:00');
const minutes = (value: number) => (value - midnight) / 60000;
test('background matches all fixed UTC8 rows and keeps the unlisted gap blank', () => {
  const blocks = referenceBlocks(date, 1);
  assert.equal(blocks.length, 46);
  assert.deepEqual(
    blocks.map((b) => [minutes(b.start), minutes(b.end)]),
    referenceSlots.map((s) => [s.start, s.end]),
  );
  assert.equal(blocks.filter((b) => b.kind === 'study').length, 23);
  assert.deepEqual(referenceBlocks(date, 1), blocks);
});
test('reference feed stays complete and stable across overlapping actual arrangements', () => {
  const events = [
    newEvent({ title: 'meeting', type: 'meeting', date, periods: [['08:10', '08:20']] }),
    newEvent({ title: 'course', type: 'course', date, periods: [['08:40', '09:05']] }),
    newEvent({ title: 'all day', date, allDay: true }),
    newEvent({ title: 'night', date, periods: [['23:20', '00:30']], durationDays: 2 }),
  ];
  const feed = { name: 'reference', types: ['exam'] as const, content: 'reference' as const };
  const expected = new ICAL.Component(
    ICAL.parse(exportEventCalendar([], { ...feed, types: [...feed.types] }, date)),
  ).getAllSubcomponents('vevent');
  const render = (actual: typeof events) =>
    new ICAL.Component(
      ICAL.parse(exportEventCalendar(actual, { ...feed, types: [...feed.types] }, date)),
    ).getAllSubcomponents('vevent');
  const pieces = render(events);
  assert.equal(pieces.length, 46 * 43);
  assert.deepEqual(
    pieces.map((p) => p.toJSON()),
    expected.map((p) => p.toJSON()),
  );
  assert.deepEqual(
    render(events.map((e) => ({ ...e, deletedAt: '2026-11-25T00:00:00Z' }))).map((p) => p.toJSON()),
    expected.map((p) => p.toJSON()),
  );
  for (const piece of pieces) {
    assert.equal(piece.getFirstPropertyValue('transp'), 'TRANSPARENT');
    assert.equal(
      (
        piece.getFirstSubcomponent('valarm')!.getFirstPropertyValue('trigger') as ICAL.Duration
      ).toSeconds(),
      0,
    );
  }
  const firstDay = pieces.slice(0, 46);
  assert.deepEqual(
    firstDay.map((p) => [
      minutes((p.getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate().getTime()),
      minutes((p.getFirstPropertyValue('dtend') as ICAL.Time).toJSDate().getTime()),
    ]),
    referenceSlots.map((slot) => [slot.start, slot.end]),
  );
  assert.equal(
    firstDay[14].getFirstPropertyValue('uid'),
    `reference-${date}-480-${midnight + 480 * 60000}-${midnight + 525 * 60000}@dayweave`,
  );
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
  assert.equal(pieces.length, 46 * 43 + 1);
  assert.ok(pieces.some((p) => p.getFirstPropertyValue('x-dayweave-reference') === 'study'));
  assert.ok(
    pieces.some(
      (p) =>
        (p.getFirstPropertyValue('dtstart') as ICAL.Time).toJSDate().getTime() ===
          midnight + 480 * 60000 && p.getFirstPropertyValue('x-dayweave-reference') === 'study',
    ),
  );
  assert.equal(
    exportEventCalendar([event], { name: 'events', types: [] }, date).includes(
      'X-DAYWEAVE-REFERENCE',
    ),
    false,
  );
});
