import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Calendar } from './Calendar';
import { EventComposer } from './EventComposer';
import { Modal } from './Modal';
import { TaskCheck } from './TaskCheck';
import { CourseImportDialog, useCourseImport } from './CourseImport';
import { PeriodEditor } from './Timetable';
import { store, useStore } from '../store';
import { taskCompleted, reorderTasks, toggleTask, type Task } from '../model';
import { eventsOnDate, eventDayCount, eventBounds } from '../event-domain';
import { intervalLanes } from '../interval-lanes';
import { type CalendarEvent, eventTypes } from '../event-model';
import { teachingWeek, type CoursePeriod } from '../schedule';
import {
  dayStart,
  zonedDate,
  zoneClock,
  zoneDateKey,
  wallTime,
  shiftDay,
  weekday,
  minuteOf,
} from '../timezone';
import { isMobileApp } from '../files';
import { useFudanSource } from '../useFudanRefresh';
import { useSortDrag } from '../phone/useSortDrag';
import { FloatingAdd, PhoneTabs } from '../phone/Navigation';
import { usePhone } from '../phone/usePhone';
import './Arrangements.css';

function WeekTask({
  task,
  date,
  open,
  move,
}: {
  task: Task;
  date: string;
  open: (id: string) => void;
  move: (source: string, target: string) => void;
}) {
  const drag = useSortDrag(task.id, `week-${date}`, move, taskCompleted(task));
  return (
    <article
      ref={drag.ref}
      className={`week-task ${drag.dragging ? 'sort-source' : ''} ${taskCompleted(task) ? 'event-done' : ''}`}
      data-sort-id={taskCompleted(task) ? undefined : task.id}
      data-sort-group={taskCompleted(task) ? undefined : `week-${date}`}
      onClickCapture={drag.onClickCapture}
    >
      <TaskCheck
        checked={taskCompleted(task)}
        repeating={false}
        label={`完成 ${task.title}`}
        onChange={() => store.update((state) => toggleTask(state, task.id))}
      />
      <button
        type="button"
        className="week-task-title"
        data-sort-handle
        onClick={() => open(task.id)}
      >
        {task.title}
      </button>
      {!!task.priority && <small>{['', '低', '中', '高'][task.priority]}优先级</small>}
    </article>
  );
}

function EventCard({
  event,
  open,
  zone,
}: {
  event: CalendarEvent;
  open: (id: string) => void;
  zone: string;
}) {
  return (
    <button
      className="arrangement-event"
      aria-label={`编辑日程 ${event.title}`}
      style={{ '--event-color': event.color } as CSSProperties}
      onClick={() => open(event.id)}
    >
      <strong>{event.title}</strong>
      {event.allDay ? (
        <span>全天</span>
      ) : (
        event.periods.map(([start, end], index) => (
          <span key={index}>
            {event.timeZone === zone
              ? start
              : zoneClock(wallTime(event.date, start, event.timeZone), zone)}
            –
            {event.timeZone === zone
              ? end
              : zoneClock(
                  wallTime(shiftDay(event.date, event.durationDays - 1), end, event.timeZone),
                  zone,
                )}
          </span>
        ))
      )}
      {event.location && <span>{event.location}</span>}
      <small>{eventTypes[event.type]}</small>
    </button>
  );
}

