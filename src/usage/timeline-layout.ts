import type { Span } from '../timelog/domain.js';
import type { UsageEvent } from './domain.js';

export function mergeUsageEvents(events: readonly UsageEvent[]) {
  const streams = new Map<string, UsageEvent[]>();
  for (const event of events
    .filter((event) => !event.deleted)
    .slice()
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))) {
    const key = `${event.deviceId}:${event.kind}`;
    const stream = streams.get(key) ?? [];
    const previous = stream.at(-1);
    if (
      previous &&
      event.kind !== 'unlock' &&
      previous.source === event.source &&
      previous.app === event.app &&
      previous.title === event.title &&
      previous.url === event.url &&
      previous.category === event.category &&
      event.start - previous.end <= 1000
    ) {
      previous.end = Math.max(previous.end, event.end);
    } else stream.push({ ...event });
    streams.set(key, stream);
  }
  return [...streams.values()].flat();
}

export function createTimelineAxis(spans: readonly Span[], range: Span) {
  const visible = spans
    .filter(
      (span) =>
        span.start < range.end &&
        (span.end > range.start || (span.start === span.end && span.start >= range.start)),
    )
    .map((span) => ({
      start: Math.max(span.start, range.start),
      end: Math.min(span.end, range.end),
    }))
    .filter((span) => span.end >= span.start);
  const boundaries = new Set<number>();
  const starts = new Map<number, number>();
  const endings = new Map<number, number[]>();
  const instants = new Set<number>();
  if (visible.length) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  for (const span of visible) {
    boundaries.add(span.start);
    boundaries.add(span.end);
    if (span.start === span.end) instants.add(span.start);
    else {
      starts.set(span.start, (starts.get(span.start) ?? 0) + 1);
      const ending = endings.get(span.end) ?? [];
      ending.push(span.start);
      endings.set(span.end, ending);
    }
  }
  const times = [...boundaries].sort((left, right) => left - right);
  const positions = new Map<number, number>();
  let offset = 0;
  let active = 0;
  for (const [index, time] of times.entries()) {
    if (index)
      offset += instants.has(time) || instants.has(times[index - 1]) ? 24 : active ? 4 : 28;
    for (const start of endings.get(time) ?? [])
      offset = Math.max(offset, positions.get(start)! + 76);
    positions.set(time, offset);
    active += (starts.get(time) ?? 0) - (endings.get(time)?.length ?? 0);
  }
  const height = visible.length ? offset + 24 : 0;
  function top(time: number) {
    if (!times.length) return 0;
    const clipped = Math.max(range.start, Math.min(range.end, time));
    const exact = positions.get(clipped);
    if (exact !== undefined) return offset - exact + 12;
    let lower = 0;
    let upper = times.length - 1;
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (times[middle] < clipped) lower = middle;
      else upper = middle;
    }
    const fraction = (clipped - times[lower]) / (times[upper] - times[lower]);
    return (
      offset -
      (positions.get(times[lower])! +
        fraction * (positions.get(times[upper])! - positions.get(times[lower])!)) +
      12
    );
  }
  const ticks: { time: number; top: number }[] = [];
  for (const time of times.slice().reverse()) {
    const position = top(time);
    if (!ticks.length || position - ticks.at(-1)!.top >= 24) ticks.push({ time, top: position });
  }
  return { height, top, ticks };
}

export function timelineLanes<Value extends Span & { id: string }>(blocks: readonly Value[]) {
  const positions = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let ends: number[] = [];
  function finish() {
    for (const block of cluster) positions.set(block.id, { lane: block.lane, lanes: ends.length });
    cluster = [];
    ends = [];
  }
  for (const block of blocks
    .slice()
    .sort(
      (left, right) =>
        left.start - right.start || right.end - left.end || left.id.localeCompare(right.id),
    )) {
    if (ends.length && ends.every((end) => end <= block.start)) finish();
    const available = ends.findIndex((end) => end <= block.start);
    const lane = available < 0 ? ends.length : available;
    ends[lane] = block.end;
    cluster.push({ id: block.id, lane });
  }
  finish();
  return positions;
}
