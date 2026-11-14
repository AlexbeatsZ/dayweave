import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import { createAccount, fetchCalendars, fetchCalendarObjects, type DAVCalendar } from 'tsdav';
import { findIana, findWindows } from 'windows-iana';
import { z } from 'zod';
import { calendarEventSchema, type CalendarEvent } from '../src/event-model.js';
import type { RemoteCalendar } from '../src/calendar-accounts.js';
import { eventBounds } from '../src/event-domain.js';
import { exportEventCalendar } from '../src/calendar-export.js';
import { shiftDay, validTimeZone, wallTime, zoneDateKey } from '../src/timezone.js';

export const connectedAccountSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(['google', 'microsoft', 'apple']),
  identity: z.string(),
  name: z.string(),
  token: z
    .object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number() })
    .optional(),
  apple: z.object({ username: z.string(), password: z.string() }).optional(),
  calendars: z.array(z.object({ id: z.string(), name: z.string(), writable: z.boolean() })),
  importIds: z.array(z.string()),
  publishId: z.string().nullable(),
  published: z.record(z.string(), z.object({ id: z.string(), fingerprint: z.string() })),
  checkedAt: z.number(),
  error: z.string(),
});
export type ConnectedAccount = z.infer<typeof connectedAccountSchema>;
export const calendarDigest = (text: string) => createHash('sha256').update(text).digest('hex');
export const accountCalendarSource = (accountId: string, calendarId: string) =>
  `account:${accountId}:${calendarDigest(calendarId)}`;
const microsoftMarker = 'String {367299a9-6101-4e35-a4b1-48fbd264e62a} Name DayweaveId';

/** Provider errors deliberately contain no response bodies, tokens or subscription URLs. */
export class CalendarProviderError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401 || status === 403
        ? '日历授权已失效或权限不足，请重新连接账号。'
        : status === 429
          ? '日历服务请求过多，稍后会自动重试。'
          : `日历服务返回 HTTP ${status}`,
    );
  }
}

function nativeZone(input: unknown) {
  if (typeof input !== 'string') return undefined;
  return validTimeZone(input) ? input : findIana(input)[0];
}

function nativeInstant(part: { dateTime: string; timeZone?: string }) {
  const text = part.dateTime;
  let instant: number;
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(text)) instant = Date.parse(text);
  else {
    const zone = nativeZone(part.timeZone);
    if (!zone) throw new Error('日历服务返回了无法识别的时区');
    instant =
      wallTime(text.slice(0, 10), text.slice(11, 16), zone) +
      Number(text.slice(17, 19) || 0) * 1000 +
      Number((text.match(/\.(\d+)/)?.[1] ?? '').slice(0, 3).padEnd(3, '0'));
  }
  if (!Number.isFinite(instant)) throw new Error('日历服务返回了无效的起止时间');
  return instant;
}

function nativeCalendar(provider: 'google' | 'microsoft', rows: any[]) {
  const root = new ICAL.Component(['vcalendar', [], []]);
  const instants = new Map<string, { start: number; end: number }>();
  root.updatePropertyWithValue('version', '2.0');
  for (const row of rows) {
    if (
      row.extendedProperties?.private?.dayweaveId ||
      row.singleValueExtendedProperties?.some(
        (property: { id: string }) => property.id === microsoftMarker,
      )
    )
      continue;
    const component = new ICAL.Component('vevent');
    component.updatePropertyWithValue('uid', row.id);
    if (row.status === 'cancelled' || row.isCancelled) {
      component.updatePropertyWithValue('status', 'CANCELLED');
      root.addSubcomponent(component);
      continue;
    }
    component.updatePropertyWithValue(
      'summary',
      (provider === 'google' ? row.summary : row.subject) || '未命名日程',
    );
    component.updatePropertyWithValue(
      'description',
      provider === 'google' ? row.description || '' : row.body?.content || '',
    );
    component.updatePropertyWithValue(
      'location',
      provider === 'google' ? row.location || '' : row.location?.displayName || '',
    );
    const allDay = provider === 'google' ? !!row.start?.date : row.isAllDay;
    const bounds = { start: 0, end: 0 };
    for (const [property, part] of [
      ['dtstart', row.start],
      ['dtend', row.end],
    ] as const) {
      if (!part) throw new Error('日历服务返回了缺少起止时间的日程');
      let value: ICAL.Time;
      if (allDay) {
        const originalZone = nativeZone(
          property === 'dtstart' ? row.originalStartTimeZone : row.originalEndTimeZone,
        );
        const date =
          provider === 'google'
            ? part.date
            : originalZone
              ? zoneDateKey(nativeInstant(part), originalZone)
              : part.dateTime.slice(0, 10);
        value = ICAL.Time.fromString(date, undefined);
      } else {
        const instant = nativeInstant(part);
        bounds[property === 'dtstart' ? 'start' : 'end'] = instant;
        value = ICAL.Time.fromJSDate(new Date(instant), true);
      }
      component.updatePropertyWithValue(property, value);
    }
    root.addSubcomponent(component);
    if (!allDay) instants.set(row.id, bounds);
  }
  return { text: root.toString(), instants };
}

