/**
 * Drag ordering shared by tasks, activities and goals. Moves `source` to `target`'s place
 * among the `visible` ids and renumbers every row 1..n in `sorted` order. Rows outside
 * `visible` keep their slots, so sorting inside one group never reshuffles another group.
 * Returns null when nothing moves.
 */
export function moveOrder(
  sorted: string[],
  visible: string[],
  source: string,
  target: string,
): Map<string, number> | null {
  const known = new Set(sorted);
  const ids = visible.filter((id) => known.has(id));
  const from = ids.indexOf(source),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  ids.splice(from, 1);
  ids.splice(to, 0, source);
  const selected = new Set(ids);
  let position = 0;
  return new Map(sorted.map((id, index) => [selected.has(id) ? ids[position++] : id, index + 1]));
}

/** Rows without an explicit order (new, or written by older clients) keep their place after ordered ones. */
export function byOrder<T extends { order?: number }>(left: T, right: T): number {
  const a = left.order ?? Infinity,
    b = right.order ?? Infinity;
  return a === b ? 0 : a < b ? -1 : 1;
}
