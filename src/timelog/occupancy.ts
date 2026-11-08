import { dateTimeInput } from '../timezone.js';
import type { Span, State, Timer } from './domain.js';
import { subtract } from './script-util.js';

type Occupied = { spans: readonly Span[]; timer: boolean };
type Occupancy = Map<string, Occupied>;
type Segment = Span & { id: string; timer: boolean };

// Pausing changes duration, not the reservation. A stop releases the unused parts.
export const timerReservation = (timer: Timer): Span => ({ start: timer.startedAt, end: Infinity });

export function timeOccupancy(state: State): Occupancy {
  const occupied: Occupancy = new Map();
  for (const row of state.records)
    if (row.deletedAt === null) occupied.set(row.id, { spans: row.spans, timer: false });
  for (const timer of [state.timer, ...(state.conflictedTimers ?? [])])
    if (timer)
      occupied.set(timer.id, {
        spans: [timerReservation(timer)],
        timer: true,
      });
  return occupied;
}

export class TimeOverlap extends Error {
  readonly status = 409;
  readonly reason = 'TIME_OVERLAP';
  readonly detail;
  constructor(id: string, other: Segment, overlap: Span) {
    const start = dateTimeInput(other.start).replace('T', ' ');
    const time = other.timer
      ? `未结束的计时（${start} 开始）`
      : `已有记录（${start} 至 ${dateTimeInput(other.end).replace('T', ' ')}）`;
    super(
      `TIME_OVERLAP: 这段时间与${time}重叠。${other.timer ? '请先结束计时，或将记录移到计时开始前。' : '请调整起止时间，让两段时间不重叠。'}`,
    );
    this.detail = {
      recordId: id,
      conflictingRecordId: other.id,
      conflictingTimer: other.timer,
      startAt: overlap.start,
      endAt: Number.isFinite(overlap.end) ? overlap.end : null,
    };
  }
}

/** Every new overlap includes a point newly occupied by at least one of its IDs. */
export function* newTimeOverlaps(
  before: Occupancy,
  after: Occupancy,
): Generator<TimeOverlap, void> {
  const added: Segment[] = [];
  for (const [id, { spans, timer }] of after) {
    const previous = before.get(id)?.spans ?? [];
    if (
      spans.length === previous.length &&
      spans.every((span, i) => span.start === previous[i].start && span.end === previous[i].end)
    )
      continue;
    for (const span of subtract(spans, previous)) added.push({ ...span, id, timer });
  }
  if (!added.length) return;

  const occupied = [...after].flatMap(([id, { spans, timer }]) =>
    spans.map((span) => ({ ...span, id, timer })),
  );
  occupied.sort((a, b) => a.start - b.start);
  added.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  // For each added span, only the two farthest ends with distinct IDs matter:
  // the longest could belong to this same record. Both comparisons are strict.
  let cursor = 0;
  let first: Segment | undefined;
  let second: Segment | undefined;
  for (const span of added) {
    while (cursor < occupied.length && occupied[cursor].start < span.end) {
      const candidate = occupied[cursor++];
      if (!first || candidate.end > first.end) {
        if (candidate.id !== first?.id) second = first;
        first = candidate;
      } else if (candidate.id !== first.id && (!second || candidate.end > second.end)) {
        second = candidate;
      }
    }
    const other = first?.id === span.id ? second : first;
    if (other && other.end > span.start)
      yield new TimeOverlap(span.id, other, {
        start: Math.max(span.start, other.start),
        end: Math.min(span.end, other.end),
      });
  }
}

export function assertTimeOccupancy(before: State, after: State) {
  const overlap = newTimeOverlaps(timeOccupancy(before), timeOccupancy(after)).next().value;
  if (overlap) throw overlap;
}