/** Fixed provider origins also constrain pagination and CalDAV discovery before credentials leave. */
export async function calendarSession(
  account: ConnectedAccount,
  signal: AbortSignal,
  request = fetch,
) {
  const provider = account.provider;
  const allowed = (url: URL) =>
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (provider === 'apple'
      ? url.hostname === 'caldav.icloud.com' || url.hostname.endsWith('.icloud.com')
      : url.origin ===
        (provider === 'google' ? 'https://www.googleapis.com' : 'https://graph.microsoft.com'));
  const guarded: typeof fetch = async (input, init = {}) => {
    let url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    for (let hop = 0; hop < 6; hop++) {
      if (!allowed(url)) throw new Error('日历服务返回了无效的跳转地址');
      const response = await request(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        redirect: 'manual',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('日历服务返回了无效的跳转地址');
      url = new URL(location, url);
    }
    throw new Error('日历服务跳转次数过多');
  };
  const headers =
    provider === 'apple'
      ? {
          Authorization: `Basic ${Buffer.from(`${account.apple!.username}:${account.apple!.password}`).toString('base64')}`,
        }
      : { Authorization: `Bearer ${account.token!.accessToken}` };
  const json = async (url: string, init: RequestInit = {}, accepted: number[] = []) => {
    const response = await guarded(url, {
      ...init,
      headers: { ...headers, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok && !accepted.includes(response.status))
      throw new CalendarProviderError(response.status);
    return response;
  };
  const root =
    provider === 'google'
      ? 'https://www.googleapis.com/calendar/v3'
      : 'https://graph.microsoft.com/v1.0/me';
  const pages = async (url: string, items: 'items' | 'value') => {
    const rows: any[] = [];
    let next: string | undefined = url;
    for (let page = 0; next && page < 100; page++) {
      const response = await json(next, {
        headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
      });
      const data = await response.json();
      if (!Array.isArray(data[items])) throw new Error('日历服务返回了无效的数据');
      rows.push(...data[items]);
      if (rows.length > 20000) throw new Error('日历项目过多，请缩小日历范围');
      next = data['@odata.nextLink'];
      if (data.nextPageToken) {
        const more = new URL(url);
        more.searchParams.set('pageToken', data.nextPageToken);
        next = more.toString();
      }
    }
    if (next) throw new Error('日历分页过多，稍后会重试');
    return rows;
  };
  let davCalendars: DAVCalendar[] | undefined;
  const dav = async () => {
    if (!davCalendars) {
      const discovered = await createAccount({
        account: {
          serverUrl: 'https://caldav.icloud.com',
          accountType: 'caldav',
          credentials: account.apple,
        },
        headers,
        loadCollections: false,
        loadObjects: false,
        fetch: guarded,
      });
      davCalendars = await fetchCalendars({
        account: discovered,
        headers,
        props: {
          'd:displayname': {},
          'd:current-user-privilege-set': {},
          'c:calendar-timezone': {},
        },
        projectedProps: { currentUserPrivilegeSet: true },
        fetch: guarded,
      });
    }
    return davCalendars;
  };
  const list = async (): Promise<RemoteCalendar[]> => {
    if (provider === 'apple')
      return (await dav())
        .filter((row) => !row.components?.length || row.components.includes('VEVENT'))
        .map((row) => ({
          id: row.url,
          name: typeof row.displayName === 'string' ? row.displayName : 'iCloud 日历',
          writable: /"(?:write|writeContent|all)"/i.test(
            JSON.stringify(row.projectedProps?.currentUserPrivilegeSet ?? {}),
          ),
        }));
    const rows = await pages(
      provider === 'google'
        ? `${root}/users/me/calendarList?maxResults=250`
        : `${root}/calendars?$top=100`,
      provider === 'google' ? 'items' : 'value',
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.summaryOverride || row.summary || row.name || '日历',
      writable:
        provider === 'google' ? ['owner', 'writer'].includes(row.accessRole) : row.canEdit === true,
    }));
  };
  const read = async (
    calendarId: string,
    from: string,
    through: string,
  ): Promise<{ text: string; instants?: Map<string, { start: number; end: number }> }> => {
    if (provider === 'apple') {
      const calendar = (await dav()).find((row) => row.url === calendarId);
      if (!calendar) throw new Error('已选日历不可用，请重新选择');
      const objects = await fetchCalendarObjects({
        calendar,
        timeRange: { start: `${from}T00:00:00Z`, end: `${shiftDay(through, 1)}T00:00:00Z` },
        headers,
        fetch: guarded,
      });
      const merged = new ICAL.Component(['vcalendar', [], []]);
      merged.updatePropertyWithValue('version', '2.0');
      let bytes = 0;
      for (const object of objects) {
        if (typeof object.data !== 'string') throw new Error('日历服务返回了无效的数据');
        bytes += Buffer.byteLength(object.data);
        if (bytes > 10 * 1024 * 1024) throw new Error('日历超过 10 MB');
        const parsed = new ICAL.Component(ICAL.parse(object.data));
        for (const child of parsed.getAllSubcomponents()) {
          if (
            child.name === 'vevent' &&
            String(child.getFirstPropertyValue('uid')).endsWith('@dayweave')
          )
            continue;
          merged.addSubcomponent(child);
        }
      }
      return { text: merged.toString() };
    }
    const query =
      provider === 'google'
        ? new URLSearchParams({
            singleEvents: 'true',
            showDeleted: 'true',
            timeMin: `${from}T00:00:00Z`,
            timeMax: `${shiftDay(through, 1)}T00:00:00Z`,
            maxResults: '2500',
          })
        : new URLSearchParams({
            startDateTime: `${from}T00:00:00Z`,
            endDateTime: `${shiftDay(through, 1)}T00:00:00Z`,
            $top: '1000',
            $expand: `singleValueExtendedProperties($filter=id eq '${microsoftMarker}')`,
          });
    const url = `${root}/calendars/${encodeURIComponent(calendarId)}/${provider === 'google' ? 'events' : 'calendarView'}?${query}`;
    return nativeCalendar(provider, await pages(url, provider === 'google' ? 'items' : 'value'));
  };
  const publish = async (
    calendarId: string,
    event: CalendarEvent,
    prior?: { id: string },
  ): Promise<string> => {
    calendarEventSchema.parse(event);
    const stableId = `dw${calendarDigest(event.id)}`;
    if (provider === 'apple') {
      const url = new URL(
        `${stableId}.ics`,
        calendarId.endsWith('/') ? calendarId : calendarId + '/',
      ).toString();
      const response = await guarded(url, {
        method: event.deletedAt ? 'DELETE' : 'PUT',
        headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8' },
        ...(event.deletedAt ? {} : { body: exportEventCalendar([event]) }),
      });
      if (!response.ok && !(event.deletedAt && response.status === 404))
        throw new CalendarProviderError(response.status);
      return url;
    }
    const base = `${root}/calendars/${encodeURIComponent(calendarId)}/events`;
    const id = provider === 'google' ? stableId : prior?.id;
    const item = id ? `${base}/${encodeURIComponent(id)}` : undefined;
    if (event.deletedAt) {
      if (item) await json(item, { method: 'DELETE' }, [404, 410]);
      return id || '';
    }
    const bounds = eventBounds(event);
    const description = [event.notes, ...event.periods.map((row) => row.join('–'))]
      .filter(Boolean)
      .join('\n');
    const google = {
      id: stableId,
      summary: event.title,
      description,
      location: event.location,
      start: event.allDay
        ? { date: event.date }
        : { dateTime: new Date(bounds.start).toISOString() },
      end: event.allDay
        ? { date: shiftDay(event.date, event.durationDays) }
        : { dateTime: new Date(bounds.end).toISOString() },
      extendedProperties: { private: { dayweaveId: event.id } },
    };
    const allDayZone = findWindows(event.timeZone)[0] || 'UTC';
    const microsoft = {
      subject: event.title,
      body: { contentType: 'text', content: description },
      location: { displayName: event.location },
      isAllDay: event.allDay,
      start: {
        dateTime: event.allDay
          ? `${event.date}T00:00:00`
          : new Date(bounds.start).toISOString().replace('Z', ''),
        timeZone: event.allDay ? allDayZone : 'UTC',
      },
      end: {
        dateTime: event.allDay
          ? `${shiftDay(event.date, event.durationDays)}T00:00:00`
          : new Date(bounds.end).toISOString().replace('Z', ''),
        timeZone: event.allDay ? allDayZone : 'UTC',
      },
      singleValueExtendedProperties: [{ id: microsoftMarker, value: event.id }],
    };
    if (provider === 'microsoft' && !id) {
      const query = new URLSearchParams({
        $filter: `singleValueExtendedProperties/Any(ep: ep/id eq '${microsoftMarker}' and ep/value eq '${event.id.replaceAll("'", "''")}')`,
        $top: '1',
      });
      const found = await pages(`${base}?${query}`, 'value');
      if (found[0]) return publish(calendarId, event, { id: found[0].id });
    }
    const body = JSON.stringify(provider === 'google' ? google : microsoft);
    let response = await json(
      item || base,
      { method: item ? (provider === 'google' ? 'PUT' : 'PATCH') : 'POST', body },
      [404],
    );
    if (response.status === 404) {
      response = await json(base, { method: 'POST', body }, [409]);
      if (response.status === 409 && item) response = await json(item, { method: 'PUT', body });
    }
    return (await response.json()).id as string;
  };
  return { list, read, publish };
}
