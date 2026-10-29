import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalLanes } from '../src/interval-lanes.js';

const shortFirst = (left: { end: number }, right: { end: number }) => left.end - right.end;
const longFirst = (left: { end: number; id: string }, right: { end: number; id: string }) =>
  right.end - left.end || left.id.localeCompare(right.id);

test('staggered intervals have fixed equal lanes and later clusters regain full width', () => {
  const items = [
    { start: 2, end: 5 },
    { start: 1, end: 4 },
    { start: 5, end: 6 },
  ];
  const lanes = intervalLanes(items, shortFirst);
  assert.deepEqual(
    items.map((item) => lanes.get(item)),
    [
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
      { lane: 0, lanes: 1 },
    ],
  );
});

test('adjacent ranges reuse a lane within a cluster without enlarging later clusters', () => {
  const items = [
    { start: 0, end: 300 },
    { start: 100, end: 200 },
    { start: 200, end: 300 },
    { start: 400, end: 500 },
  ];
  assert.deepEqual(
    [...intervalLanes(items, shortFirst).values()],
    [
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ],
  );
});

test('same-start courses stay short-first while usage stays long-first with stable ID ties', () => {
  const items = [
    { id: 'z', start: 1, end: 4 },
    { id: 'a', start: 1, end: 4 },
    { id: 'short', start: 1, end: 2 },
  ];
  assert.deepEqual(
    [...intervalLanes(items, shortFirst).keys()].map((item) => item.id),
    ['short', 'z', 'a'],
  );
  assert.deepEqual(
    [...intervalLanes(items, longFirst).keys()].map((item) => item.id),
    ['a', 'z', 'short'],
  );
  assert.deepEqual(
    [...intervalLanes(items, longFirst).values()],
    [
      { lane: 0, lanes: 3 },
      { lane: 1, lanes: 3 },
      { lane: 2, lanes: 3 },
    ],
  );
});

test('repeated source IDs remain distinct occurrences and input is not mutated', () => {
  const items = [
    { id: 'course', start: 10, end: 20 },
    { id: 'course', start: 1, end: 4 },
    { id: 'course', start: 2, end: 5 },
  ];
  const original = structuredClone(items);
  const lanes = intervalLanes(items, shortFirst);
  assert.equal(lanes.size, 3);
  assert.deepEqual(items, original);
  assert.deepEqual(
    items.map((item) => lanes.get(item)),
    [
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ],
  );
});

test('cross-midnight courses are ordered before clipping and never change actual instants', () => {
  const items = [
    { start: -20, end: 30 },
    { start: -10, end: 20 },
    { start: 20, end: 60 },
    { start: 100, end: 110 },
  ];
  const visible = items.filter((item) => item.start < 50 && item.end > 0);
  const layout = [...intervalLanes(visible, shortFirst)].map(([item, placement]) => ({
    ...placement,
    start: Math.max(0, item.start),
    end: Math.min(50, item.end),
  }));
  assert.deepEqual(layout, [
    { lane: 0, lanes: 2, start: 0, end: 30 },
    { lane: 1, lanes: 2, start: 0, end: 20 },
    { lane: 1, lanes: 2, start: 20, end: 50 },
  ]);
  assert.equal(items[0].start, -20);
  assert.equal(items[2].end, 60);
});

test('empty and standalone intervals require no spare lanes', () => {
  assert.equal(intervalLanes([], shortFirst).size, 0);
  assert.deepEqual(
    [...intervalLanes([{ start: 1, end: 2 }], shortFirst).values()],
    [{ lane: 0, lanes: 1 }],
  );
});
