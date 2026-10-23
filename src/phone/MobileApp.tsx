import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Grid2X2,
  ListTodo,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Settings as SettingsIcon,
  Tag,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import {
  dateKey,
  finishTimer as finishFocus,
  formatDate,
  now,
  quadrant,
  selectTasks,
  shiftDate,
  type Task,
  type TaskList,
  type View,
} from '../model';
import { store, useStore } from '../store';
import { useClock } from '../runtime';
import { weekday } from '../timezone';
import { duration, formatClock, liveSpans, startTimer, toggleTimer } from '../timelog/domain';
import { TaskRow } from '../components/TaskRow';
import { TaskEditor } from '../components/TaskEditor';
import { Settings, ListModal } from '../components/Settings';
import { Timetable, NextClass } from '../components/Timetable';
import { Calendar } from '../components/Calendar';
import { Focus } from '../components/Focus';
import { Statistics } from '../components/Statistics';
import { TimeLog } from '../components/TimeLog';
import { pendingPairingKey } from '../sync/invitation';
import type { TimePage } from '../timelog/Workspace';
import { Sheet } from './Sheet';
import { TaskComposer } from './TaskComposer';
import { FloatingAdd, PhoneTabs, PhoneTopbar, useSwipeTabs } from './Navigation';

const titles: Record<string, string> = {
  today: '待办',
  all: '全部任务',
  inbox: '收集箱',
  upcoming: '最近七天',
  completed: '已完成',
  trash: '回收站',
  calendar: '任务日历',
  timetable: '课程表',
  focus: '番茄专注',
  stats: '任务统计',
  quadrants: '四象限',
};
const timeTitles: Record<TimePage, string> = {
  timeline: '时间记录',
  timer: '计时',
  analysis: '时间分析',
  goals: '目标',
};

