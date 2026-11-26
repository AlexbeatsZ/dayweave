import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import ICAL from 'ical.js';
import { emptyState, newTask, stateSchema, mergeImport } from '../src/model.js';
import {
  calendarEventSchema,
  eventTemplateSchema,
  type RecurrenceDefinition,
} from '../src/event-model.js';
import { recurrenceDates, cronToRecurrence } from '../src/recurrence.js';
import {
  newEvent,
  saveEvent,
  deleteEvent,
  configureRecurrence,
  generateRecurrences,
  eventBounds,
} from '../src/event-domain.js';
import { exportEventCalendar } from '../src/calendar-export.js';
import { arrangementMigrationReport } from '../src/event-migration.js';
import { toDocument, fromDocument, mergeDocuments } from '../src/sync/document.js';
import { diffState, applyDelta } from '../src/state-delta.js';
import { FileStore } from '../electron/storage.js';
import { StateService } from '../electron/state-service.js';
import { CalendarFeed } from '../electron/calendar-feed.js';
import { wallTime, zoneDateKey } from '../src/timezone.js';
import { DesktopSync } from '../electron/sync.js';
import { SyncClient, fetchEnvelope } from '../src/sync/client.js';

const at = Date.parse('2026-11-05T10:00:00Z');
const definition = (
  rrule: string,
  dtstart = '2026-11-02',
  extra: Partial<RecurrenceDefinition> = {},
): RecurrenceDefinition => ({
  dtstart,
  rrule,
  timeZone: 'Asia/Shanghai',
  rdate: [],
  exdate: [],
  ...extra,
});

test('RRULE covers intervals, teaching weeks, monthly ordinal weekdays, count, until and exceptions', () => {
  assert.deepEqual(recurrenceDates(definition('FREQ=WEEKLY;INTERVAL=2;COUNT=3'), '2026-12-31'), [
    '2026-11-02',
    '2026-11-16',
    '2026-11-30',
  ]);
  assert.deepEqual(
    recurrenceDates(definition('FREQ=MONTHLY;BYDAY=2MO;COUNT=3', '2026-11-09'), '2027-02-01'),
    ['2026-11-09', '2026-12-14', '2027-01-11'],
  );
  assert.deepEqual(
    recurrenceDates(
      definition('FREQ=DAILY;INTERVAL=3;UNTIL=20261108', '2026-11-02', {
        rdate: ['2026-11-12'],
        exdate: ['2026-11-05'],
      }),
      '2026-12-01',
    ),
    ['2026-11-02', '2026-11-08', '2026-11-12'],
  );
  assert.deepEqual(recurrenceDates(definition('FREQ=YEARLY;COUNT=2', '2024-02-29'), '2030-01-01'), [
    '2024-02-29',
    '2028-02-29',
  ]);
});

test('RRULE uses local clocks across DST and compares a UTC UNTIL correctly', () => {
  const dates = recurrenceDates(
    definition('FREQ=DAILY;UNTIL=20261102T140000Z', '2026-10-31T09:00', {
      timeZone: 'America/New_York',
    }),
    '2026-11-10',
  );
  assert.deepEqual(dates, ['2026-10-31T09:00', '2026-11-01T09:00', '2026-11-02T09:00']);
  assert.equal(
    wallTime('2026-11-01', '09:00', 'America/New_York') -
      wallTime('2026-10-31', '09:00', 'America/New_York'),
    25 * 3600000,
  );
});

test('period validation supports gaps, adjacency, all-day and overnight imports', () => {
  const event = newEvent({
    title: '实验',
    date: '2026-11-02',
    periods: [
      ['08:00', '08:45'],
      ['08:55', '09:40'],
    ],
  });
  assert.equal(event.periods.length, 2);
  assert.throws(() =>
    calendarEventSchema.parse({
      ...event,
      periods: [
        ['08:00', '09:30'],
        ['09:00', '10:00'],
      ],
    }),
  );
  assert.throws(() => calendarEventSchema.parse({ ...event, allDay: true }));
  assert.equal(
    newEvent({ title: '通宵', date: event.date, durationDays: 2, periods: [['23:00', '01:00']] })
      .durationDays,
    2,
  );
});

