import { clipped, dayRange, formatDuration, recordsIn, unionDuration, type State } from '../domain';

const MIN_SHARE = 0.04; // Slivers below this fold into "其他" so every slice stays legible.
const SIZE = 96,
  RADIUS = 44,
  INNER = 28;

/** Where one day went, from the user's own saved records only (automatic observations excluded). */
export function DayPie({ state, day }: { state: State; day: string }) {
  const range = dayRange(day);
  const records = recordsIn(state, range);
  const rows = state.activities
    .map((activity) => ({
      id: activity.id,
      name: activity.name,
      color: activity.color,
      ms: unionDuration(
        records
          .filter((record) => record.activityId === activity.id)
          .flatMap((record) => clipped(record.spans, range)),
      ),
    }))
    .filter((row) => row.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const total = rows.reduce((sum, row) => sum + row.ms, 0);
  if (!total) return null;
  const main = rows.filter((row) => row.ms / total >= MIN_SHARE);
  const rest = rows.filter((row) => row.ms / total < MIN_SHARE);
  const slices = rest.length
    ? [
        ...main,
        {
          id: 'other',
          name: '其他',
          color: 'var(--muted)',
          ms: rest.reduce((s, r) => s + r.ms, 0),
        },
      ]
    : main;
  let angle = -Math.PI / 2;
  const point = (r: number, a: number) =>
    `${SIZE / 2 + r * Math.cos(a)} ${SIZE / 2 + r * Math.sin(a)}`;
  return (
    <figure className="day-pie" aria-label={`${day} 时间分布`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img">
        {slices.map((slice) => {
          const sweep = (slice.ms / total) * Math.PI * 2;
          const start = angle;
          angle += sweep;
          const share = `${slice.name} ${formatDuration(slice.ms)} · ${Math.round((slice.ms / total) * 100)}%`;
          if (slices.length === 1)
            return (
              <circle
                key={slice.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={(RADIUS + INNER) / 2}
                fill="none"
                stroke={slice.color}
                strokeWidth={RADIUS - INNER}
              >
                <title>{share}</title>
              </circle>
            );
          const large = sweep > Math.PI ? 1 : 0;
          return (
            <path
              key={slice.id}
              d={`M ${point(RADIUS, start)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${point(RADIUS, angle)} L ${point(INNER, angle)} A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, start)} Z`}
              fill={slice.color}
              stroke="var(--card)"
              strokeWidth={2}
            >
              <title>{share}</title>
            </path>
          );
        })}
        <text x={SIZE / 2} y={SIZE / 2 + 4} textAnchor="middle" className="day-pie-total">
          {Math.round((total / 3600000) * 10) / 10}h
        </text>
      </svg>
      <figcaption>
        <ul>
          {slices.map((slice) => (
            <li key={slice.id}>
              <i style={{ background: slice.color }} />
              <span>{slice.name}</span>
              <span className="day-pie-value">
                {formatDuration(slice.ms)} · {Math.round((slice.ms / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