function EventWeek({
  events,
  days,
  zone,
  open,
  add,
  periods,
  editPeriods,
}: {
  events: CalendarEvent[];
  days: string[];
  zone: string;
  open: (id: string) => void;
  add: (day: string) => void;
  periods: CoursePeriod[];
  editPeriods: () => void;
}) {
  const minute = (at: number) => {
    const local = zonedDate(at, zone);
    return local.hour * 60 + local.minute + local.second / 60 + local.millisecond / 60000;
  };
  const columns = days.map((day) => {
    const begin = dayStart(day, zone),
      finish = dayStart(shiftDay(day, 1), zone);
    const items = eventsOnDate(events, day, zone);
    return {
      day,
      allDay: items.filter((event) => event.allDay),
      timed: items
        .filter((event) => !event.allDay)
        .map((event) => {
          const bounds = eventBounds(event);
          const from = bounds.start < begin ? 0 : minute(bounds.start);
          const until = bounds.end >= finish ? 1440 : minute(bounds.end);
          return { event, ...bounds, from, until: Math.max(from + 1, until) };
        }),
    };
  });
  const timed = columns.flatMap((column) => column.timed);
  const from = Math.min(minuteOf(periods[0].start), ...timed.map((item) => item.from));
  const until = Math.max(minuteOf(periods.at(-1)!.end), ...timed.map((item) => item.until));
  const pixelsPerMinute = 1.35;
  const hasAllDay = columns.some((column) => column.allDay.length);
  return (
    <div
      className="arrangement-week arrangement-event-week timetable-grid-view"
      style={
        {
          '--arrangement-days': days.length,
          '--timetable-height': `${(until - from) * pixelsPerMinute}px`,
        } as CSSProperties
      }
      data-no-swipe
    >
      <section className="arrangement-day arrangement-period-column" aria-label="节次标尺">
        <div className="timetable-corner">节次</div>
        <div className={hasAllDay ? 'arrangement-all-day' : undefined} aria-hidden="true" />
        <div className="timetable-ruler">
          {periods.map((period, index) => (
            <button
              key={index}
              className="timetable-period"
              aria-label={`第 ${index + 1} 节，打开节次设置`}
              style={{
                top: (minuteOf(period.start) - from) * pixelsPerMinute,
                height: (minuteOf(period.end) - minuteOf(period.start)) * pixelsPerMinute,
              }}
              onClick={editPeriods}
            >
              <strong>{index + 1}</strong>
              <span>{period.start}</span>
              <span>{period.end}</span>
            </button>
          ))}
        </div>
        <div aria-hidden="true" />
      </section>
      {columns.map((column, index) => (
        <section
          className="arrangement-day"
          key={column.day}
          aria-label={`${column.day} 日程`}
          style={{ gridColumn: index + 2 }}
        >
          <button className="arrangement-day-heading" onClick={() => add(column.day)}>
            <strong>周{'一二三四五六日'[index]}</strong>
            <span>{column.day.slice(5).replace('-', '/')}</span>
          </button>
          <div className={hasAllDay ? 'arrangement-all-day' : undefined}>
            {column.allDay.map((event) => (
              <EventCard key={event.id} event={event} open={open} zone={zone} />
            ))}
          </div>
          <div
            className="arrangement-time-column"
            style={{ height: (until - from) * pixelsPerMinute }}
          >
            {periods.map((period, index) => (
              <div
                key={index}
                className="arrangement-period-guide"
                style={{
                  top: (minuteOf(period.start) - from) * pixelsPerMinute,
                  height: (minuteOf(period.end) - minuteOf(period.start)) * pixelsPerMinute,
                }}
                aria-hidden="true"
              />
            ))}
            {[...intervalLanes(column.timed, (a, b) => a.end - b.end)].map(
              ([item, { lane, lanes }]) => (
                <div
                  key={item.event.id}
                  className="arrangement-timed-event"
                  style={{
                    top: (item.from - from) * pixelsPerMinute,
                    height: (item.until - item.from) * pixelsPerMinute,
                    left: `calc(${(lane / lanes) * 100}% + 2px)`,
                    width: `calc(${100 / lanes}% - 4px)`,
                  }}
                >
                  <EventCard event={item.event} open={open} zone={zone} />
                </div>
              ),
            )}
          </div>
          <button
            className="arrangement-day-add"
            aria-label={`在 ${column.day} 添加日程`}
            onClick={() => add(column.day)}
          >
            <Plus size={16} />
          </button>
        </section>
      ))}
    </div>
  );
}

