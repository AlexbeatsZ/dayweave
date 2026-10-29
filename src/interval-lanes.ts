export function intervalLanes<Value extends { start: number; end: number }>(
  items: readonly Value[],
  compareSameStart: (left: Value, right: Value) => number,
) {
  const positions = new Map<Value, { lane: number; lanes: number }>();
  let cluster: { item: Value; lane: number }[] = [];
  let ends: number[] = [];
  function finish() {
    for (const { item, lane } of cluster) positions.set(item, { lane, lanes: ends.length });
    cluster = [];
    ends = [];
  }
  for (const item of items
    .slice()
    .sort((left, right) => left.start - right.start || compareSameStart(left, right))) {
    if (ends.length && ends.every((end) => end <= item.start)) finish();
    const available = ends.findIndex((end) => end <= item.start);
    const lane = available < 0 ? ends.length : available;
    ends[lane] = item.end;
    cluster.push({ item, lane });
  }
  finish();
  return positions;
}
