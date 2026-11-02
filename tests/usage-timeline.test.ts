import test from 'node:test';
import assert from 'node:assert/strict';
import { usageEventSchema, type UsageEvent } from '../src/usage/domain.js';
import { createTimelineAxis, MERGE_GAP, mergeUsageEvents } from '../src/usage/timeline-layout.js';

const event = (patch: Partial<UsageEvent> = {}): UsageEvent =>
  usageEventSchema.parse({
    id: 'editor-1',
    deviceId: 'desktop',
    deviceName: 'OMEN',
    source: 'work-review',
    platform: 'win32',
    kind: 'app',
    app: 'Editor',
    start: 1000,
    end: 11000,
    revision: 1,
    ...patch,
  });

test('timeline coalesces each device and layer independently without changing observations', () => {
  const input = [
    event(),
    event({ id: 'phone', deviceId: 'phone', start: 4000, end: 6000 }),
    event({ id: 'web', kind: 'web', start: 5000, end: 8000 }),
    event({ id: 'editor-2', start: 11000, end: 21000 }),
    event({ id: 'deleted', start: 21000, end: 31000, deleted: true }),
  ];
  const original = structuredClone(input);
  const result = mergeUsageEvents(input);
  assert.deepEqual(input, original);
  assert.equal(result.length, 3);
  assert.deepEqual(result.find((row) => row.id === 'editor-1')!.titles, []);
  assert.equal(result.find((row) => row.id === 'editor-1')!.end, 21000);
  assert.equal(result.find((row) => row.id === 'phone')!.deviceId, 'phone');
});

test('timeline keeps interruptions, long gaps and producer identities separate', () => {
  const result = mergeUsageEvents([
    event(),
    event({ id: 'other-app', app: 'Browser', start: 11000, end: 21000 }),
    event({ id: 'back', start: 21000, end: 31000 }),
    event({ id: 'later', start: 31000 + MERGE_GAP + 1, end: 41000 + MERGE_GAP }),
    event({ id: 'old-producer', deviceId: 'old-desktop' }),
    event({ id: 'unlock-1', kind: 'unlock', start: 1000, end: 1000 }),
    event({ id: 'unlock-2', kind: 'unlock', start: 1000, end: 1000 }),
  ]);
  assert.equal(result.length, 7);
});

test('same app merges across window titles and short gaps; websites merge per host', () => {
  const result = mergeUsageEvents([
    event({ id: 'f1', app: 'Finder', title: '下载' }),
    event({ id: 'f2', app: 'Finder', title: '文稿', start: 30000, end: 40000 }),
    event({ id: 'f3', app: 'Finder', title: '下载', start: 100000, end: 110000 }),
    event({ id: 'w1', kind: 'web', app: 'Chrome', url: 'https://a.test/1', title: 'A1' }),
    event({
      id: 'w2',
      kind: 'web',
      app: 'Chrome',
      url: 'https://a.test/2',
      title: 'A2',
      start: 11000,
      end: 20000,
    }),
    event({
      id: 'w3',
      kind: 'web',
      app: 'Chrome',
      url: 'https://b.test/',
      title: 'B',
      start: 20000,
      end: 30000,
    }),
  ]);
  const finder = result.filter((row) => row.app === 'Finder');
  assert.equal(finder.length, 1);
  assert.equal(finder[0].end, 110000);
  assert.deepEqual(finder[0].titles, ['下载', '文稿']);
  assert.deepEqual(
    result.filter((row) => row.kind === 'web').map((row) => row.titles),
    [['A1', 'A2'], ['B']],
  );
});

test('automatic axis expands short records and compresses empty hours on a shared clock', () => {
  const spans = [
    { start: 10000, end: 15000 },
    { start: 15000, end: 20000 },
    { start: 36000000, end: 36005000 },
  ];
  const axis = createTimelineAxis(spans, { start: 0, end: 86400000 });
  for (const span of spans) assert.ok(axis.top(span.start) - axis.top(span.end) >= 76);
  assert.equal(axis.top(20000) - axis.top(36000000), 28);
  assert.ok(axis.height < 400);
  assert.ok(axis.top(15000) > axis.top(36000000));
  assert.equal(axis.top(-1), axis.top(0));
  assert.equal(axis.top(86400001), axis.top(86400000));
  assert.ok(axis.top(12500) < axis.top(10000));
  for (let index = 1; index < axis.ticks.length; index++)
    assert.ok(axis.ticks[index].top - axis.ticks[index - 1].top >= 24);
});

test('shared axis handles overlapping ranges, midnight clipping and unlock instants', () => {
  const spans = [
    { start: 0, end: 1500 },
    { start: 1000, end: 1200 },
    { start: 1200, end: 2000 },
    { start: 2000, end: 3000 },
    { start: 1600, end: 1600 },
  ];
  const axis = createTimelineAxis(spans, { start: 1000, end: 2500 });
  for (const span of spans.filter((span) => span.start < span.end))
    assert.ok(axis.top(Math.max(1000, span.start)) - axis.top(Math.min(2500, span.end)) >= 76);
  assert.ok(axis.top(1600) >= 12 && axis.top(1600) <= axis.height - 12);
  assert.equal(axis.top(1000), axis.height - 12);
  assert.equal(axis.top(2500), 12);
  assert.equal(createTimelineAxis([{ start: 0, end: 1000 }], { start: 1000, end: 2000 }).height, 0);
  assert.equal(createTimelineAxis([], { start: 1000, end: 2000 }).height, 0);
  assert.equal(createTimelineAxis(spans, { start: 4000, end: 2500 }).height, 0);
  assert.ok(
    createTimelineAxis([{ start: 1000, end: 1000 }], { start: 1000, end: 2000 }).height > 0,
  );
});