export function Arrangements({
  mode,
  onModeChange,
  date,
  onDate,
  onTask,
  onAddTask,
  onOpenDay,
}: {
  mode: 'task' | 'event';
  onModeChange: (mode: 'task' | 'event') => void;
  date: string;
  onDate: (date: string) => void;
  onTask: (id: string) => void;
  onAddTask: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { data } = useStore();
  const phone = usePhone();
  const [taskView, setTaskView] = useState<'month' | 'week'>('month');
  const [eventView, setEventView] = useState<'month' | 'week'>('week');
  const view = mode === 'task' ? taskView : eventView;
  const [editor, setEditor] = useState<{ event?: CalendarEvent; date: string }>();
  const [periods, setPeriods] = useState(false);
  const [dayPopup, setDayPopup] = useState<string>();
  const [error, setError] = useState('');
  const imports = useCourseImport(() => undefined);
  const fudan = useFudanSource();
  const zone = mode === 'event' ? data.schedule.timeZone : data.settings.timeZone;
  const monday = shiftDay(date, 1 - weekday(date));
  const count = phone || mode === 'task' ? 7 : eventDayCount(data.calendarEvents, data.schedule);
  const days = Array.from({ length: count }, (_, i) => shiftDay(monday, i));
  // A default profile has a placeholder semester; only imported, subscribed or course data define it.
  const semesterKnown = useMemo(
    () =>
      !!fudan.source ||
      data.schedule.courses.length > 0 ||
      data.calendarEvents.some((event) => event.type === 'course' && !event.deletedAt),
    [fudan.source, data.schedule.courses, data.calendarEvents],
  );
  const week = semesterKnown ? teachingWeek(data.schedule, monday) : null;
  const ensure = (through: string) => {
    void window.clearlist?.sync?.ensureTasks?.(through).catch((cause) => setError(String(cause)));
  };
  useEffect(() => {
    if (view === 'week') ensure(shiftDay(monday, 6));
  }, [monday, view, mode]);
  const add = (day: string) => {
    onDate(day);
    if (mode === 'task') onAddTask(day);
    else setEditor({ date: day });
  };
  const open = (id: string) => {
    if (mode === 'task') onTask(id);
    else {
      const event = data.calendarEvents.find((row) => row.id === id);
      if (event) setEditor({ event, date: event.date });
    }
  };
  const tasksFor = (day: string) =>
    data.tasks
      .filter((task) => !task.deletedAt && Object.hasOwn(task.dates, day))
      .sort(
        (a, b) =>
          Number(taskCompleted(a)) - Number(taskCompleted(b)) ||
          (b.priority ?? 0) - (a.priority ?? 0) ||
          Number(b.pinned) - Number(a.pinned) ||
          a.order - b.order,
      );
  const switchMode = (
    <button
      className="button small arrangement-mode-switch"
      aria-label={`切换到${mode === 'task' ? '日程' : '待办'}`}
      title={`当前${mode === 'task' ? '待办' : '日程'}`}
      onClick={() => onModeChange(mode === 'task' ? 'event' : 'task')}
    >
      切换
    </button>
  );
  return (
    <section className="arrangements" aria-label={mode === 'task' ? '待办安排' : '日程安排'}>
      <div className="arrangement-controls">
        <PhoneTabs
          tabs={[
            { id: 'month', label: '月视图' },
            { id: 'week', label: '周视图' },
          ]}
          value={view}
          label="安排视图"
          onChange={(value) => (mode === 'task' ? setTaskView(value) : setEventView(value))}
        />
      </div>
      {(error || imports.error) && (
        <p className="form-error" role="alert">
          {error || imports.error}
        </p>
      )}
      {isMobileApp && fudan.error && (
        <div role="alert" className="form-error">
          <p>复旦课表未更新，已有课程仍保留。{fudan.error}</p>
          <button
            className="button"
            disabled={imports.busy || fudan.busy}
            onClick={() => void imports.receive(true)}
          >
            重新登录并读取课表
          </button>
        </div>
      )}
      {imports.busy && <p role="status">正在读取课程…</p>}
      {view === 'month' ? (
        <Calendar
          toolbarAction={switchMode}
          tasks={mode === 'task' ? data.tasks : []}
          events={mode === 'event' ? data.calendarEvents : undefined}
          timeZone={zone}
          selectedDate={date}
          onDate={mode === 'event' ? add : onDate}
          onAdd={add}
          onSelect={open}
          onOpenDay={mode === 'event' ? setDayPopup : onOpenDay}
          onWindow={ensure}
          onDrop={(id, day, from) => {
            if (mode !== 'task') return;
            const task = store.get().tasks.find((row) => row.id === id);
            if (!task) return;
            const dates = { ...task.dates };
            if (from) delete dates[from];
            dates[day] = null;
            store.patchTask(id, { dates });
          }}
        />
      ) : (
        <>
          <div className="calendar-toolbar">
            <h2>
              {monday.slice(0, 7)} · {monday.slice(-2)}—{days.at(-1)!.slice(5)}
              {week !== null && <span className="arrangement-teaching-week">第{week}周</span>}
            </h2>
            <div>
              {switchMode}
              <button
                className="button small"
                onClick={() => onDate(zoneDateKey(Date.now(), zone))}
              >
                本周
              </button>
              <button
                className="icon-button"
                aria-label="上一周"
                onClick={() => onDate(shiftDay(date, -7))}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="下一周"
                onClick={() => onDate(shiftDay(date, 7))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="arrangement-week-scroll" data-no-swipe>
            {mode === 'event' ? (
              <EventWeek
                events={data.calendarEvents}
                days={days}
                zone={zone}
                open={open}
                add={add}
                periods={data.schedule.periods}
                editPeriods={() => setPeriods(true)}
              />
            ) : (
              <div
                className="arrangement-week"
                style={{ '--arrangement-days': count } as CSSProperties}
                data-no-swipe
              >
                {days.map((day, index) => (
                  <section className="arrangement-day" key={day} aria-label={`${day} 待办`}>
                    <button className="arrangement-day-heading" onClick={() => add(day)}>
                      <strong>周{'一二三四五六日'[index]}</strong>
                      <span>{day.slice(5).replace('-', '/')}</span>
                    </button>
                    <div className="arrangement-day-items">
                      {tasksFor(day).map((task) => (
                        <WeekTask
                          key={task.id}
                          task={task}
                          date={day}
                          open={open}
                          move={(source, target) => {
                            void store
                              .transact((state) => {
                                const priority = state.tasks.find(
                                  (row) => row.id === target,
                                )?.priority;
                                return reorderTasks(
                                  {
                                    ...state,
                                    tasks: state.tasks.map((row) =>
                                      row.id === source ? { ...row, priority } : row,
                                    ),
                                  },
                                  tasksFor(day).map((row) => row.id),
                                  source,
                                  target,
                                );
                              })
                              .catch((cause) => setError(String(cause)));
                          }}
                        />
                      ))}
                    </div>
                    <button
                      className="arrangement-day-add"
                      aria-label={`在 ${day} 添加任务`}
                      onClick={() => add(day)}
                    >
                      <Plus size={16} />
                    </button>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {mode === 'event' && <FloatingAdd label="新增日程" onClick={() => add(date)} />}
      {editor && (
        <EventComposer
          key={editor.event?.id ?? editor.date}
          {...editor}
          close={() => setEditor(undefined)}
        />
      )}
      {dayPopup && (
        <Modal title={dayPopup} close={() => setDayPopup(undefined)}>
          <div className="event-day-list">
            {eventsOnDate(data.calendarEvents, dayPopup, zone).map((event) => (
              <EventCard
                key={event.id}
                event={event}
                open={(id) => {
                  setDayPopup(undefined);
                  open(id);
                }}
                zone={zone}
              />
            ))}
            <button
              className="button"
              onClick={() => {
                add(dayPopup);
                setDayPopup(undefined);
              }}
            >
              新增日程
            </button>
          </div>
        </Modal>
      )}
      {periods && <PeriodEditor close={() => setPeriods(false)} />}
      <CourseImportDialog workflow={imports} />
    </section>
  );
}
