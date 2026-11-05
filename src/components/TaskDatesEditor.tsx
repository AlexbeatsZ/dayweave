import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { civilDateKey, dayPlanGroups, fromDateKey, shiftDate, type Task } from '../model';
import { useStore } from '../store';
import { useSwipeTabs } from '../phone/Navigation';
import { Modal } from './Modal';

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
  const [calendar, setCalendar] = useState(false);
  const [month, setMonth] = useState(initial.slice(0, 7));
  const monthDate = fromDateKey(`${month}-01`);
  const moveMonth = (offset: number) =>
    civilDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth() + offset, 1, 12)).slice(
      0,
      7,
    );
  const monthTabs = [-1, 0, 1]
    .map((offset) => ({ id: moveMonth(offset), label: '' }))
    .filter(({ id }) => id >= '2000-01' && id <= '2200-12');
  const swipe = useSwipeTabs(monthTabs, month, setMonth, true);
  const first = shiftDate(`${month}-01`, -((monthDate.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => shiftDate(first, index));
  const toggle = (day: string) => {
    const next = { ...dates };
    if (Object.hasOwn(next, day)) delete next[day];
    else next[day] = null;
    onChange(next);
  };
  return (
    <fieldset className="task-dates-editor">
      <legend>安排日期</legend>
      <div className="date-chips task-date-shortcuts">
        <button
          type="button"
          aria-pressed={Object.hasOwn(dates, today)}
          onClick={() => toggle(today)}
        >
          今天
        </button>
        <button
          type="button"
          aria-pressed={Object.hasOwn(dates, shiftDate(today, 1))}
          onClick={() => toggle(shiftDate(today, 1))}
        >
          明天
        </button>
        <button type="button" aria-pressed={'∞' in dates} onClick={() => toggle('∞')}>
          待定
        </button>
        <button
          type="button"
          aria-pressed={!Object.keys(dates).length}
          onClick={() => onChange({})}
        >
          无日期
        </button>
        <button type="button" aria-expanded={calendar} onClick={() => setCalendar(true)}>
          更多
        </button>
      </div>
      {Object.keys(dates)
        .sort()
        .map((day) => (
          <div className="task-date-line" key={day}>
            <span>{day === '∞' ? '待定' : day}</span>
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
      {calendar && (
        <Modal
          title="选择安排日期"
          close={() => setCalendar(false)}
          className="task-date-calendar"
          hideHeader
        >
          <section aria-label="安排日期月历" {...swipe}>
            <header className="task-calendar-heading">
              <div className="task-calendar-month">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="上个月"
                  disabled={month === '2000-01'}
                  onClick={() => setMonth(moveMonth(-1))}
                >
                  <ChevronLeft size={18} />
                </button>
                <strong aria-live="polite">
                  {month.slice(0, 4)}年{Number(month.slice(5))}月
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="下个月"
                  disabled={month === '2200-12'}
                  onClick={() => setMonth(moveMonth(1))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <button
                type="button"
                className="task-calendar-circle"
                aria-label="待定"
                aria-pressed={'∞' in dates}
                onClick={() => toggle('∞')}
              >
                ∞
              </button>
            </header>
            <div className="task-calendar-weekdays" aria-hidden="true">
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="task-calendar-days">
              {days.map((day) => (
                <button
                  type="button"
                  className={`task-calendar-circle${day.startsWith(month) ? '' : ' outside'}`}
                  key={day}
                  aria-label={`安排 ${day}`}
                  aria-pressed={Object.hasOwn(dates, day)}
                  aria-current={day === today ? 'date' : undefined}
                  disabled={day < '2000-01-01' || day > '2200-12-31'}
                  onClick={() => toggle(day)}
                >
                  {Number(day.slice(-2))}
                </button>
              ))}
            </div>
          </section>
          <button
            type="button"
            className="button primary task-calendar-done"
            onClick={() => setCalendar(false)}
          >
            完成
          </button>
        </Modal>
      )}
    </fieldset>
  );
}