test('Task and Event use one allocation ledger, preserve edits, and never regenerate cancelled instances', () => {
  let state = emptyState();
  const event = newEvent({ title: '答辩', date: '2026-11-02' });
  state.calendarEvents = [event];
  state = configureRecurrence(state, event, 'event', [
    definition('FREQ=WEEKLY;INTERVAL=2;COUNT=4'),
  ]);
  state = generateRecurrences(state, '2026-12-31', at);
  assert.equal(state.calendarEvents.length, 4);
  const second = state.calendarEvents[1];
  state = saveEvent(
    state,
    { ...second, title: '考试', type: 'exam', date: '2026-11-17' },
    second.updatedAt,
  );
  state = deleteEvent(state, state.calendarEvents[2].id);
  const saved = structuredClone(state);
  state = generateRecurrences(stateSchema.parse(state), '2026-12-31', at);
  assert.deepEqual(state.calendarEvents, saved.calendarEvents);
  assert.equal(state.calendarEvents[1].recurrenceId, second.recurrenceId);
  assert.equal(state.calendarEvents[2].deletedAt !== null, true);
  state = configureRecurrence(state, event, 'event', [definition('FREQ=WEEKLY;COUNT=10')]);
  state = generateRecurrences(state, '2026-12-31', at);
  for (const old of saved.calendarEvents)
    assert.deepEqual(
      state.calendarEvents.find((row) => row.id === old.id),
      old,
    );
  assert.equal(
    new Set(state.calendarEvents.map((row) => row.id)).size,
    state.calendarEvents.length,
  );
});

test('multiple course time patterns share a prefix with independent period templates', () => {
  let state = emptyState();
  const event = newEvent({ title: '化学', type: 'course', date: '2026-11-02' });
  state.calendarEvents = [event];
  state = configureRecurrence(state, event, 'event', [
    definition('FREQ=WEEKLY;COUNT=2'),
    definition('FREQ=WEEKLY;COUNT=2', '2026-11-05', {
      eventTemplate: { ...eventTemplateSchema.strip().parse(event), periods: [['13:30', '15:00']] },
    }),
  ]);
  state = generateRecurrences(state, '2026-11-30', at);
  assert.equal(state.calendarEvents.length, 4);
  assert.deepEqual(state.calendarEvents.find((row) => row.date === '2026-11-05')!.periods, [
    ['13:30', '15:00'],
  ]);
  assert.equal(new Set(state.calendarEvents.map((row) => row.id.replace(/-\d+$/, ''))).size, 1);
});

test('minute and zero-second DTSTART values share one original occurrence identity', () => {
  const event = newEvent({ title: '秒精度锚点', date: '2026-11-02' });
  let state = configureRecurrence({ ...emptyState(), calendarEvents: [event] }, event, 'event', [
    definition('FREQ=DAILY;COUNT=2', '2026-11-02T09:00:00'),
  ]);
  state = generateRecurrences(state, '2026-11-03', at);
  assert.equal(state.calendarEvents.length, 2);
  assert.equal(state.calendarEvents[0].id, event.id);
});

test('bulk edits change only explicitly changed properties and retain original dates and identities', () => {
  let state = emptyState();
  const first = newEvent({ title: '课程', date: '2026-11-02' });
  state.calendarEvents = [first];
  state = configureRecurrence(state, first, 'event', [definition('FREQ=WEEKLY;COUNT=3')]);
  state = generateRecurrences(state, '2026-12-01', at);
  state.calendarEvents[1].location = '独立教室';
  const originals = state.calendarEvents.map((row) => [row.id, row.date, row.recurrenceId]);
  state = saveEvent(state, { ...first, type: 'exam' }, first.updatedAt, 'all');
  assert.ok(state.calendarEvents.every((row) => row.type === 'exam'));
  assert.equal(state.calendarEvents[1].location, '独立教室');
  assert.deepEqual(
    state.calendarEvents.map((row) => [row.id, row.date, row.recurrenceId]),
    originals,
  );
});

test('task RRULE preserves multi-date offsets, priorities and completed rows', () => {
  let state = emptyState();
  const task = newTask('实验报告', {
    dates: { '2026-11-02': null, '2026-11-03': null },
    priority: 3,
    estimatedMinutes: 45,
  });
  state.tasks = [task];
  state = configureRecurrence(
    state,
    task,
    'task',
    [definition('FREQ=WEEKLY;INTERVAL=2;COUNT=3')],
    true,
    [0, 1],
  );
  state = generateRecurrences(state, '2026-12-01', at);
  assert.equal(state.tasks.length, 3);
  assert.deepEqual(Object.keys(state.tasks[1].dates), ['2026-11-16', '2026-11-17']);
  assert.equal(state.tasks[1].priority, 3);
  assert.equal(state.calendarEvents.length, 0);
  state.tasks[1].deletedAt = new Date(at).toISOString();
  assert.equal(generateRecurrences(state, '2026-12-01', at).tasks.length, 3);
});