export function MobileApp() {
  const snapshot = useStore(),
    { data } = snapshot;
  const [view, setView] = useState<View>(location.hash === '#timetable' ? 'timetable' : 'today');
  const [timePage, setTimePage] = useState<TimePage>('timeline');
  const clock = useClock();
  const [day, setDay] = useState(dateKey());
  const [sort, setSort] = useState<'manual' | 'date' | 'priority'>('manual');
  const [drawer, setDrawer] = useState(false),
    [composer, setComposer] = useState(false),
    [settings, setSettings] = useState(false);
  const [list, setList] = useState<TaskList | 'new' | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const scroll = useRef<HTMLElement>(null);
  const today = dateKey(new Date(clock));
  const timeView = view === 'timelog';
  const taskView = !['timetable', 'timelog', 'calendar', 'focus', 'stats', 'quadrants'].includes(
    view,
  );
  const live = data.tasks.filter((task) => !task.completedAt && !task.deletedAt);
  const title =
    view === 'timelog'
      ? timePage === 'analysis'
        ? timeTitles.analysis
        : '记录'
      : view.startsWith('list:')
        ? data.lists.find((item) => item.id === view.slice(5))?.name || '清单'
        : view.startsWith('tag:')
          ? `#${view.slice(4)}`
          : titles[view] || '任务';
  const tasks = selectTasks(data, view, '', sort, day).filter(
    (task) => view !== 'today' || day === today || task.due === day,
  );
  const weekStart = shiftDate(day, 1 - weekday(day));
  const weekdays = Array.from({ length: 7 }, (_, index) => shiftDate(weekStart, index));
  const notice = (text: string) => setToast({ text });
  function navigate(next: View, panel?: TimePage) {
    setView(next);
    if (panel) setTimePage(panel);
    setSelected(null);
    setDrawer(false);
    scroll.current?.scrollTo(0, 0);
  }
  const taskTabs = [
    { id: 'today' as const, label: '日程' },
    { id: 'all' as const, label: '全部', count: live.length },
    { id: 'inbox' as const, label: '收集箱', count: live.filter((task) => !task.due).length },
  ];
  const recordTabs = [
    { id: 'timeline' as const, label: '时间线' },
    { id: 'timer' as const, label: '计时' },
    { id: 'goals' as const, label: '目标' },
  ];
  const showTaskTabs = taskTabs.some((tab) => tab.id === view);
  const showRecordTabs = timeView && timePage !== 'analysis';
  const changeTimePage = (page: TimePage) => {
    setTimePage(page);
    scroll.current?.scrollTo(0, 0);
  };
  const taskSwipe = useSwipeTabs(taskTabs, view, navigate);
  const recordSwipe = useSwipeTabs(recordTabs, timePage, changeTimePage);
  useEffect(() => {
    if (snapshot.loaded) setDay(dateKey());
  }, [snapshot.loaded, data.settings.timeZone]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const open = () => setSettings(true);
    const hash = () => {
      if (location.hash === '#timetable') navigate('timetable');
    };
    document.addEventListener('clearlist:settings', open);
    window.addEventListener('hashchange', hash);
    if (snapshot.loaded && sessionStorage.getItem(pendingPairingKey)) setSettings(true);
    return () => {
      document.removeEventListener('clearlist:settings', open);
      window.removeEventListener('hashchange', hash);
    };
  }, [snapshot.loaded]);
  useEffect(() => {
    const back = (event: Event) => {
      if (settings) setSettings(false);
      else if (list) setList(null);
      else if (selected) setSelected(null);
      else if (view !== 'today') navigate('today');
      else return;
      event.preventDefault();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') back(event);
    };
    document.addEventListener('clearlist:back', back);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('clearlist:back', back);
      document.removeEventListener('keydown', keyboard);
    };
  });
  useEffect(() => {
    const timer = data.timer;
    if (!timer?.endAt || timer.endAt > clock) return;
    store.update((state) => finishFocus(state, clock));
    notice(timer.kind === 'focus' ? '专注已完成' : '休息结束');
  }, [clock]);

  async function track(id: string) {
    try {
      await store.transact((state) => {
        if (state.timer) throw new Error('请先结束当前番茄专注。');
        const task = state.tasks.find((task) => task.id === id);
        if (!task || task.deletedAt) throw new Error('任务已变化，请重新查看。');
        const activity =
          state.timelog.activities.find(
            (activity) => !activity.archived && activity.name === '学习',
          ) || state.timelog.activities.find((activity) => !activity.archived);
        if (!activity) throw new Error('请先添加一个计时活动。');
        const timelog = startTimer(state.timelog, activity.id, task.title, Date.now());
        return { ...state, timelog: { ...timelog, timer: { ...timelog.timer!, taskId: id } } };
      });
      navigate('timelog', 'timer');
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    }
  }
  function remove(task: Task) {
    store.patchTask(task.id, { deletedAt: now() });
    setSelected(null);
    setToast({
      text: '任务已移入回收站',
      undo: () => store.patchTask(task.id, { deletedAt: null }),
    });
  }
  function row(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        selected={task.id === selected}
        onSelect={setSelected}
        onDelete={remove}
        onTrack={track}
      />
    );
  }
  if (!snapshot.loaded)
    return (
      <main className="loading-screen">
        <h1>时织</h1>
        <p>{snapshot.error || '正在打开你的安排…'}</p>
        {snapshot.error && (
          <button className="button" onClick={() => void store.initialize()}>
            重新读取
          </button>
        )}
      </main>
    );
  const timer = data.timelog.timer;
  const dock = timer && !(timeView && timePage === 'timer');
  const listId = view.startsWith('list:') ? view.slice(5) : 'inbox';

  return (
    <div
      className={`phone-shell ${timeView ? 'phone-time-view' : ''} ${dock ? 'has-timer-dock' : ''}`}
    >
      <PhoneTopbar
        title={showTaskTabs ? '待办' : title}
        openMenu={
          <button className="icon-button" aria-label="打开导航" onClick={() => setDrawer(true)}>
            <Menu size={23} />
          </button>
        }
      >
        {showTaskTabs && (
          <PhoneTabs tabs={taskTabs} value={view} onChange={navigate} label="待办子页面" />
        )}
        {showRecordTabs && (
          <PhoneTabs
            tabs={recordTabs}
            value={timePage}
            onChange={changeTimePage}
            label="记录子页面"
          />
        )}
      </PhoneTopbar>
      <main
        ref={scroll}
        className="phone-content"
        aria-label={title}
        {...(showTaskTabs ? taskSwipe : showRecordTabs ? recordSwipe : {})}
      >
        {snapshot.error && (
          <div className="error-banner" role="alert">
            {snapshot.error}
            <button onClick={() => setSettings(true)}>备份与恢复</button>
          </div>
        )}
        {taskView && (
          <>
            {view === 'today' && (
              <section className="phone-week" aria-label="待办周历">
                <div className="phone-week-heading">
                  <button
                    className="icon-button"
                    aria-label="前一周待办"
                    onClick={() => setDay(shiftDate(day, -7))}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <label>
                    {day.slice(0, 4)}年{Number(day.slice(5, 7))}月
                    <input
                      type="date"
                      aria-label="待办日期"
                      value={day}
                      onChange={(e) => {
                        if (e.target.value) setDay(e.target.value);
                      }}
                    />
                  </label>
                  <button className="text-button" onClick={() => setDay(today)}>
                    今天
                  </button>
                  <button
                    className="icon-button"
                    aria-label="后一周待办"
                    onClick={() => setDay(shiftDate(day, 7))}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="phone-week-days">
                  {weekdays.map((date, index) => (
                    <button
                      key={date}
                      aria-label={`查看 ${date} 的任务`}
                      aria-pressed={day === date}
                      aria-current={date === today ? 'date' : undefined}
                      onClick={() => setDay(date)}
                    >
                      <span>{['一', '二', '三', '四', '五', '六', '日'][index]}</span>
                      <strong>{Number(date.slice(-2))}</strong>
                      <i className={live.some((task) => task.due === date) ? 'has-tasks' : ''} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {view === 'today' &&
          (data.schedule.courses.length > 0 || data.schedule.events.length > 0) && (
            <NextClass clock={clock} compact onOpen={() => navigate('timetable')} />
          )}
        {taskView && (
          <section className="phone-tasks">
            <div className="phone-section-heading">
              <h2>
                {view === 'today'
                  ? `${formatDate(day)} · ${tasks.length} 件`
                  : `${title} · ${tasks.length}`}
              </h2>
              <label>
                <span className="visually-hidden">任务排序</span>
                <select
                  aria-label="任务排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                >
                  <option value="manual">手动排序</option>
                  <option value="date">按日期</option>
                  <option value="priority">按优先级</option>
                </select>
              </label>
            </div>
            {tasks.length ? (
              tasks.map(row)
            ) : (
              <div className="phone-empty">
                <CircleCheck size={35} />
                <h2>{view === 'today' ? '这一天暂时没有安排' : '这里暂时没有任务'}</h2>
                <p>点右下角 +，记下下一件事</p>
              </div>
            )}
          </section>
        )}
        {timeView && <TimeLog page={timePage} onPageChange={changeTimePage} />}
        {view === 'timetable' && <Timetable clock={clock} />}
        {view === 'calendar' && (
          <Calendar
            tasks={selectTasks(data, 'all', '', 'date', today)}
            selectedDate={day}
            onDate={setDay}
            onSelect={setSelected}
            onDrop={(id, due) => store.patchTask(id, { due, repeatDay: Number(due.slice(-2)) })}
          />
        )}
        {view === 'focus' && <Focus preferredTask={focusTask} clock={clock} />}
        {view === 'stats' && <Statistics />}
        {view === 'quadrants' && (
          <div className="phone-quadrants">
            {['重要且紧急', '重要不紧急', '紧急不重要', '不紧急不重要'].map((label, index) => (
              <section key={label}>
                <h2>{label}</h2>
                {live.filter((task) => quadrant(task, today) === index).map(row)}
              </section>
            ))}
          </div>
        )}
      </main>
      {taskView && !['trash', 'completed'].includes(view) && (
        <FloatingAdd label="新建任务" onClick={() => setComposer(true)} />
      )}
      {dock && (
        <div className="phone-timer-dock">
          <button onClick={() => navigate('timelog', 'timer')}>
            <i className={timer.runningSince === null ? '' : 'running-dot'} />
            <span>
              {data.timelog.activities.find((activity) => activity.id === timer.activityId)?.name}
              <small>{timer.runningSince === null ? '已暂停' : '正在计时'}</small>
            </span>
            <strong>{formatClock(duration(liveSpans(timer, clock)))}</strong>
          </button>
          <button
            className="icon-button"
            aria-label={timer.runningSince === null ? '继续当前计时' : '暂停当前计时'}
            onClick={() =>
              void store
                .transact((state) => {
                  if (state.timelog.timer?.id !== timer.id) throw new Error('计时已变化');
                  return { ...state, timelog: toggleTimer(state.timelog, Date.now()) };
                })
                .catch((error) => notice(String(error)))
            }
          >
            {timer.runningSince === null ? <Play size={20} /> : <Pause size={20} />}
          </button>
        </div>
      )}
      <nav className="phone-nav" aria-label="手机底部导航">
        {[
          {
            key: 'tasks',
            label: '待办',
            icon: ListTodo,
            active: taskView,
            action: () => navigate('today'),
          },
          {
            key: 'records',
            label: '记录',
            icon: Clock3,
            active: timeView,
            action: () => navigate('timelog', 'timeline'),
          },
          {
            key: 'courses',
            label: '课表',
            icon: CalendarDays,
            active: view === 'timetable',
            action: () => navigate('timetable'),
          },
          {
            key: 'more',
            label: '更多',
            icon: MoreHorizontal,
            active: drawer || (!taskView && !timeView && view !== 'timetable'),
            action: () => setDrawer(true),
          },
        ].map(({ key, label, icon: Icon, active, action }) => (
          <button
            key={key}
            className={active ? 'active' : ''}
            aria-label={`手机${label}`}
            aria-current={active ? 'page' : undefined}
            onClick={action}
          >
            <span>
              <Icon size={22} strokeWidth={1.8} />
              {key === 'records' && timer && <i className="running-dot" />}
            </span>
            <small>{label}</small>
          </button>
        ))}
      </nav>
      {drawer && (
        <Sheet title="更多" close={() => setDrawer(false)}>
          <div className="phone-more-grid">
            {[
              {
                label: '时间分析',
                icon: ChartNoAxesCombined,
                action: () => navigate('timelog', 'analysis'),
              },
              { label: '日历', icon: CalendarDays, action: () => navigate('calendar') },
              { label: '最近七天', icon: CalendarDays, action: () => navigate('upcoming') },
              { label: '四象限', icon: Grid2X2, action: () => navigate('quadrants') },
              { label: '番茄专注', icon: Timer, action: () => navigate('focus') },
              { label: '已完成', icon: CircleCheck, action: () => navigate('completed') },
              { label: '回收站', icon: Trash2, action: () => navigate('trash') },
              { label: '任务统计', icon: ChartNoAxesCombined, action: () => navigate('stats') },
              {
                label: '设置与同步',
                icon: SettingsIcon,
                action: () => {
                  setDrawer(false);
                  setSettings(true);
                },
              },
            ].map(({ label, icon: Icon, action }) => (
              <button key={label} onClick={action}>
                <Icon size={23} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="phone-list-heading">
            <h3>我的清单</h3>
            <button
              className="icon-button"
              aria-label="新建清单"
              onClick={() => {
                setDrawer(false);
                setList('new');
              }}
            >
              <Plus size={20} />
            </button>
          </div>
          <div className="phone-list-links">
            {data.lists.map((item) => (
              <div key={item.id}>
                <button onClick={() => navigate(item.id === 'inbox' ? 'inbox' : `list:${item.id}`)}>
                  <i style={{ background: item.color }} />
                  {item.name}
                  <small>{live.filter((task) => task.listId === item.id).length}</small>
                </button>
                {item.id !== 'inbox' && (
                  <button
                    className="icon-button"
                    aria-label={`编辑清单 ${item.name}`}
                    onClick={() => {
                      setDrawer(false);
                      setList(item);
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {[...new Set(live.flatMap((task) => task.tags))].length > 0 && (
            <>
              <div className="phone-list-heading">
                <h3>标签</h3>
              </div>
              <div className="phone-list-links">
                {[...new Set(live.flatMap((task) => task.tags))].sort().map((tag) => (
                  <div key={tag}>
                    <button onClick={() => navigate(`tag:${tag}`)}>
                      <Tag size={16} />
                      {tag}
                      <small>{live.filter((task) => task.tags.includes(tag)).length}</small>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}
      {composer && (
        <TaskComposer
          due={view === 'today' ? day : view === 'calendar' ? day : ''}
          listId={listId}
          today={today}
          close={() => setComposer(false)}
          saved={() => {
            setComposer(false);
            notice('任务已添加');
          }}
        />
      )}
      {selected && (
        <TaskEditor
          id={selected}
          onClose={() => setSelected(null)}
          onDelete={remove}
          onTrack={track}
          onFocus={(id) => {
            setFocusTask(id);
            navigate('focus');
          }}
        />
      )}
      {settings && <Settings onClose={() => setSettings(false)} onMessage={notice} />}
      {list && (
        <ListModal
          list={list === 'new' ? undefined : list}
          onClose={() => setList(null)}
          onSaved={notice}
        />
      )}
      {toast && (
        <div className="phone-toast" role="status">
          <Check size={17} />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              撤销
            </button>
          )}
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
