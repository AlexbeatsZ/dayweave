import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, mergeImport, stateSchema } from '../src/model';
import { applyDelta, diffState } from '../src/state-delta';
import { fromDocument, isDocumentKey, mergeDocuments, toDocument } from '../src/sync/document';
import {
  behaviorReview,
  dayRange,
  goalStatus,
  reviewBehavior,
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

test('a daily review distinguishes unanswered from all three self-reported answers and closes at settlement', () => {
  const originalStart = getDayStart();
  setDayStart('04:00');
  try {
    const { start, end } = dayRange(date);
    const timelog = { ...emptyState().timelog, goals: [rule] };
    assert.equal(goalStatus(timelog, rule, date, end).reviewStatus, null);
    assert.throws(() => reviewBehavior(timelog, rule.id, date, 'executed', start - 1), /结算前/);
    for (const status of ['notTriggered', 'missed', 'executed'] as const) {
      const answered = reviewBehavior(timelog, rule.id, date, status, end - 1);
      const settled = goalStatus(answered, rule, date, end);
      assert.equal(settled.reviewStatus, status);
      assert.equal(settled.settled, true);
      assert.equal(settled.met, null);
      assert.equal(goalStatus(answered, rule, shiftDay(date, 1), end).reviewStatus, null);
      assert.throws(() => reviewBehavior(answered, rule.id, date, null, end), /结算前/);
      const cleared = reviewBehavior(answered, rule.id, date, null, end - 1);
      assert.equal(goalStatus(cleared, rule, date, end).reviewStatus, null);
    }
    assert.throws(() => reviewBehavior(timelog, rule.id, date, 'missed', end), /结算前/);
    assert.throws(
      () => validateState({ ...timelog, goals: [{ ...rule, period: 'week' }] }),
      /每日回顾/,
    );
  } finally {
    setDayStart(originalStart);
  }
});

test('reviews from different days merge independently and clearing a review syncs', () => {
  const base = stateSchema.parse({
    ...emptyState(),
    timelog: { ...emptyState().timelog, goals: [rule] },
  });
  const next = shiftDay(date, 1);
  const yesterday = {
    ...base,
    timelog: reviewBehavior(base.timelog, rule.id, date, 'notTriggered', dayRange(date).start),
  };
  const today = {
    ...base,
    timelog: reviewBehavior(base.timelog, rule.id, next, 'executed', dayRange(next).start),
  };
  const merged = mergeDocuments(toDocument(base), toDocument(yesterday), toDocument(today));
  assert.deepEqual(merged.conflicts, []);
  assert.ok(Object.keys(merged.doc).every(isDocumentKey));
  const synced = fromDocument(merged.doc, today);
  assert.equal(behaviorReview(synced.timelog, rule.id, date)?.status, 'notTriggered');
  assert.equal(behaviorReview(synced.timelog, rule.id, next)?.status, 'executed');
  const cleared = {
    ...today,
    timelog: reviewBehavior(today.timelog, rule.id, next, null, dayRange(next).start + 1),
  };
  const delta = applyDelta(synced, diffState(today, cleared));
  const syncClear = mergeDocuments(toDocument(today), toDocument(cleared), merged.doc);
  assert.deepEqual(syncClear.conflicts, []);
  for (const state of [delta, fromDocument(syncClear.doc, synced)]) {
    assert.equal(behaviorReview(state.timelog, rule.id, next), null);
    assert.equal(behaviorReview(state.timelog, rule.id, date)?.status, 'notTriggered');
  }
});

test('user backup restore preserves review history but AI imports cannot substitute answers', () => {
  const base = emptyState();
  const start = dayRange(date).start;
  const original = {
    ...base,
    timelog: reviewBehavior({ ...base.timelog, goals: [rule] }, rule.id, date, 'missed', start),
  };
  const incoming = {
    ...original,
    timelog: reviewBehavior(original.timelog, rule.id, date, 'executed', start + 1),
  };
  const userRestore = mergeImport(original, incoming);
  const apiImport = mergeImport(original, incoming, { preserveBehaviorReviews: true });
  assert.equal(behaviorReview(userRestore.timelog, rule.id, date)?.status, 'executed');
  assert.equal(behaviorReview(apiImport.timelog, rule.id, date)?.status, 'missed');
});