test('timed Task RRULE uses the business day and includes the next civil day before its boundary', () => {
  const task = newTask('凌晨报告', { dates: { '2026-11-01': null } });
  const base = emptyState();
  base.settings.dayStartsAt = '04:00';
  base.tasks = [task];
  let state = configureRecurrence(base, task, 'task', [
    definition('FREQ=DAILY;COUNT=2', '2026-11-02T02:00'),
  ]);
  state = generateRecurrences(state, '2026-11-02', at);
  assert.equal(state.tasks.length, 2);
  assert.deepEqual(Object.keys(state.tasks[1].dates), ['2026-11-02']);
});

test('legacy course migration is deterministic, idempotent and preserves ordinary event tags', () => {
  const old = emptyState();
  old.schedule.semesterStart = '2026-09-07';
  old.schedule.courses = [
    {
      id: 'chem-mon',
      name: '化学',
      teacher: '张老师',
      location: '实验楼',
      color: '#4264b2',
      weekday: 1,
      start: '08:00',
      end: '09:40',
      weeks: [1, 3, 5],
      excludedDates: ['2026-09-21'],
      updatedAt: at,
    },
  ];
  old.tasks = [
    newTask('带普通事件标签的待办', {
      tags: ['事件'],
      estimatedMinutes: 30,
      dates: { '2026-11-05': null },
    }),
  ];
  const migrated = stateSchema.parse(old);
  assert.equal(migrated.calendarEvents.length, 3);
  assert.equal(migrated.calendarEvents.filter((row) => row.deletedAt).length, 1);
  assert.deepEqual(migrated.tasks, old.tasks);
  assert.deepEqual(stateSchema.parse(migrated), migrated);
  assert.deepEqual(stateSchema.parse(old).calendarEvents, migrated.calendarEvents);
  assert.equal(arrangementMigrationReport(migrated).needsReview.length, 1);
  assert.equal(migrated.recurrences[0].definitions[0].rrule, 'FREQ=WEEKLY;INTERVAL=2;COUNT=3');
  assert.deepEqual(migrated.calendarEvents[0].periods, [
    ['08:00', '08:45'],
    ['08:55', '09:40'],
  ]);
});

test('native Event entities survive persistence, delta, backup merge and offline concurrent field edits', () => {
  const base = emptyState();
  const event = newEvent({ title: '会议', date: '2026-11-05' });
  base.calendarEvents = [event];
  const a = structuredClone(base),
    b = structuredClone(base);
  a.calendarEvents[0].title = '新标题';
  b.calendarEvents[0].location = '会议室';
  a.calendarEvents[0].updatedAt = new Date(Date.parse(event.updatedAt) + 1000).toISOString();
  const merged = mergeDocuments(toDocument(base), toDocument(a), toDocument(b));
  const result = fromDocument(merged, base);
  assert.equal(result.calendarEvents[0].title, '新标题');
  assert.equal(result.calendarEvents[0].location, '会议室');
  assert.equal(applyDelta(b, diffState(base, a)).calendarEvents[0].location, '会议室');
  assert.equal(mergeImport(base, a).calendarEvents[0].title, '新标题');
  const deleted = deleteEvent(base, event.id);
  const tombstone = fromDocument(
    mergeDocuments(toDocument(base), toDocument(a), toDocument(deleted)),
    base,
  );
  assert.ok(tombstone.calendarEvents[0].deletedAt);
});

test('migration preserves ambiguous overlapping legacy rows and does not restore a removed mapped instance', () => {
  const state = emptyState();
  state.schedule.semesterStart = '2026-09-07';
  const course = {
    id: 'first',
    name: '重名课程',
    teacher: '老师',
    location: 'A',
    color: '#4264b2',
    weekday: 1,
    start: '08:00',
    end: '09:00',
    weeks: [1, 2],
    excludedDates: [],
    updatedAt: at,
  };
  state.schedule.courses = [course, { ...course, id: 'second', location: 'B' }];
  const migrated = stateSchema.parse(state);
  assert.equal(migrated.calendarEvents.length, 4);
  const id = migrated.calendarEvents[0].id;
  migrated.calendarEvents = migrated.calendarEvents.filter((row) => row.id !== id);
  const again = stateSchema.parse(migrated);
  assert.equal(again.calendarEvents.length, 3);
  assert.equal(
    again.calendarEvents.some((row) => row.id === id),
    false,
  );
});

