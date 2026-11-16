import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { StateService } from './state-service.js';
import { exportEventCalendar } from '../src/calendar-export.js';

/** Revocable, read-only calendar capabilities. Each token grants access only to its Event feed. */
export class CalendarFeed {
  private readonly cache = new Map<string, { key: string; content: string }>();
  constructor(private service: StateService) {}
  async serve(request: IncomingMessage, response: ServerResponse) {
    const match = request.url?.match(/^\/calendar\/([a-f0-9]{64})\.ics$/);
    if (!match) return false;
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return true;
    }
    const snapshot = await this.service.snapshot();
    const requested = Buffer.from(match[1]);
    const feed = (snapshot.state.settings.calendarFeeds ?? []).find((row) =>
      timingSafeEqual(Buffer.from(row.token), requested),
    );
    if (!feed?.enabled) {
      response.writeHead(404).end();
      return true;
    }
    const key = `${snapshot.revision}\n${feed.name}\n${feed.types.join(',')}`;
    let cached = this.cache.get(feed.token);
    if (cached?.key !== key) {
      cached = { key, content: exportEventCalendar(snapshot.state.calendarEvents, feed) };
      if (this.cache.size >= 40) this.cache.clear(); // rotated tokens never return
      this.cache.set(feed.token, cached);
    }
    response.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="Dayweave.ics"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : cached.content);
    return true;
  }
}
