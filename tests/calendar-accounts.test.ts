import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ICAL from 'ical.js';
import { CalendarAccounts } from '../electron/calendar-accounts.js';
import { calendarSession, type ConnectedAccount } from '../electron/calendar-providers.js';
import { StateService } from '../electron/state-service.js';
import { FileStore } from '../electron/storage.js';
import { DesktopSync } from '../electron/sync.js';
import {
  newEvent,
  eventBounds,
  configureRecurrence,
  generateRecurrences,
} from '../src/event-domain.js';
import { emptyState, newTask } from '../src/model.js';
import { previewCalendar } from '../src/calendar-import.js';
import { calendarAuthorizationUrl } from '../src/calendar-accounts.js';
import { shiftDay, zoneDateKey } from '../src/timezone.js';
import { seal } from '../src/sync/crypto.js';
import { syncHttpError } from '../src/sync/client.js';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const today = zoneDateKey(Date.now(), 'Asia/Shanghai');

async function temporary() {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'dayweave-calendar-accounts-'));
}
async function fixture(request: typeof fetch) {
  const directory = await temporary();
  const service = new StateService(new FileStore(directory));
  await service.snapshot();
  let allowed = true;
  const accounts = new CalendarAccounts(
    service,
    directory,
    (actor) => allowed && actor === 'paired',
    request,
  );
  const server = createServer((request, response) => {
    void accounts
      .callback(request, response)
      .then((handled) => {
        if (!handled) response.writeHead(404).end();
      })
      .catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    directory,
    service,
    accounts,
    base,
    revoke: () => {
      allowed = false;
    },
    close: async () => {
      await accounts.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      service.dispose();
      await service.flush();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('OAuth uses one-time state and PKCE, stores credentials only at the center and keeps moved native IDs', async () => {
  let start = '08:00',
    tokenCalls = 0,
    refreshed = false,
    failRead = false;
  const env = await fixture(async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'refresh_token') {
        assert.equal(body.get('refresh_token'), 'private-refresh');
        refreshed = true;
        return json({
          access_token: 'renewed-access',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'rotated-refresh',
        });
      }
      assert.ok(body.get('code_verifier'));
      assert.equal(body.get('client_secret'), 'private-client-secret');
      return json({
        access_token: 'private-access',
        token_type: 'Bearer',
        expires_in: 0,
        refresh_token: 'private-refresh',
      });
    }
    if (url.includes('/oauth2/v3/userinfo'))
      return json({ sub: 'google-user', email: 'person@example.com' });
    if (url.includes('/users/me/calendarList'))
      return json({ items: [{ id: 'primary', summary: '私人日历', accessRole: 'owner' }] });
    if (url.includes('/calendars/primary/events')) {
      if (failRead) throw new Error('private-refresh transport failed');
      return json({
        items: [
          {
            id: 'stable-native-instance',
            summary: '外部会议',
            start: { dateTime: `${today}T${start}:00.123+08:00` },
            end: { dateTime: `${today}T10:00:00.456+08:00` },
          },
        ],
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  try {
    await env.accounts.command(
      {
        action: 'configure',
        provider: 'google',
        clientId: 'google-client',
        clientSecret: 'private-client-secret',
        baseUrl: 'https://hub.example/dayweave',
      },
      'paired',
    );
    const requestId = randomUUID();
    const begin = await env.accounts.command(
      { action: 'authorize', provider: 'google' },
      'paired',
      requestId,
    );
    assert.equal(
      (await env.accounts.command({ action: 'authorize', provider: 'google' }, 'paired', requestId))
        .authorizationUrl,
      begin.authorizationUrl,
    );
    const authorization = new URL(begin.authorizationUrl!);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.equal(
      authorization.searchParams.get('redirect_uri'),
      'https://hub.example/dayweave/calendar-oauth/callback',
    );
    assert.equal(
      (await fetch(env.base + '/calendar-oauth/callback?state=wrong&code=invalid')).status,
      400,
    );
    assert.equal(tokenCalls, 0);
    const callback =
      env.base +
      `/calendar-oauth/callback?state=${authorization.searchParams.get('state')}&code=accepted`;
    const reply = await fetch(callback);
    assert.equal(reply.status, 200, await reply.text());
    assert.equal(reply.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(tokenCalls, 1);
    const status = (await env.accounts.command({ action: 'status' }, 'paired')).status;
    assert.equal(status.accounts[0].name, 'person@example.com');
    assert.doesNotMatch(
      JSON.stringify(status),
      /private-access|private-refresh|private-client-secret/,
    );
    const accountId = status.accounts[0].id;
    await env.accounts.command(
      { action: 'select', accountId, importIds: ['primary'], publishId: null },
      'paired',
    );
    await env.accounts.refresh();
    assert.equal(refreshed, true);
    let events = (await env.service.snapshot()).state.calendarEvents.filter(
      (row) => !row.deletedAt,
    );
    assert.equal(events.length, 1);
    const originalId = events[0].id;
    start = '09:00';
    await env.accounts.command({ action: 'refresh', accountId }, 'paired');
    await env.accounts.refresh();
    events = (await env.service.snapshot()).state.calendarEvents.filter((row) => !row.deletedAt);
    assert.equal(events.length, 1);
    assert.equal(events[0].id, originalId);
    assert.equal(eventBounds(events[0]).start, Date.parse(`${today}T09:00:00.123+08:00`));
    failRead = true;
    await env.accounts.command({ action: 'refresh', accountId }, 'paired');
    await env.accounts.refresh();
    assert.deepEqual(
      (await env.service.snapshot()).state.calendarEvents.filter((row) => !row.deletedAt),
      events,
    );
    const failure = (await env.accounts.command({ action: 'status' }, 'paired')).status;
    assert.match(failure.accounts[0].error, /同步失败/);
    assert.doesNotMatch(JSON.stringify(failure), /private-refresh/);
    const file = path.join(env.directory, 'calendar-accounts.json');
    const stored = await readFile(file, 'utf8');
    assert.match(stored, /rotated-refresh/);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.doesNotMatch(
      JSON.stringify((await env.service.snapshot()).state),
      /private-client-secret|rotated-refresh|private-access/,
    );
    const lateLogin = await env.accounts.command(
      { action: 'authorize', provider: 'google' },
      'paired',
    );
    await env.accounts.command({ action: 'disconnect', accountId }, 'paired');
    const lateState = new URL(lateLogin.authorizationUrl!).searchParams.get('state');
    assert.equal(
      (await fetch(env.base + `/calendar-oauth/callback?state=${lateState}&code=late-login`))
        .status,
      400,
    );
    assert.equal(
      (await env.accounts.command({ action: 'status' }, 'paired')).status.accounts.length,
      0,
    );
    assert.doesNotMatch(await readFile(file, 'utf8'), /rotated-refresh|renewed-access/);
    assert.equal(
      (await env.service.snapshot()).state.calendarEvents.filter((row) => !row.deletedAt).length,
      1,
    );
    env.revoke();
    assert.throws(
      () => env.accounts.command({ action: 'authorize', provider: 'google' }, 'paired', requestId),
      /同步中心/,
    );
  } finally {
    await env.close();
  }
});

test('Google publishing retries with deterministic IDs and imports skip our own published items', async () => {
  const event = newEvent({ title: '发布会议', date: today, periods: [['08:00', '09:00']] });
  const bodies: unknown[] = [];
  let created = false,
    deleted = false;
  const account: ConnectedAccount = {
    id: randomUUID(),
    provider: 'google',
    identity: 'user',
    name: 'user',
    token: { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 },
    calendars: [],
    importIds: [],
    publishId: null,
    published: {},
    checkedAt: 0,
    error: '',
  };
  const session = await calendarSession(
    account,
    new AbortController().signal,
    async (_input, init) => {
      if (init?.method === 'PUT') {
        if (!created) return json({}, 404);
        bodies.push(JSON.parse(String(init.body)));
        return json({ id: 'remote-id' });
      }
      if (init?.method === 'POST') {
        created = true;
        bodies.push(JSON.parse(String(init.body)));
        throw new Error('response lost after commit');
      }
      if (init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return json({
        items: [{ id: 'own', extendedProperties: { private: { dayweaveId: event.id } } }],
      });
    },
  );
  await assert.rejects(session.publish('primary', event), /lost/);
  await session.publish('primary', event);
  assert.deepEqual(bodies[0], bodies[1]);
  const calendar = new ICAL.Component(
    ICAL.parse((await session.read('primary', today, shiftDay(today, 1))).text),
  );
  assert.equal(calendar.getAllSubcomponents('vevent').length, 0);
  await session.publish('primary', { ...event, deletedAt: new Date().toISOString() });
  assert.equal(deleted, true);
});

test('Microsoft paging, Windows timezones, all-day dates and immutable IDs use the shared import path', async () => {
  const account: ConnectedAccount = {
    id: randomUUID(),
    provider: 'microsoft',
    identity: 'user',
    name: 'user',
    token: { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 },
    calendars: [],
    importIds: [],
    publishId: null,
    published: {},
    checkedAt: 0,
    error: '',
  };
  const session = await calendarSession(
    account,
    new AbortController().signal,
    async (input, init) => {
      const url = new URL(String(input));
      assert.match(String((init?.headers as Record<string, string>).Prefer), /ImmutableId/);
      if (url.pathname.endsWith('/calendarView'))
        return json({
          value: [
            {
              id: 'all-day',
              subject: '全天',
              isAllDay: true,
              originalStartTimeZone: 'China Standard Time',
              originalEndTimeZone: 'China Standard Time',
              start: { dateTime: `${shiftDay(today, -1)}T16:00:00`, timeZone: 'UTC' },
              end: { dateTime: `${shiftDay(today, 1)}T16:00:00`, timeZone: 'UTC' },
            },
            {
              id: 'timed',
              subject: '会议',
              start: { dateTime: `${today}T08:30:00.1230000`, timeZone: 'China Standard Time' },
              end: { dateTime: `${today}T09:30:00.4560000`, timeZone: 'China Standard Time' },
              body: { content: '备注' },
            },
          ],
        });
      return url.searchParams.has('page')
        ? json({ value: [{ id: 'readonly', name: '共享日历', canEdit: false }] })
        : json({
            value: [{ id: 'primary', name: '个人日历', canEdit: true }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars?page=2',
          });
    },
  );
  assert.equal((await session.list()).length, 2);
  const payload = await session.read('primary', today, shiftDay(today, 2));
  assert.equal(payload.instants!.get('timed')!.start, Date.parse(`${today}T08:30:00.123+08:00`));
  const preview = previewCalendar(
    payload.text,
    { id: 'microsoft', timeZone: 'Asia/Shanghai' },
    today,
    shiftDay(today, 2),
  );
  assert.equal(preview.items.find((row) => row.uid === 'all-day')!.event!.durationDays, 2);
  assert.equal(preview.items.find((row) => row.uid === 'all-day')!.event!.date, today);
  assert.equal(
    eventBounds(preview.items.find((row) => row.uid === 'timed')!.event!).start,
    Date.parse(`${today}T08:30:00+08:00`),
  );
});

test('Microsoft publishing recovers a committed create through its private event marker', async () => {
  const account: ConnectedAccount = {
    id: randomUUID(),
    provider: 'microsoft',
    identity: 'user',
    name: 'user',
    token: { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 },
    calendars: [],
    importIds: [],
    publishId: null,
    published: {},
    checkedAt: 0,
    error: '',
  };
  let creates = 0,
    updates = 0;
  let expectedZone = 'China Standard Time';
  const event = newEvent({ title: '全天', date: today, allDay: true, timeZone: 'Asia/Shanghai' });
  const session = await calendarSession(
    account,
    new AbortController().signal,
    async (_input, init) => {
      if (init?.method === 'POST') {
        creates++;
        throw new Error('response lost');
      }
      if (init?.method === 'PATCH') {
        updates++;
        const body = JSON.parse(String(init.body));
        assert.equal(body.start.dateTime, `${today}T00:00:00`);
        assert.equal(body.start.timeZone, expectedZone);
        return json({ id: 'immutable-remote-id' });
      }
      return json({ value: creates ? [{ id: 'immutable-remote-id' }] : [] });
    },
  );
  await assert.rejects(session.publish('primary', event), /lost/);
  assert.equal(await session.publish('primary', event), 'immutable-remote-id');
  assert.equal(creates, 1);
  assert.equal(updates, 1);
  expectedZone = 'UTC';
  await session.publish('primary', { ...event, timeZone: '-04:00' }, { id: 'immutable-remote-id' });
});

test('CalDAV writes use stable URLs and never send credentials to a redirected outside origin', async () => {
  const account: ConnectedAccount = {
    id: randomUUID(),
    provider: 'apple',
    identity: 'person@example.com',
    name: 'person@example.com',
    apple: { username: 'person@example.com', password: 'aaaa-bbbb-cccc-dddd' },
    calendars: [],
    importIds: [],
    publishId: null,
    published: {},
    checkedAt: 0,
    error: '',
  };
  const seen: string[] = [];
  let redirect = false;
  const session = await calendarSession(
    account,
    new AbortController().signal,
    async (input, init) => {
      seen.push(String(input));
      assert.match(String((init?.headers as Record<string, string>).Authorization), /^Basic /);
      return redirect
        ? new Response(null, {
            status: 302,
            headers: { Location: 'https://outside.example/credentials' },
          })
        : new Response(null, { status: 201 });
    },
  );
  const event = newEvent({ title: '私人日程', date: today, allDay: true });
  const first = await session.publish('https://p01-caldav.icloud.com/user/calendar/', event);
  assert.equal(await session.publish('https://p01-caldav.icloud.com/user/calendar/', event), first);
  redirect = true;
  await assert.rejects(
    session.publish('https://p01-caldav.icloud.com/user/calendar/', event),
    /跳转地址/,
  );
  assert.equal(seen.length, 3);
});

test('iCloud discovery lists permissions and imports private calendars through tsdav', async () => {
  const account: ConnectedAccount = {
    id: randomUUID(),
    provider: 'apple',
    identity: 'person@example.com',
    name: 'person@example.com',
    apple: { username: 'person@example.com', password: 'aaaa-bbbb-cccc-dddd' },
    calendars: [],
    importIds: [],
    publishId: null,
    published: {},
    checkedAt: 0,
    error: '',
  };
  const multistatus = (href: string, props: string) =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      { status: 207, headers: { 'Content-Type': 'application/xml' } },
    );
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:private-icloud-event\r\nDTSTART;VALUE=DATE:${today.replaceAll('-', '')}\r\nDTEND;VALUE=DATE:${shiftDay(today, 1).replaceAll('-', '')}\r\nSUMMARY:私人日程\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const calls: string[] = [];
  const session = await calendarSession(
    account,
    new AbortController().signal,
    async (input, init) => {
      const url = new URL(String(input)),
        body = String(init?.body ?? '');
      calls.push(body);
      if (url.pathname.startsWith('/.well-known')) return new Response(null, { status: 404 });
      if (body.includes('current-user-principal'))
        return multistatus(
          '/',
          '<d:current-user-principal><d:href>/user/principal/</d:href></d:current-user-principal>',
        );
      if (body.includes('calendar-home-set'))
        return multistatus(
          '/user/principal/',
          '<c:calendar-home-set><d:href>/user/calendars/</d:href></c:calendar-home-set>',
        );
      if (body.includes('supported-report-set'))
        return multistatus('/user/calendars/private/', '<d:supported-report-set/>');
      if (init?.method === 'REPORT')
        return multistatus(
          '/user/calendars/private/event.ics',
          `<d:getetag>etag</d:getetag><c:calendar-data><![CDATA[${ics}]]></c:calendar-data>`,
        );
      return multistatus(
        '/user/calendars/private/',
        '<d:displayname>私人日历</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>',
      );
    },
  );
  const calendars = await session.list();
  assert.deepEqual(calendars, [
    { id: 'https://caldav.icloud.com/user/calendars/private/', name: '私人日历', writable: true },
  ]);
  const preview = previewCalendar(
    (await session.read(calendars[0].id, today, shiftDay(today, 1))).text,
    { id: 'icloud', timeZone: 'Asia/Shanghai' },
    today,
    shiftDay(today, 1),
  );
  assert.equal(preview.items.length, 1);
  assert.equal(preview.items[0].event!.title, '私人日程');
  assert.ok(calls.some((body) => body.includes('time-range')));
});

test('native publication extends Event recurrences to a year while retaining the original Task window', () => {
  const event = newEvent({ title: '每周会议', date: today, periods: [['08:00', '09:00']] });
  const task = newTask('每周待办', { dates: { [today]: null } });
  const definition = {
    dtstart: today,
    rrule: 'FREQ=WEEKLY',
    rdate: [],
    exdate: [],
    timeZone: 'Asia/Shanghai',
  };
  let state = { ...emptyState(), tasks: [task], calendarEvents: [event] };
  state = configureRecurrence(state, event, 'event', [definition]);
  state = configureRecurrence(state, task, 'task', [definition]);
  state = generateRecurrences(state, undefined, Date.now(), true);
  assert.ok(state.calendarEvents.some((row) => row.date >= shiftDay(today, 350)));
  assert.ok(
    state.tasks.every((row) => Object.keys(row.dates).every((date) => date <= shiftDay(today, 42))),
  );
});

test('paired devices configure calendar login over authenticated encrypted requests and reject replays', async () => {
  assert.match(syncHttpError(404, '/calendar-accounts'), /请先升级/);
  assert.equal(syncHttpError(401, '/calendar-accounts'), '配对已失效，请重新配对');
  const directory = await temporary(),
    peerDirectory = await temporary();
  const service = new StateService(new FileStore(directory)),
    peerService = new StateService(new FileStore(peerDirectory));
  const hub = new DesktopSync(service, directory, false),
    peer = new DesktopSync(peerService, peerDirectory, false);
  try {
    await hub.initialize();
    await hub.enableHub(0);
    await peer.initialize();
    const port = hub.client.config.hub!.port,
      endpoint = `http://127.0.0.1:${port}`;
    await peer.pair(await hub.invite(), endpoint);
    const reply = await peer.calendarAccounts({
      action: 'configure',
      provider: 'microsoft',
      clientId: 'client',
      clientSecret: 'center-secret',
      baseUrl: 'https://hub.example/dayweave',
    });
    assert.equal(reply.status.providers.microsoft.configured, true);
    assert.doesNotMatch(JSON.stringify(reply), /center-secret/);
    const stale = await seal(
      { seq: 1, requestId: randomUUID(), command: { action: 'status' } },
      peer.client.config.key!,
      '/calendar-accounts',
      peer.client.config.deviceId,
    );
    assert.equal(
      (
        await fetch(endpoint + '/calendar-accounts', {
          method: 'POST',
          body: JSON.stringify(stale),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(endpoint + '/calendar-accounts', {
          method: 'POST',
          headers: { Origin: 'https://outside.example' },
          body: JSON.stringify(stale),
        })
      ).status,
      403,
    );
    assert.throws(() => calendarAuthorizationUrl('https://outside.example/login'), /无效/);
    await assert.rejects(
      peer.calendarAccounts({
        action: 'select',
        accountId: randomUUID(),
        importIds: [],
        publishId: null,
      }),
      /已断开/,
    );
  } finally {
    await Promise.all([hub.close(), peer.close()]);
    service.dispose();
    peerService.dispose();
    await Promise.all([service.flush(), peerService.flush()]);
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(peerDirectory, { recursive: true, force: true }),
    ]);
  }
});