const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting-1\r\nDTSTART;TZID=Asia/Shanghai:20261102T080000\r\nDTEND;TZID=Asia/Shanghai:20261102T090000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:例会\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:meeting-1\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261109T080000\r\nDTSTART;TZID=Asia/Shanghai:20261110T100000\r\nDTEND;TZID=Asia/Shanghai:20261110T110000\r\nSUMMARY:改期例会\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:holiday-1\r\nDTSTART;VALUE=DATE:20261104\r\nDTEND;VALUE=DATE:20261106\r\nSUMMARY:全天活动\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
test('calendar exports use one stable UID, full period envelope and cancellation status', () => {
  const event = newEvent({
    title: '演讲',
    date: '2026-11-05',
    periods: [
      ['08:00', '08:45'],
      ['08:55', '09:40'],
    ],
  });
  const raw = exportEventCalendar([event]);
  const component = new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent')!;
  const imported = new ICAL.Event(component);
  assert.equal(imported.uid, `${event.id}@dayweave`);
  assert.equal(imported.startDate.toUnixTime() * 1000, eventBounds(event).start);
  assert.equal(imported.endDate.toUnixTime() * 1000, eventBounds(event).end);
  assert.match(String(component.getFirstPropertyValue('description')), /08:55–09:40/);
  assert.match(
    exportEventCalendar([{ ...event, deletedAt: new Date(at).toISOString() }]),
    /STATUS:CANCELLED/,
  );
});

test('Cron conversion is explicit and keeps unsupported Cron semantics available', () => {
  assert.equal(
    cronToRecurrence('0 4 * * 1,4', '2026-11-02', 'Asia/Shanghai')!.rrule,
    'FREQ=WEEKLY;BYDAY=MO,TH',
  );
  assert.equal(
    cronToRecurrence('0 4 31 * *', '2026-11-02', 'Asia/Shanghai')!.dtstart,
    '2026-12-31T04:00',
  );
  assert.equal(cronToRecurrence('*/15 * * * *', '2026-11-02', 'Asia/Shanghai'), null);
  assert.equal(cronToRecurrence('0 2 * * *', '2026-11-02', 'Asia/Shanghai', '04:00'), null);
});

