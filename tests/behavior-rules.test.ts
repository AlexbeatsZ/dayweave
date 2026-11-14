import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, mergeImport, stateSchema } from '../src/model';
import { applyDelta, diffState } from '../src/state-delta';
import { fromDocument, isDocumentKey, mergeDocuments, toDocument } from '../src/sync/document';
import {
  behaviorReview,
  dayRange,
  goalStatus,
  countBehavior,
  shiftDay,
  validateState,
  type BehaviorRule,
} from '../src/timelog/domain';
import { getDayStart, setDayStart } from '../src/timezone';

const date = '2026-11-10';
const rule: BehaviorRule = {
  id: 'habit',
  name: '停止重复思考',
  kind: 'behaviorRule',
  trigger: '第二次重复考虑同一个理由',
  action: '打开速记',
  period: 'day',
  archived: false,
  updatedAt: 1,
};

test('the trigger counter counts alone, the action counter counts both, and both close at settlement', () => {
  const originalStart = getDayStart();
  setDayStart('04:00');
  try {
    const { start, end } = dayRange(date);
    const timelog = { ...emptyState().timelog, goals: [rule] };
    const fresh = goalStatus(timelog, rule, date, end);
    assert.equal(fresh.reviewStatus, null);
    assert.equal(fresh.triggered, 0);
    assert.throws(() => countBehavior(timelog, rule.id, date, 'action', start - 1), /结算前/);
    let state = countBehavior(timelog, rule.id, date, 'trigger', start);
    assert.deepEqual(
      [
        behaviorReview(state, rule.id, date)?.triggered,
        behaviorReview(state, rule.id, date)?.executed,
      ],
      [1, 0],
    );
    assert.equal(behaviorReview(state, rule.id, date)?.status, 'missed');
    state = countBehavior(state, rule.id, date, 'action', start + 1);
    state = countBehavior(state, rule.id, date, 'action', end - 1);
    const settled = goalStatus(state, rule, date, end);
    assert.equal(settled.triggered, 3);
    assert.equal(settled.executed, 2);
    assert.equal(settled.settled, true);
    assert.equal(settled.met, null);
    assert.equal(goalStatus(state, rule, shiftDay(date, 1), end).triggered, 0);
    assert.throws(() => countBehavior(state, rule.id, date, 'trigger', end), /结算前/);
    assert.throws(
      () => validateState({ ...timelog, goals: [{ ...rule, period: 'week' }] }),
      /每日回顾/,
    );
  } finally {
    setDayStart(originalStart);
  }
});

test('legacy single answers read as counts and invalid counts are rejected', () => {
  const row = (extra: object) => ({
    ...emptyState().timelog,
    goals: [rule],
    behaviorReviews: [{ id: `${rule.id}@${date}`, ruleId: rule.id, date, updatedAt: 1, ...extra }],
  });
  for (const [status, counts] of [
    ['notTriggered', [0, 0]],
    ['missed', [1, 0]],
    ['executed', [1, 1]],
  ] as const) {
    const review = behaviorReview(validateState(row({ status })), rule.id, date)!;
    assert.deepEqual([review.triggered, review.executed, review.status], [...counts, status]);
  }
  assert.throws(() => validateState(row({ status: 'missed', triggered: 1, executed: 2 })), /次数/);
});

test('counts from different days merge independently and sync', () => {
  const base = stateSchema.parse({
    ...emptyState(),
    timelog: { ...emptyState().timelog, goals: [rule] },
  });
  const next = shiftDay(date, 1);
  const yesterday = {
    ...base,
    timelog: countBehavior(base.timelog, rule.id, date, 'trigger', dayRange(date).start),
  };
  const today = {
    ...base,
    timelog: countBehavior(base.timelog, rule.id, next, 'action', dayRange(next).start),
  };
  const merged = mergeDocuments(toDocument(base), toDocument(yesterday), toDocument(today));
  assert.deepEqual(merged.conflicts, []);
  assert.ok(Object.keys(merged.doc).every(isDocumentKey));
  const synced = fromDocument(merged.doc, today);
  assert.equal(behaviorReview(synced.timelog, rule.id, date)?.executed, 0);
  assert.equal(behaviorReview(synced.timelog, rule.id, next)?.executed, 1);
  const more = {
    ...today,
    timelog: countBehavior(today.timelog, rule.id, next, 'trigger', dayRange(next).start + 1),
  };
  const delta = applyDelta(synced, diffState(today, more));
  const syncMore = mergeDocuments(toDocument(today), toDocument(more), merged.doc);
  assert.deepEqual(syncMore.conflicts, []);
  for (const state of [delta, fromDocument(syncMore.doc, synced)]) {
    const review = behaviorReview(state.timelog, rule.id, next);
    assert.deepEqual([review?.triggered, review?.executed], [2, 1]);
    assert.equal(behaviorReview(state.timelog, rule.id, date)?.triggered, 1);
  }
});

test('user backup restore preserves review history but AI imports cannot substitute answers', () => {
  const base = emptyState();
  const start = dayRange(date).start;
  const original = {
    ...base,
    timelog: countBehavior({ ...base.timelog, goals: [rule] }, rule.id, date, 'trigger', start),
  };
  const incoming = {
    ...original,
    timelog: countBehavior(original.timelog, rule.id, date, 'action', start + 1),
  };
  const userRestore = mergeImport(original, incoming);
  const apiImport = mergeImport(original, incoming, { preserveBehaviorReviews: true });
  assert.equal(behaviorReview(userRestore.timelog, rule.id, date)?.triggered, 2);
  assert.equal(behaviorReview(apiImport.timelog, rule.id, date)?.triggered, 1);
});
