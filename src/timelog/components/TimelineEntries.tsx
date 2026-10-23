import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { dayRange, formatDuration, formatTime, type Span } from '../domain';
import type { TimelineEntry } from '../timeline';

/** A single rendering path for desktop and phone; day is explicit for every action. */
export function TimelineEntries({
  entries,
  day,
  renderRecord,
  addRecord,
  showTimer,
  timerName,
}: {
  entries: TimelineEntry[];
  day: string;
  renderRecord: (row: Extract<TimelineEntry, { kind: 'record' }>) => ReactNode;
  addRecord: (range: Span) => void;
  showTimer: () => void;
  timerName: string;
}) {
  const endText = (at: number) => (at === dayRange(day).end ? '24:00' : formatTime(at));
  return (
    <>
      {entries.map((row) => (
        <div key={row.key} className={`timeline-entry ${row.kind}`}>
          <div className="time-rail">
            <time>{endText(row.end)}</time>
            <span />
            <time>{formatTime(row.start)}</time>
          </div>
          <div className="entry-body">
            {row.kind === 'record' ? (
              renderRecord(row)
            ) : row.kind === 'gap' ? (
              <button
                className="gap-card"
                aria-label={`添加空闲记录 ${formatTime(row.start)}-${endText(row.end)}`}
                onClick={() => addRecord({ start: row.start, end: row.end })}
              >
                <Plus size={17} />
                <span>
                  空闲 <strong>{formatDuration(row.end - row.start)}</strong>
                </span>
                <span className="gap-hint">点击添加记录</span>
              </button>
            ) : (
              <button className="timer-card" onClick={showTimer}>
                <i className="running-dot" />
                正在计时 · {timerName}
                <span>{formatDuration(row.end - row.start)}</span>
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