test('calendar feed is revocable, Event-only and preserves original pre-migration bytes', async () => {
  const directory = await tempDirectory('dayweave-arrangements-');
  const service = new StateService(new FileStore(directory));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const old = emptyState() as unknown as Record<string, unknown>;
    delete old.calendarEvents;
    delete old.recurrences;
    delete old.calendarSubscriptions;
    const raw = JSON.stringify(old);
    await writeFile(`${directory}/data.json`, raw);
    await service.snapshot();
    assert.equal(await readFile(`${directory}/data.before-arrangements.json`, 'utf8'), raw);
    await service.mutate((state) => ({
      ...state,
      tasks: [newTask('私有待办')],
      calendarEvents: [
        newEvent({ title: '公开日程', date: '2026-11-05' }),
        { ...newEvent({ title: '期中考试', date: '2026-11-06' }), type: 'exam' },
      ],
      settings: {
        ...state.settings,
        calendarFeeds: [
          { id: 'all', name: '全部', enabled: true, token: 'a'.repeat(64), types: [] },
          { id: 'exams', name: '考试', enabled: true, token: 'b'.repeat(64), types: ['exam'] },
        ],
      },
    }));
    const publisher = new CalendarFeed(service);
    server = createServer((request, response) => {
      void publisher.serve(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/calendar/${'a'.repeat(64)}.ics`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const content = await response.text();
    assert.match(content, /公开日程/);
    assert.match(content, /期中考试/);
    assert.doesNotMatch(content, /私有待办/);
    assert.match(content, /X-WR-CALNAME:全部/);
    assert.equal(content.match(/TRIGGER:-PT30M/g)?.length, 2);
    assert.equal(content.match(/TRIGGER:-PT15M/g)?.length, 2);
    const exams = await (await fetch(url.replace('a'.repeat(64), 'b'.repeat(64)))).text();
    assert.match(exams, /期中考试/);
    assert.doesNotMatch(exams, /公开日程/);
    await service.mutate((state) => ({
      ...state,
      settings: {
        ...state.settings,
        calendarFeeds: state.settings.calendarFeeds!.map((feed) =>
          feed.id === 'all' ? { ...feed, enabled: false } : feed,
        ),
      },
    }));
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(url.replace('a'.repeat(64), 'c'.repeat(64)))).status, 404);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('encrypted hub exchange generates once and converges two offline Event editors', async () => {
  const directory = await tempDirectory('dayweave-arrangements-sync-');
  const service = new StateService(new FileStore(directory));
  const hub = await new DesktopSync(service, directory, false).initialize();
  hub.client.config.hub = { port: 0, clients: {} };
  await hub.enableHub();
  const endpoint = `http://127.0.0.1:${hub.client.config.hub.port}`;
  const memory = () => {
    let state = emptyState(),
      raw: string | null = null;
    const client = new SyncClient(
      {
        read: async () => raw,
        write: async (value) => {
          raw = value;
        },
      },
      {
        snapshot: async () => ({ state: structuredClone(state) }),
        mutate: async (fn) => {
          state = fn(state);
        },
      },
      fetchEnvelope,
      'test',
    );
    return {
      client,
      get: () => state,
      set: (value: typeof state) => {
        state = value;
      },
    };
  };
  const a = memory(),
    b = memory();
  try {
    await a.client.load();
    await b.client.load();
    await a.client.pair(await hub.invite(), endpoint);
    await a.client.now();
    await b.client.pair(await hub.invite(), endpoint);
    await b.client.now();
    const event = newEvent({
      title: '加密同步日程',
      date: zoneDateKey(Date.now(), 'Asia/Shanghai'),
    });
    a.set(
      configureRecurrence({ ...a.get(), calendarEvents: [event] }, event, 'event', [
        definition('FREQ=DAILY;COUNT=5', event.date),
      ]),
    );
    await a.client.now();
    await b.client.now();
    assert.equal(a.client.connected, true, a.client.error);
    assert.equal(b.get().calendarEvents.length, 5);
    a.get().calendarEvents[0].title = '离线标题';
    b.get().calendarEvents[0].location = '离线地点';
    await a.client.now();
    await b.client.now();
    await a.client.now();
    assert.equal(a.get().calendarEvents[0].title, '离线标题');
    assert.equal(a.get().calendarEvents[0].location, '离线地点');
    const cancelledId = a.get().calendarEvents[2].id;
    a.set(deleteEvent(a.get(), cancelledId));
    b.get().calendarEvents[2].notes = '旧设备保留的备注';
    await a.client.now();
    await b.client.now();
    await a.client.now();
    assert.ok(a.get().calendarEvents.find((row) => row.id === cancelledId)!.deletedAt);
    await hub.ensureTasks(event.date);
    await b.client.now();
    await a.client.now();
    assert.equal((await service.snapshot()).state.calendarEvents.length, 5);
    assert.deepEqual(a.get().calendarEvents, b.get().calendarEvents);
  } finally {
    await hub.close();
    service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the single legacy feed migrates with its token, including from older sync peers', () => {
  const legacy = { enabled: true, token: 'd'.repeat(64), baseUrl: 'https://hub.example/dayweave' };
  const state = stateSchema.parse({
    ...emptyState(),
    settings: { ...emptyState().settings, calendarFeed: legacy },
  });
  assert.deepEqual(state.settings.calendarFeeds, [
    { id: 'default', name: 'Dayweave · 时织', types: [], ...legacy },
  ]);
  assert.equal('calendarFeed' in state.settings, false);
  const doc = toDocument(state);
  const { calendarFeeds: _feeds, ...older } = doc.preferences as Record<string, unknown>;
  const fromOlderPeer = fromDocument(
    { ...doc, preferences: { ...older, calendarFeed: legacy } },
    state,
  );
  assert.equal(fromOlderPeer.settings.calendarFeeds?.[0].token, legacy.token);
  const removed = fromDocument({ ...doc, preferences: older }, state);
  assert.equal(removed.settings.calendarFeeds, undefined);
  assert.throws(() =>
    stateSchema.parse({
      ...state,
      settings: {
        ...state.settings,
        calendarFeeds: [
          ...state.settings.calendarFeeds!,
          { ...state.settings.calendarFeeds![0], id: 'copy' },
        ],
      },
    }),
  );
});

async function tempDirectory(prefix: string) {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, prefix));
}
