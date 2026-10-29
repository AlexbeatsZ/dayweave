import test from 'node:test';
import assert from 'node:assert/strict';
import { usageEventSchema, type UsageEvent } from '../src/usage/domain.js';
import {
  createTimelineAxis,
  mergeUsageEvents,
  timelineLanes,
} from '../src/usage/timeline-layout.js';

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
  assert.equal(result.find((row) => row.id === 'editor-1')!.end, 21000);
  assert.equal(result.find((row) => row.id === 'phone')!.deviceId, 'phone');
});

test('timeline keeps interruptions, changed content and producer identities separate', () => {
  const result = mergeUsageEvents([
    event(),
    event({ id: 'other-app', app: 'Browser', start: 11000, end: 21000 }),
    event({ id: 'back', start: 21000, end: 31000 }),
    event({ id: 'title', start: 31000, end: 41000, title: 'Another file' }),
    event({ id: 'url', start: 41000, end: 51000, title: 'Another file', url: 'https://a.test' }),
    event({ id: 'old-producer', deviceId: 'old-desktop' }),
    event({ id: 'unlock-1', kind: 'unlock', start: 1000, end: 1000 }),
    event({ id: 'unlock-2', kind: 'unlock', start: 1000, end: 1000 }),
  ]);
  assert.equal(result.length, 8);
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

test('overlap lanes belong to each local cluster, not the whole day', () => {
  const lanes = timelineLanes([
    { id: 'app', start: 0, end: 300 },
    { id: 'web', start: 100, end: 200 },
    { id: 'another-web', start: 200, end: 300 },
    { id: 'later', start: 400, end: 500 },
  ]);
  assert.deepEqual(lanes.get('app'), { lane: 0, lanes: 2 });
  assert.deepEqual(lanes.get('web'), { lane: 1, lanes: 2 });
  assert.deepEqual(lanes.get('another-web'), { lane: 1, lanes: 2 });
  assert.deepEqual(lanes.get('later'), { lane: 0, lanes: 1 });
});
