import type { Span } from '../timelog/domain.js';
import type { UsageEvent } from './domain.js';

/** Short pauses between samples of the same app (window switches, sampling gaps) stay one card. */
export const MERGE_GAP = 2 * 60000;
export type MergedUsageEvent = UsageEvent & { titles: string[] };
const site = (url?: string) => {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return url ?? '';
  }
};
/**
 * Display-only coalescing per device and layer. Apps merge by application regardless of window
 * title, websites by host, media by title; every distinct title is kept for the details view.
 */
export function mergeUsageEvents(events: readonly UsageEvent[]): MergedUsageEvent[] {
  const streams = new Map<string, MergedUsageEvent[]>();
  const identity = (event: UsageEvent) =>
    event.kind === 'app'
      ? event.app
      : event.kind === 'web'
        ? `${event.app}|${site(event.url)}`
        : `${event.app}|${event.title}|${event.url}`;
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
      previous.category === event.category &&
      identity(previous) === identity(event) &&
      event.start - previous.end <= (event.kind === 'media' ? 1000 : MERGE_GAP)
    ) {
      previous.end = Math.max(previous.end, event.end);
      if (event.title && !previous.titles.includes(event.title)) previous.titles.push(event.title);
    } else stream.push({ ...event, titles: event.title ? [event.title] : [] });
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
