import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { StateService } from './state-service.js';
import { exportEventCalendar } from '../src/calendar-export.js';

/** A revocable, read-only calendar capability. It grants access only to Event data. */
export class CalendarFeed {
  private revision?: string;
  private content = '';
  constructor(private service: StateService) {}
  async serve(request: IncomingMessage, response: ServerResponse) {
    const match = request.url?.match(/^\/calendar\/([a-f0-9]{64})\.ics$/);
    if (!match) return false;
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return true;
    }
    const snapshot = await this.service.snapshot();
    const feed = snapshot.state.settings.calendarFeed;
    if (!feed?.enabled || !timingSafeEqual(Buffer.from(feed.token), Buffer.from(match[1]))) {
      response.writeHead(404).end();
      return true;
    }
    if (this.revision !== snapshot.revision) {
      this.content = exportEventCalendar(snapshot.state.calendarEvents);
      this.revision = snapshot.revision;
    }
    response.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="Dayweave.ics"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : this.content);
    return true;
  }
}
