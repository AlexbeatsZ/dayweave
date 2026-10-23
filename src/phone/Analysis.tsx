import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  clipped,
  dayRange,
  dayKey,
  duration,
  formatDuration,
  formatPoints,
  formatTime,
  natureLabels,
  recordPoints,
  recordsIn,
  shiftDay,
  stats,
  type State,
} from '../timelog/domain';
import { zoneClock } from '../timezone';

export function PhoneAnalysis({
  state,
  date,
  setDate,
  onTimeline,
}: {
  state: State;
  date: string;
  setDate: (date: string) => void;
  onTimeline: (date: string) => void;
}) {
  const [days, setDays] = useState(1);
  const range = { start: dayRange(shiftDay(date, 1 - days)).start, end: dayRange(date).end };
  const total = stats(state, range);
  const records = recordsIn(state, range);
  const breakdown = state.activities
    .map((activity) => {
      const rows = records.filter((row) => row.activityId === activity.id);
      return {
        ...activity,
        ms: rows.reduce((sum, row) => sum + duration(clipped(row.spans, range)), 0),
        points: rows.reduce((sum, row) => sum + recordPoints(row, range), 0),
        rows,
      };
    })
    .filter((item) => item.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const sum = breakdown.reduce((sum, activity) => sum + activity.ms, 0);
  let position = 0;
  const gradient = breakdown
    .map((item) => {
      const start = position;
      position += (item.ms / sum) * 100;
      return `${item.color} ${start}% ${position}%`;
    })
    .join(', ');
  const natureTotals = { positive: 0, neutral: 0, negative: 0 };
  for (const record of records) {
    natureTotals[record.nature] += duration(clipped(record.spans, range));
  }
  const positive = natureTotals.positive;
  const heat = useMemo(() => {
    const day = dayRange(date),
      rows = recordsIn(state, day);
    const cells: { activity?: string; color?: string; ms: number }[] = Array.from(
      { length: 288 },
      () => ({ ms: 0 }),
    );
    for (let at = day.start; at < day.end; at += 300000) {
      const [hour, minute] = zoneClock(at).split(':').map(Number);
      const cell = cells[hour * 12 + Math.floor(minute / 5)];
      for (const record of rows) {
        const ms = duration(
          clipped(record.spans, { start: at, end: Math.min(at + 300000, day.end) }),
        );
        if (ms > cell.ms) {
          const activity = state.activities.find((item) => item.id === record.activityId)!;
          Object.assign(cell, { activity: activity.name, color: activity.color, ms });
        }
      }
    }
    return cells;
  }, [state, date]);
  return (
    <div className="phone-analysis">
      <div className="phone-segments" aria-label="分析范围">
        {[1, 7, 30].map((value) => (
          <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>
            {value === 1 ? '当日' : value === 7 ? '近七天' : '近一月'}
          </button>
        ))}
      </div>
      <div className="phone-analysis-date">
        <button
          className="icon-button"
          aria-label="上一分析周期"
          onClick={() => setDate(shiftDay(date, -days))}
        >
          <ChevronLeft size={20} />
        </button>
        <label>
          {days === 1
            ? date.replaceAll('-', '/')
            : `${shiftDay(date, 1 - days).slice(5)} — ${date.slice(5)}`}
          <input
            type="date"
            aria-label="分析结束日期"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </label>
        <button
          className="icon-button"
          aria-label="下一分析周期"
          onClick={() => setDate(shiftDay(date, days))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <section className="phone-analysis-card">
        <header>
          <h2>时间投入</h2>
          <span>{formatDuration(total.tracked)}</span>
        </header>
        <div
          className="phone-donut"
          role="img"
          aria-label={`积极活动占比 ${sum ? Math.round((positive / sum) * 100) : 0}%`}
          style={{ background: sum ? `conic-gradient(${gradient})` : 'var(--line)' }}
        >
          <div>
            <span>积极占比</span>
            <strong>
              {sum ? Math.round((positive / sum) * 100) : 0}
              <small>%</small>
            </strong>
          </div>
        </div>
        <div className="phone-natures">
          {(['positive', 'neutral', 'negative'] as const).map((nature) => {
            const ms = natureTotals[nature];
            return (
              <div key={nature}>
                <span>{natureLabels[nature]}</span>
                <strong>{formatDuration(ms)}</strong>
                <small>{sum ? Math.round((ms / sum) * 100) : 0}%</small>
              </div>
            );
          })}
        </div>
        {breakdown.map((activity) => (
          <div className="phone-activity-stat" key={activity.id}>
            <i style={{ background: activity.color }} />
            <div>
              <p>
                <strong>{activity.name}</strong>
                <span>{formatDuration(activity.ms)}</span>
              </p>
              <div className="phone-stat-track">
                <span
                  style={{ width: `${(activity.ms / sum) * 100}%`, background: activity.color }}
                />
              </div>
            </div>
          </div>
        ))}
        {!breakdown.length && <p className="phone-analysis-empty">这个时段还没有记录</p>}
      </section>
      {days === 1 ? (
        <section className="phone-analysis-card">
          <header>
            <h2>一天的时间分布</h2>
            <span>每格 5 分钟</span>
          </header>
          <div className="phone-heatmap" role="img" aria-label="24小时活动分布">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour}>
                <time>{String(hour).padStart(2, '0')}</time>
                {heat.slice(hour * 12, hour * 12 + 12).map((cell, index) => (
                  <span
                    key={index}
                    title={`${hour}:${String(index * 5).padStart(2, '0')} ${cell.activity || '空闲'}`}
                    style={{ '--cell-color': cell.color || 'var(--input)' } as CSSProperties}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="phone-analysis-card">
          <header>
            <h2>每日投入</h2>
          </header>
          <div className="phone-daily-bars">
            {Array.from({ length: days }, (_, index) => {
              const value = shiftDay(date, index + 1 - days),
                ms = stats(state, dayRange(value)).tracked;
              return (
                <button
                  key={value}
                  title={`${value} ${formatDuration(ms)}`}
                  onClick={() => onTimeline(value)}
                >
                  <span style={{ height: `${Math.min(100, (ms / 86400000) * 100)}%` }} />
                  <small>{value.slice(-2)}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="phone-analysis-card">
        <header>
          <h2>活动汇总</h2>
          <span>
            {total.count} 条 · {formatPoints(total.points)} 分
          </span>
        </header>
        {breakdown.map((activity) => (
          <details className="phone-activity-summary" key={activity.id}>
            <summary>
              <i style={{ background: activity.color }} />
              <strong>{activity.name}</strong>
              <small>{activity.rows.length} 次</small>
              <span>{formatDuration(activity.ms)}</span>
            </summary>
            {activity.rows.map((record) => (
              <button
                key={record.id}
                onClick={() => onTimeline(dayKey(Math.max(record.spans[0].start, range.start)))}
              >
                <span>
                  {formatTime(record.spans[0].start)}—{formatTime(record.spans.at(-1)!.end)} ·{' '}
                  {formatDuration(duration(clipped(record.spans, range)))}
                </span>
                {record.note && <p>{record.note}</p>}
              </button>
            ))}
          </details>
        ))}
      </section>
      <p className="footnote">总时长合并重叠区间；活动占比和积分按各条记录累计。</p>
    </div>
  );
}
