import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { datesSchema, dayPlanGroups, shiftDate, type Task } from '../model';
import { useStore } from '../store';

/** One date map draft, shared by new/edit on every screen size. */
export function TaskDatesEditor({
  dates,
  onChange,
  today,
  onCreateGroup,
}: {
  dates: Task['dates'];
  onChange: (dates: Task['dates']) => void;
  today: string;
  onCreateGroup: (day: string) => void;
}) {
  const { data } = useStore();
  const initial =
    Object.keys(dates)
      .filter((day) => day !== '∞')
      .sort()[0] ?? today;
  const [from, setFrom] = useState(initial),
    [to, setTo] = useState(initial);
  const [error, setError] = useState('');
  const add = (start: string, end = start) => {
    try {
      if (!start || !end || end < start) throw new Error('请选择有效的起止日期');
      const next = { ...dates };
      let day = start,
        count = 0;
      while (day <= end) {
        if (++count > 366) throw new Error('一次最多添加 366 天');
        if (!Object.hasOwn(next, day)) next[day] = null;
        day = shiftDate(day, 1);
      }
      onChange(datesSchema.parse(next));
      setError('');
    } catch (error) {
      setError(String(error instanceof Error ? error.message : error));
    }
  };
  return (
    <fieldset className="task-dates-editor">
      <legend>安排日期</legend>
      <div className="date-chips">
        <button type="button" aria-pressed={Object.hasOwn(dates, today)} onClick={() => add(today)}>
          今天
        </button>
        <button
          type="button"
          aria-pressed={Object.hasOwn(dates, shiftDate(today, 1))}
          onClick={() => add(shiftDate(today, 1))}
        >
          明天
        </button>
        <button
          type="button"
          aria-label="∞ 总视图保留"
          title="总视图持续保留"
          aria-pressed={'∞' in dates}
          onClick={() => {
            const next = { ...dates };
            if ('∞' in next) delete next['∞'];
            else next['∞'] = null;
            onChange(next);
          }}
        >
          ∞
        </button>
        <button
          type="button"
          aria-pressed={!Object.keys(dates).length}
          onClick={() => onChange({})}
        >
          无日期
        </button>
      </div>
      <div className="task-date-range">
        <label>
          开始日期
          <input
            type="date"
            aria-label="计划日期"
            value={from}
            min="2000-01-01"
            max="2200-12-31"
            onChange={(event) => {
              setFrom(event.target.value);
              if (to < event.target.value) setTo(event.target.value);
            }}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            aria-label="结束日期"
            value={to}
            min={from || '2000-01-01'}
            max="2200-12-31"
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button type="button" className="button" onClick={() => add(from, to)}>
          添加日期
        </button>
      </div>
      {Object.keys(dates)
        .sort()
        .map((day) => (
          <div className="task-date-line" key={day}>
            <span>{day === '∞' ? '∞' : day}</span>
            {day !== '∞' && (
              <>
                <select
                  aria-label={`${day} 时段`}
                  value={dates[day] ?? ''}
                  onChange={(event) => onChange({ ...dates, [day]: event.target.value || null })}
                >
                  <option value="">不定时段</option>
                  {dayPlanGroups(data, day).map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`新建 ${day} 时段`}
                  onClick={() => onCreateGroup(day)}
                >
                  <Plus size={16} />
                </button>
              </>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={`移除日期 ${day}`}
              onClick={() => {
                const next = { ...dates };
                delete next[day];
                onChange(next);
              }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
