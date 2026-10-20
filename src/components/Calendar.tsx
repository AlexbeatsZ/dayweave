import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { civilDateKey, dateKey, fromDateKey, shiftDate, type Task } from '../model';

export function Calendar({
  tasks,
  selectedDate,
  onDate,
  onSelect,
  onDrop,
}: {
  tasks: Task[];
  selectedDate: string;
  onDate: (date: string) => void;
  onSelect: (id: string) => void;
  onDrop: (id: string, date: string) => void;
}) {
  const [month, setMonth] = useState(() => fromDateKey(dateKey().slice(0, 7) + '-01'));
  const first = civilDateKey(month);
  const mondayOffset = (month.getDay() + 6) % 7;
  const start = shiftDate(first, -mondayOffset);
  const days = Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
  const moveMonth = (offset: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  return (
    <section className="calendar-view" aria-label="月历">
      <div className="calendar-toolbar">
        <h2>{month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}</h2>
        <div>
          <button
            className="button small"
            onClick={() => {
              const today = fromDateKey(dateKey());
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1, 12));
              onDate(dateKey());
            }}
          >
            今天
          </button>
          <button className="icon-button" aria-label="上个月" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-button" aria-label="下个月" onClick={() => moveMonth(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-weekdays">
        {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
          <span key={d}>周{d}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const dayTasks = tasks.filter((t) => t.due === day && !t.deletedAt);
          const out = fromDateKey(day).getMonth() !== month.getMonth();
          return (
            <div
              className={`calendar-day ${out ? 'outside' : ''} ${day === selectedDate ? 'selected-day' : ''}`}
              key={day}
              data-date={day}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/clearlist-task')) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('application/clearlist-task');
                if (id) onDrop(id, day);
              }}
            >
              <button
                className={`day-number ${day === dateKey() ? 'today-number' : ''}`}
                aria-label={`选择日期 ${day}`}
                onClick={() => onDate(day)}
              >
                {Number(day.slice(-2))}
              </button>
              <div className="calendar-events">
                {dayTasks.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    className={`calendar-event priority-${task.priority} ${task.completedAt ? 'event-done' : ''}`}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('application/clearlist-task', task.id)
                    }
                    onClick={() => onSelect(task.id)}
                    title={task.title}
                  >
                    <i />
                    {task.title}
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <button className="calendar-more" onClick={() => onDate(day)}>
                    还有 {dayTasks.length - 3} 件
                  </button>
                )}
              </div>
              <button
                className="day-add"
                aria-label={`在 ${day} 添加任务`}
                onClick={() => onDate(day)}
              >
                <Plus size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="calendar-hint">点击日期安排任务 · 拖动任务调整日期</p>
    </section>
  );
}
