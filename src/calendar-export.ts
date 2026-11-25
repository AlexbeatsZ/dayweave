import ICAL from 'ical.js';
import {
  feedReminderMinutes,
  legacyFeedName,
  type CalendarEvent,
  type CalendarFeed,
} from './event-model.js';
import { eventBounds } from './event-domain.js';
import { shiftDay, zoneDateKey } from './timezone.js';
import { referenceBlocks, referenceZone } from './reference-calendar.js';

/** Persisted instances have stable UIDs, covering recurrence exceptions on every platform. */
export function exportEventCalendar(
  events: CalendarEvent[],
  feed: Pick<CalendarFeed, 'name' | 'types' | 'content'> = { name: legacyFeedName, types: [] },
  referenceStart = zoneDateKey(Date.now(), referenceZone),
) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Dayweave//Events//ZH');
  calendar.updatePropertyWithValue('calscale', 'GREGORIAN');
  calendar.updatePropertyWithValue('x-wr-calname', feed.name);
  // Hints honoured by Outlook and Apple; Google keeps its own refresh schedule.
  calendar.updatePropertyWithValue('refresh-interval', ICAL.Duration.fromString('PT1H'));
  calendar.updatePropertyWithValue('x-published-ttl', 'PT1H');
  for (const event of events) {
    if (feed.content === 'reference') continue;
    if (feed.types.length && !feed.types.includes(event.type)) continue;
    const component = new ICAL.Component('vevent');
    component.updatePropertyWithValue('uid', `${event.id}@dayweave`);
    component.updatePropertyWithValue('summary', event.title);
    component.updatePropertyWithValue('location', event.location);
    component.updatePropertyWithValue(
      'description',
      [event.notes, ...event.periods.map((period) => period.join('–'))].filter(Boolean).join('\n'),
    );
    component.updatePropertyWithValue(
      'dtstamp',
      ICAL.Time.fromJSDate(new Date(event.updatedAt), true),
    );
    component.updatePropertyWithValue(
      'last-modified',
      ICAL.Time.fromJSDate(new Date(event.updatedAt), true),
    );
    if (event.allDay) {
      component.updatePropertyWithValue('dtstart', ICAL.Time.fromString(event.date, undefined));
      component.updatePropertyWithValue(
        'dtend',
        ICAL.Time.fromString(shiftDay(event.date, event.durationDays), undefined),
      );
    } else {
      const bounds = eventBounds(event);
      component.updatePropertyWithValue(
        'dtstart',
        ICAL.Time.fromJSDate(new Date(bounds.start), true),
      );
      component.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(bounds.end), true));
    }
    if (event.deletedAt) component.updatePropertyWithValue('status', 'CANCELLED');
    else
      for (const minutes of feedReminderMinutes) {
        const alarm = new ICAL.Component('valarm');
        alarm.updatePropertyWithValue('action', 'DISPLAY');
        alarm.updatePropertyWithValue('description', event.title);
        alarm.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(-minutes * 60));
        component.addSubcomponent(alarm);
      }
    component.updatePropertyWithValue('x-dayweave-timezone', event.timeZone);
    if (event.recurrenceId)
      component.updatePropertyWithValue('x-dayweave-recurrence-id', event.recurrenceId);
    calendar.addSubcomponent(component);
  }
  if (feed.content === 'reference' || feed.content === 'combined') {
    for (const block of referenceBlocks(referenceStart)) {
      const component = new ICAL.Component('vevent');
      component.updatePropertyWithValue('uid', `${block.id}@dayweave`);
      component.updatePropertyWithValue('summary', block.title);
      component.updatePropertyWithValue(
        'description',
        '固定UTC+8完整参考轴，可与实际日程重叠；按当前状态调整，不要求全天学习。',
      );
      component.updatePropertyWithValue(
        'dtstart',
        ICAL.Time.fromJSDate(new Date(block.start), true),
      );
      component.updatePropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(block.end), true));
      component.updatePropertyWithValue(
        'dtstamp',
        ICAL.Time.fromJSDate(new Date('2026-11-25T00:00:00Z'), true),
      );
      component.updatePropertyWithValue('transp', 'TRANSPARENT');
      component.updatePropertyWithValue('x-dayweave-reference', block.kind);
      component.updatePropertyWithValue('x-dayweave-timezone', referenceZone);
      const alarm = new ICAL.Component('valarm');
      alarm.updatePropertyWithValue('action', 'DISPLAY');
      alarm.updatePropertyWithValue('description', block.title);
      alarm.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(0));
      component.addSubcomponent(alarm);
      calendar.addSubcomponent(component);
    }
  }
  return calendar.toString();
}
