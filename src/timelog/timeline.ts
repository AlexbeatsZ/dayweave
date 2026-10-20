import {
  dayRange,
  liveSpans,
  timestamp,
  type Span,
  type State,
  type TimeRecord,
} from './domain.js';
export type TimelineEntry = Span &
  (
    | { kind: 'gap'; key: string }
    | { kind: 'record'; key: string; record: TimeRecord; spanIndex: number }
    | { kind: 'timer'; key: string }
  );

export function buildTimeline(
  state: State,
  date: string,
  now: number,
  shortGaps = false,
): TimelineEntry[] {
  const range = dayRange(date),
    end = Math.min(range.end, now);
  if (end <= range.start) return [];
  const entries: TimelineEntry[] = [];
  for (const record of state.records.filter((row) => !row.deletedAt))
    record.spans.forEach((span, spanIndex) => {
      const start = Math.max(range.start, span.start),
        clippedEnd = Math.min(end, span.end);
      if (clippedEnd > start)
        entries.push({
          kind: 'record',
          key: `${record.id}:${spanIndex}`,
          start,
          end: clippedEnd,
          record,
          spanIndex,
        });
    });
  if (state.timer)
    liveSpans(state.timer, now).forEach((span, index) => {
      const start = Math.max(range.start, span.start),
        clippedEnd = Math.min(end, span.end);
      if (clippedEnd > start)
        entries.push({ kind: 'timer', key: `timer:${index}`, start, end: clippedEnd });
    });
  let cursor = range.start;
  for (const span of entries.slice().sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (span.start > cursor && (shortGaps || span.start - cursor >= 60000))
      entries.push({ kind: 'gap', key: `gap:${cursor}`, start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (end > cursor && (shortGaps || end - cursor >= 60000))
    entries.push({ kind: 'gap', key: `gap:${cursor}`, start: cursor, end });
  return entries.sort((a, b) => b.end - a.end || b.start - a.start || a.key.localeCompare(b.key));
}

export function adjacentGap(
  entries: TimelineEntry[],
  row: Extract<TimelineEntry, { kind: 'record' }>,
  direction: 'up' | 'down',
) {
  return entries.find(
    (entry): entry is Extract<TimelineEntry, { kind: 'gap' }> =>
      entry.kind === 'gap' &&
      (direction === 'up' ? entry.start === row.end : entry.end === row.start),
  );
}

export function fillAdjacentGap(
  state: State,
  id: string,
  spanIndex: number,
  expectedUpdatedAt: number,
  date: string,
  direction: 'up' | 'down',
  now: number,
): State {
  const record = state.records.find((row) => row.id === id && !row.deletedAt);
  if (!record || record.updatedAt !== expectedUpdatedAt)
    throw new Error('记录已发生变化，请重新查看时间线。');
  const entries = buildTimeline(state, date, now, true);
  const row = entries.find(
    (entry): entry is Extract<TimelineEntry, { kind: 'record' }> =>
      entry.kind === 'record' && entry.record.id === id && entry.spanIndex === spanIndex,
  );
  const gap = row && adjacentGap(entries, row, direction);
  if (!row || !gap) throw new Error('相邻空闲时间已发生变化，请重新查看。');
  const spans = record.spans.map((span, index) =>
    index === spanIndex
      ? {
          start: direction === 'down' ? gap.start : span.start,
          end: direction === 'up' ? gap.end : span.end,
        }
      : { ...span },
  );
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && previous.end === span.start) previous.end = span.end;
    else merged.push(span);
  }
  return {
    ...state,
    records: state.records.map((item) =>
      item.id === id ? { ...item, spans: merged, updatedAt: timestamp(item.updatedAt) } : item,
    ),
  };
}
export const lastRecordEnd = (state: State, before: number) =>
  Math.max(
    0,
    ...state.records
      .filter((row) => !row.deletedAt)
      .flatMap((row) => row.spans.map((span) => span.end))
      .filter((end) => end <= before),
  );
