import ICAL from 'ical.js';
import type { CalendarEvent } from './event-model.js';
import { eventBounds } from './event-domain.js';
import { shiftDay } from './timezone.js';

/** Persisted instances have stable UIDs, covering recurrence exceptions on every platform. */
export function exportEventCalendar(events: CalendarEvent[]) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Dayweave//Events//ZH');
  calendar.updatePropertyWithValue('x-wr-calname', 'Dayweave');
  for (const event of events) {
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
    component.updatePropertyWithValue('x-dayweave-timezone', event.timeZone);
    if (event.recurrenceId)
      component.updatePropertyWithValue('x-dayweave-recurrence-id', event.recurrenceId);
    calendar.addSubcomponent(component);
  }
  return calendar.toString();
}
