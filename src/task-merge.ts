type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(value: T): T => structuredClone(value);
const safeKey = (key: string) => {
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('任务字段无效');
};

/** Three-way field merge. Caller decides whether an actual conflict rejects or accepts this operation. */
export function mergeTaskEntity(
  before: Row | undefined,
  after: Row,
  current: Row,
  conflict: (path: string) => void = () => {},
): Row {
  const merge = (base: Row, incoming: Row, existing: Row, path = ''): Row => {
    const result = clone(existing);
    for (const key of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
      safeKey(key);
      const b = base[key],
        a = incoming[key],
        r = existing[key];
      if (same(a, b) || same(a, r)) continue;
      const field = path ? `${path}.${key}` : key;
      if (key === 'updatedAt') {
        result[key] =
          [a, r]
            .filter((value) => typeof value === 'string')
            .sort()
            .at(-1) ?? a;
      } else if (key === 'history' && Array.isArray(a)) {
        result[key] = [
          ...new Map([...(r ?? []), ...a].map((event: Row) => [event.id, event])).values(),
        ].sort((left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id));
      } else if (key === 'dates') {
        result[key] = merge(b ?? {}, a ?? {}, r ?? {}, field);
      } else if (key === 'subtasks') {
        const oldRows = new Map<string, Row>((b ?? []).map((row: Row) => [row.id, row]));
        const incomingRows = new Map<string, Row>((a ?? []).map((row: Row) => [row.id, row]));
        const rows = new Map<string, Row>((r ?? []).map((row: Row) => [row.id, row]));
        for (const id of new Set([...oldRows.keys(), ...incomingRows.keys()])) {
          const old = oldRows.get(id),
            next = incomingRows.get(id),
            saved = rows.get(id);
          if (same(old, next)) continue;
          if (!next) {
            if (saved)
              rows.set(id, { ...saved, deletedAt: after.updatedAt ?? new Date().toISOString() });
          } else if (!saved) {
            if (!old) rows.set(id, clone(next));
          } else rows.set(id, merge(old ?? {}, next, saved, `${field}.${id}`));
        }
        result[key] = [...rows.values()];
      } else if (key === 'deletedAt') {
        // A null based on an already deleted row is an explicit restoration. Stale edits lose.
        if (r && !b && !a) continue;
        if (a || (b && a === null)) result[key] = a;
      } else {
        if (!same(r, b)) conflict(field);
        if (Object.hasOwn(incoming, key)) result[key] = clone(a);
        else delete result[key];
      }
    }
    return result;
  };
  return merge(before ?? {}, after, current);
}
