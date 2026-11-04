/**
 * Helpers available to goal scripts as `ctx.util`, plus the checks applied to what a script
 * module exports and returns. Runs inside the worker; also imported by tests.
 */
import { businessDateKey, wallTime, zoneClock } from '../timezone.js';
import type { ScriptOutcome, ScriptParam } from './domain.js';

type Span = { start: number; end: number };
type Spans = Span | readonly Span[];
const list = (value: Spans): Span[] =>
  (Array.isArray(value) ? value : [value as Span]).filter((span) => span.end > span.start);

/** Sorted, non-overlapping spans; touching spans and gaps up to `gapMinutes` are merged. */
export function union(spans: Spans, gapMinutes = 0): Span[] {
  const result: Span[] = [];
  for (const span of [...list(spans)].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && span.start <= last.end + gapMinutes * 60000)
      last.end = Math.max(last.end, span.end);
    else result.push({ start: span.start, end: span.end });
  }
  return result;
}
/** Parts of `a` that also lie in `b`. */
export function intersect(a: Spans, b: Spans): Span[] {
  const left = union(a),
    right = union(b),
    result: Span[] = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    const start = Math.max(left[i].start, right[j].start),
      end = Math.min(left[i].end, right[j].end);
    if (end > start) result.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return result;
}
/** Parts of `a` outside `b`. */
export function subtract(a: Spans, b: Spans): Span[] {
  const cut = union(b);
  return union(a).flatMap((span) => {
    const pieces: Span[] = [];
    let start = span.start;
    for (const hole of cut) {
      if (hole.end <= start || hole.start >= span.end) continue;
      if (hole.start > start) pieces.push({ start, end: hole.start });
      start = Math.max(start, hole.end);
    }
    if (start < span.end) pieces.push({ start, end: span.end });
    return pieces;
  });
}
export const clip = (spans: Spans, range: Span) => intersect(spans, range);
/** Minutes covered (overlaps counted once); a number is taken as milliseconds. */
export const minutes = (value: number | Spans) =>
  (typeof value === 'number'
    ? value
    : union(value).reduce((sum, span) => sum + span.end - span.start, 0)) / 60000;
export const overlaps = (a: Spans, b: Spans) => intersect(a, b).length > 0;
/** Separate sessions: spans whose gaps are at most `gapMinutes` count as one. */
export const sessions = (spans: Spans, gapMinutes = 2) => union(spans, gapMinutes);
/** "HH:mm" of an instant in the schedule time zone. */
export const clock = (at: number) => zoneClock(at);
/** The business date (respecting the day-start setting) an instant belongs to. */
export const date = (at: number) => businessDateKey(at);
/** The instant of a wall-clock time ("HH:mm") on a calendar date in the schedule zone. */
export const at = (day: string, time: string) => wallTime(day, time);
/** Case-insensitive: does `text` contain any of `patterns`? */
export const matches = (text: string, patterns: readonly string[]) =>
  patterns.some((pattern) => text.toLowerCase().includes(pattern.toLowerCase()));
export const scriptUtil = {
  union,
  intersect,
  subtract,
  clip,
  minutes,
  overlaps,
  sessions,
  clock,
  date,
  at,
  matches,
};

export type ParamSpec = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'list' | 'boolean';
  default: ScriptParam;
  hint: string;
};
export type ScriptMeta = { name: string; description: string; params: ParamSpec[] };
const PARAM_TYPES = ['text', 'number', 'list', 'boolean'] as const;
const fallback = { text: '', number: 0, list: [] as string[], boolean: false };
/** Reads the optional `name`, `description` and `params` exports of a script module. */
export function scriptMeta(module: Record<string, unknown>): ScriptMeta {
  if (typeof module.default !== 'function')
    throw new Error('脚本需要 export default async function judge(ctx) { … }');
  const raw = module.params ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('params 须是对象，例如 { limit: { type: "number", default: 20 } }');
  const params = Object.entries(raw as Record<string, Record<string, unknown>>).map(
    ([key, spec]): ParamSpec => {
      if (!/^[A-Za-z_$][\w$]{0,39}$/.test(key)) throw new Error(`参数名 ${key} 无效`);
      const type = (spec?.type ?? 'text') as ParamSpec['type'];
      if (!PARAM_TYPES.includes(type))
        throw new Error(`参数 ${key} 的 type 须为 ${PARAM_TYPES.join('/')}`);
      const value = spec.default ?? fallback[type];
      return {
        key,
        label: String(spec.label ?? key).slice(0, 60),
        type,
        default: normalizeParam(type, value),
        hint: String(spec.hint ?? '').slice(0, 200),
      };
    },
  );
  if (params.length > 50) throw new Error('参数最多 50 个');
  return {
    name: String(module.name ?? '').slice(0, 60),
    description: String(module.description ?? '').slice(0, 500),
    params,
  };
}
export function normalizeParam(type: ParamSpec['type'], value: unknown): ScriptParam {
  if (type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (type === 'boolean') return value === true || value === 'true';
  if (type === 'list')
    return (Array.isArray(value) ? value : String(value ?? '').split(/[,，、\n]/))
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 200);
  return String(value ?? '');
}
/** Goal values for every declared parameter, falling back to the script defaults. */
export function resolveParams(specs: ParamSpec[], values: Record<string, ScriptParam>) {
  return Object.fromEntries(
    specs.map((spec) => [
      spec.key,
      values[spec.key] === undefined ? spec.default : normalizeParam(spec.type, values[spec.key]),
    ]),
  );
}
/** `true`/`false`, `null` (undecided) or `{ met, progress?, note? }`. */
export function scriptOutcome(value: unknown): ScriptOutcome {
  if (typeof value === 'boolean' || value === null)
    return { met: value, progress: value ? 1 : 0, note: '' };
  if (!value || typeof value !== 'object')
    throw new Error('judge 须返回 true/false/null 或 { met, progress, note }');
  const result = value as Record<string, unknown>;
  if (result.met !== true && result.met !== false && result.met !== null)
    throw new Error('返回值的 met 须为 true、false 或 null');
  const progress =
    typeof result.progress === 'number' && Number.isFinite(result.progress)
      ? Math.min(1, Math.max(0, result.progress))
      : result.met
        ? 1
        : 0;
  return { met: result.met, progress, note: String(result.note ?? '').slice(0, 200) };
}
