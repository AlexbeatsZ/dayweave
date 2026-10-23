import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dateKey, shiftDate } from '../model';
import { weekday } from '../timezone';

export const calendarWeek = (date: string) => {
  const first = shiftDate(date, 1 - weekday(date));
  return Array.from({ length: 7 }, (_, index) => shiftDate(first, index));
};

/** One calendar navigation style for daily/weekly plans, records and daily statistics. */
export function DateNavigator({
  date,
  onDate,
  label = '查看日期',
  week = false,
  taskDates = [],
}: {
  date: string;
  onDate: (value: string) => void;
  label?: string;
  week?: boolean;
  taskDates?: string[];
}) {
  const days = calendarWeek(date),
    today = dateKey();
  return (
    <section className="phone-week date-navigator" aria-label={week ? '自然周日期' : '日期导航'}>
      <div className="phone-week-heading">
        <button
          className="icon-button"
          aria-label="前一周"
          onClick={() => onDate(shiftDate(date, -7))}
        >
          <ChevronLeft size={18} />
        </button>
        <label>
          {week
            ? `${days[0].slice(5)} — ${days[6].slice(5)}`
            : `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`}
          <input
            type="date"
            aria-label={label}
            value={date}
            onChange={(event) => {
              if (event.target.value) onDate(event.target.value);
            }}
          />
        </label>
        <button className="text-button" onClick={() => onDate(today)}>
          {week ? '本周' : '今天'}
        </button>
        <button
          className="icon-button"
          aria-label="后一周"
          onClick={() => onDate(shiftDate(date, 7))}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="phone-week-days">
        {days.map((value, index) => (
          <button
            key={value}
            aria-label={`查看 ${value} 的任务`}
            aria-pressed={week || date === value}
            aria-current={today === value ? 'date' : undefined}
            onClick={() => onDate(value)}
          >
            <span>{['一', '二', '三', '四', '五', '六', '日'][index]}</span>
            <strong>{Number(value.slice(-2))}</strong>
            <i className={taskDates.includes(value) ? 'has-tasks' : ''} />
          </button>
        ))}
      </div>
    </section>
  );
}
