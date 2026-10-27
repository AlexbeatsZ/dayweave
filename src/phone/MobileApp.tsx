import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CircleCheck,
  Clock3,
  ListTodo,
  Menu,
  Pause,
  Play,
  X,
} from 'lucide-react';
import {
  dateKey,
  startTaskTimer,
  formatDate,
  now,
  quadrant,
  reorderTasks,
  selectTasks,
  type Task,
  type View,
} from '../model';
import { store, useStore } from '../store';
import { useClock } from '../runtime';
import { duration, formatClock, liveSpans, toggleTimer } from '../timelog/domain';
import { TaskRow } from '../components/TaskRow';
import { Settings } from '../components/Settings';
import { StorageRecovery } from '../components/StorageRecovery';
import { Timetable, NextClass } from '../components/Timetable';
import { Calendar } from '../components/Calendar';
import { TimeLog } from '../components/TimeLog';
import { pendingPairingKey } from '../sync/invitation';
import type { TimePage } from '../timelog/Workspace';
import { TaskComposer } from './TaskComposer';
import { FloatingAdd, PhoneTabs, PhoneTopbar, useSwipeTabs, useTabTransition } from './Navigation';
import { DateNavigator, calendarWeek } from './DateNavigator';
import { PhoneStatistics, type StatisticsPage } from './Statistics';
import { PhoneSidebar, type RecordFilter } from './Sidebar';
import { usePhone } from './usePhone';

const titles: Record<string, string> = {
  today: '日计划',
  all: '全部任务',
  inbox: '待办箱',
  upcoming: '周计划',
  calendar: '任务日历',
  timetable: '安排',
  stats: '统计',
  quadrants: '四象限',
};

export function MobileApp() {
  const snapshot = useStore(),
    { data } = snapshot;
  const phone = usePhone();
  const [view, setView] = useState<View>(location.hash === '#timetable' ? 'timetable' : 'today');
  const [timePage, setTimePage] = useState<TimePage>('timeline');
  const clock = useClock();
  const [day, setDay] = useState(dateKey());
  const [sort, setSort] = useState<'manual' | 'date' | 'priority'>('manual');
  const [drawer, setDrawer] = useState(false),
    [composer, setComposer] = useState(false),
    [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [recordFilter, setRecordFilter] = useState<RecordFilter>({});
  const [arrangement, setArrangement] = useState<'calendar' | 'timetable'>(
    location.hash === '#timetable' ? 'timetable' : 'calendar',
  );
  const [statisticsPage, setStatisticsPage] = useState<StatisticsPage>('daily');
  const [statisticsDate, setStatisticsDate] = useState(dateKey());
  const [recordDate, setRecordDate] = useState<string>();
  const [quadrants, setQuadrants] = useState(false);
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
      ? '记录'
      : view.startsWith('list:')
        ? data.lists.find((item) => item.id === view.slice(5))?.name || '清单'
        : view.startsWith('tag:')
          ? `#${view.slice(4)}`
          : titles[view] || '任务';
  const week = calendarWeek(day);
  const tasks = selectTasks(data, view === 'timetable' ? 'all' : view, '', sort, day).filter(
    (task) =>
      view === 'timetable'
        ? task.due === day
        : view !== 'today' || day === today || task.due === day,
  );
  const unfinished = tasks.filter((task) => !task.completedAt);
  const ordered =
    quadrants && (view === 'today' || view === 'all')
      ? [0, 1, 2, 3].flatMap((index) => unfinished.filter((task) => quadrant(task, day) === index))
      : view === 'upcoming'
        ? week.flatMap((date) => unfinished.filter((task) => task.due === date))
        : unfinished;
  const ordinal = new Map(ordered.map((task, index) => [task.id, index + 1]));
  const completed = tasks.filter((task) => task.completedAt);
  function moveTask(source: string, target: string) {
    const from = tasks.find((task) => task.id === source),
      to = tasks.find((task) => task.id === target);
    if (!from || !to) return;
    if (view === 'upcoming' && from.due !== to.due) {
      notice('周计划按日期分组，请在同一天内调整顺序');
      return;
    }
    if (
      quadrants &&
      (view === 'today' || view === 'all') &&
      quadrant(from, day) !== quadrant(to, day)
    ) {
      notice('请在同一象限内调整顺序');
      return;
    }
    void store
      .transact((state) =>
        reorderTasks(
          state,
          ordered.map((task) => task.id),
          source,
          target,
        ),
      )
      .catch((error) => notice(String(error)));
    setSort('manual');
  }
  const notice = (text: string) => setToast({ text });
  function navigate(next: View, panel?: TimePage) {
    setView(next);
    if (panel) setTimePage(panel);
    setSelected(null);
    setDrawer(false);
    scroll.current?.scrollTo(0, 0);
  }
  const taskTabs = [
    { id: 'today' as const, label: '日计划' },
    { id: 'upcoming' as const, label: '周计划' },
    { id: 'all' as const, label: '全部', count: live.length },
    { id: 'inbox' as const, label: '待办箱', count: live.filter((task) => !task.due).length },
  ];
  const recordTabs = [
    { id: 'timeline' as const, label: '时间线' },
    { id: 'timer' as const, label: '计时' },
    { id: 'goals' as const, label: '目标' },
  ];
  const arrangementTabs = [
    { id: 'calendar', label: '月历' },
    { id: 'timetable', label: '课程表' },
  ];
  const statisticsTabs = [
    { id: 'daily', label: '每日' },
    { id: 'tasks', label: '待办' },
    { id: 'records', label: '记录' },
  ];
  const showTaskTabs = taskTabs.some((tab) => tab.id === view);
  const tabs = showTaskTabs
    ? taskTabs
    : timeView
      ? recordTabs
      : view === 'timetable'
        ? arrangementTabs
        : view === 'stats'
          ? statisticsTabs
          : [];
  const activeTab = showTaskTabs
    ? view
    : timeView
      ? timePage
      : view === 'timetable'
        ? arrangement
        : statisticsPage;
  useTabTransition(scroll, showTaskTabs ? view : `${view}:${activeTab}`, [
    'today',
    'upcoming',
    'all',
    'inbox',
    'timelog:timeline',
    'timelog:timer',
    'timelog:goals',
    'timetable:calendar',
    'timetable:timetable',
    'stats:daily',
    'stats:tasks',
    'stats:records',
  ]);
  const changeTab = (id: string) => {
    if (showTaskTabs) navigate(id as View);
    else if (timeView) setTimePage(id as TimePage);
    else if (view === 'timetable') setArrangement(id as 'calendar' | 'timetable');
    else setStatisticsPage(id as StatisticsPage);
    scroll.current?.scrollTo(0, 0);
  };
  const swipe = useSwipeTabs(tabs, activeTab, changeTab);
  const openRecords = (date: string) => {
    setRecordDate(date);
    navigate('timelog', 'timeline');
  };
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
      if (location.hash === '#timetable') {
        setArrangement('timetable');
        navigate('timetable');
      }
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
      else if (selected) setSelected(null);
      else if (view !== 'today') navigate('today');
      else return;
      event.preventDefault();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) back(event);
      if (
        !phone &&
        event.key.toLowerCase() === 'n' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.repeat &&
        !(event.target as Element | null)?.closest(
          'input, textarea, select, [contenteditable="true"]',
        ) &&
        !document.querySelector('dialog[open], .modal-backdrop')
      ) {
        event.preventDefault();
        if (!taskView && !(view === 'timetable' && arrangement === 'calendar')) navigate('today');
        setComposer(true);
      }
    };
    document.addEventListener('clearlist:back', back);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('clearlist:back', back);
      document.removeEventListener('keydown', keyboard);
    };
  });

  async function track(id: string) {
    try {
      await store.transact((state) => startTaskTimer(state, id));
      navigate('timelog', 'timer');
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    }
  }
  function remove(task: Task) {
    store.patchTask(task.id, { deletedAt: now() });
    setSelected(null);
    setToast({
      text: '任务已删除',
      undo: () => store.patchTask(task.id, { deletedAt: null }),
    });
  }
  function row(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        index={ordinal.get(task.id)}
        onMove={task.completedAt ? undefined : moveTask}
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
        {snapshot.error && <StorageRecovery loaded={false} />}
      </main>
    );
  const timer = data.timelog.timer;
  const dock = timer && !(timeView && timePage === 'timer');
  const listId = view.startsWith('list:') ? view.slice(5) : 'inbox';
  const sidebar = (
    <PhoneSidebar
      persistent={!phone}
      open={drawer}
      kind={taskView ? 'tasks' : timeView ? 'records' : 'other'}
      view={view}
      recordFilter={recordFilter}
      close={() => setDrawer(false)}
      onSettings={() => {
        setDrawer(false);
        setSettings(true);
      }}
      onList={(id) => navigate(id === 'inbox' ? 'inbox' : `list:${id}`)}
      onTaskTag={(tag) => navigate(`tag:${tag}`)}
      onRecordFilter={(filter) => {
        setRecordFilter(filter);
        navigate('timelog', 'timeline');
      }}
    />
  );

  return (
    <div
      className={`phone-shell app-shell ${phone ? 'mobile-shell' : 'desktop-shell'} ${timeView ? 'phone-time-view' : ''} ${dock ? 'has-timer-dock' : ''}`}
      data-layout={phone ? 'phone' : 'desktop'}
      data-section={
        taskView
          ? 'tasks'
          : timeView
            ? 'records'
            : view === 'timetable'
              ? 'arrangements'
              : 'statistics'
      }
      data-view={view}
    >
      <PhoneTopbar
        title={showTaskTabs ? '待办' : title}
        openMenu={
          phone && (
            <button className="icon-button" aria-label="打开导航" onClick={() => setDrawer(true)}>
              <Menu size={23} />
            </button>
          )
        }
      >
        {tabs.length > 0 && (
          <PhoneTabs
            tabs={tabs}
            value={activeTab}
            onChange={changeTab}
            label={
              showTaskTabs
                ? '待办子页面'
                : timeView
                  ? '记录子页面'
                  : view === 'timetable'
                    ? '安排子页面'
                    : '统计子页面'
            }
          />
        )}
      </PhoneTopbar>
      <main
        ref={scroll}
        className="phone-content"
        aria-label={title}
        {...(tabs.length ? swipe : {})}
      >
        {snapshot.recovered && (
          <div className="recovery-banner" role="status">
            已从备份恢复最近可用的数据。可在设置中导出备份并检查内容。
            <button className="text-button" onClick={() => setSettings(true)}>
              数据与备份
            </button>
          </div>
        )}
        {snapshot.error && (
          <div className="error-banner" role="alert">
            <span>{snapshot.error}</span>
            <StorageRecovery loaded conflict={snapshot.errorKind === 'conflict'} />
          </div>
        )}
        {timeView && (recordFilter.activityId || recordFilter.tag) && (
          <div className="phone-filter-bar">
            <span>
              {recordFilter.tag
                ? `#${recordFilter.tag}`
                : data.timelog.activities.find(
                    (activity) => activity.id === recordFilter.activityId,
                  )?.name}
            </span>
            <button className="text-button" onClick={() => setRecordFilter({})}>
              清除筛选
            </button>
          </div>
        )}
        {(view === 'today' || view === 'upcoming') && (
          <DateNavigator
            date={day}
            onDate={setDay}
            label="待办日期"
            week={view === 'upcoming'}
            taskDates={live.flatMap((task) => (task.due ? [task.due] : []))}
          />
        )}
        {view === 'today' &&
          (data.schedule.courses.length > 0 || data.schedule.events.length > 0) && (
            <NextClass
              clock={clock}
              compact
              onOpen={() => {
                setArrangement('timetable');
                navigate('timetable');
              }}
            />
          )}
        {taskView && (
          <section className="phone-tasks">
            <div className="phone-section-heading">
              <h2>
                {view === 'today'
                  ? `${formatDate(day)} · ${tasks.length} 件`
                  : `${title} · ${tasks.length}`}
              </h2>
              {(view === 'today' || view === 'all') && (
                <div className="phone-layout-switch" role="group" aria-label="待办显示方式">
                  <button aria-pressed={!quadrants} onClick={() => setQuadrants(false)}>
                    列表
                  </button>
                  <button aria-pressed={quadrants} onClick={() => setQuadrants(true)}>
                    四象限
                  </button>
                </div>
              )}
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
              quadrants && (view === 'today' || view === 'all') ? (
                <div className="phone-quadrants">
                  {['重要且紧急', '重要不紧急', '紧急不重要', '不紧急不重要'].map(
                    (label, index) => (
                      <section key={label}>
                        <h2>{label}</h2>
                        {tasks
                          .filter((task) => !task.completedAt && quadrant(task, day) === index)
                          .map(row)}
                      </section>
                    ),
                  )}
                </div>
              ) : view === 'upcoming' ? (
                <div className="weekly-plan-grid">
                  {week.map((date) => (
                    <section className="phone-plan-day" key={date}>
                      <h3>{formatDate(date)}</h3>
                      {tasks.filter((task) => task.due === date && !task.completedAt).map(row)}
                      {!tasks.some((task) => task.due === date) && (
                        <p className="muted">暂无计划</p>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <>{tasks.filter((task) => !task.completedAt).map(row)}</>
              )
            ) : (
              <div className="phone-empty">
                <CircleCheck size={35} />
                <h2>{view === 'today' ? '这一天暂时没有安排' : '这里暂时没有任务'}</h2>
                <p>点右下角 +，记下下一件事</p>
              </div>
            )}
            {completed.length > 0 && (
              <details className="completed-plans" open>
                <summary>已完成 · {completed.length}</summary>
                {completed.map(row)}
              </details>
            )}
          </section>
        )}
        {timeView && (
          <TimeLog
            page={timePage}
            onPageChange={(page) => {
              setTimePage(page);
              scroll.current?.scrollTo(0, 0);
            }}
            initialDate={recordDate}
            filter={recordFilter}
          />
        )}
        {view === 'timetable' &&
          (arrangement === 'timetable' ? (
            <Timetable clock={clock} />
          ) : (
            <div className="arrangement-calendar">
              <Calendar
                tasks={data.tasks.filter((task) => !task.deletedAt && !task.completedAt)}
                selectedDate={day}
                onDate={setDay}
                onSelect={setSelected}
                onDrop={(id, due) => store.patchTask(id, { due, repeatDay: Number(due.slice(-2)) })}
              />
              <section className="phone-plan-day">
                <h3>{formatDate(day)}</h3>
                {tasks.map(row)}
                <button className="button" onClick={() => setComposer(true)}>
                  添加当天计划
                </button>
              </section>
            </div>
          ))}
        {view === 'calendar' && (
          <Calendar
            tasks={selectTasks(data, 'all', '', 'date', today)}
            selectedDate={day}
            onDate={setDay}
            onSelect={setSelected}
            onDrop={(id, due) => store.patchTask(id, { due, repeatDay: Number(due.slice(-2)) })}
          />
        )}
        {view === 'stats' && (
          <PhoneStatistics
            page={statisticsPage}
            date={statisticsDate}
            setDate={setStatisticsDate}
            onTimeline={openRecords}
          />
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
      <div className="app-navigation">
        <nav className="phone-nav app-nav" aria-label={phone ? '手机底部导航' : '主导航'}>
          <div className="app-brand" aria-label="时织 Dayweave">
            <span className="app-brand-mark">
              <ListTodo size={23} strokeWidth={1.8} />
            </span>
            <div>
              <strong>时织</strong>
              <small>Dayweave</small>
            </div>
          </div>
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
              label: '安排',
              icon: CalendarDays,
              active: view === 'timetable',
              action: () => navigate('timetable'),
            },
            {
              key: 'statistics',
              label: '统计',
              icon: ChartNoAxesCombined,
              active: view === 'stats',
              action: () => navigate('stats'),
            },
          ].map(({ key, label, icon: Icon, active, action }) => (
            <button
              key={key}
              className={active ? 'active' : ''}
              aria-label={phone ? `手机${label}` : label}
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
        {sidebar}
      </div>
      {composer && (
        <TaskComposer
          due={['today', 'upcoming', 'calendar', 'timetable'].includes(view) ? day : ''}
          listId={listId}
          today={today}
          close={() => setComposer(false)}
          saved={() => {
            setComposer(false);
            notice('任务已添加');
          }}
        />
      )}
      {selected && data.tasks.find((task) => task.id === selected) && (
        <TaskComposer
          key={selected}
          task={data.tasks.find((task) => task.id === selected)}
          due=""
          listId="inbox"
          today={today}
          close={() => setSelected(null)}
          saved={() => {
            setSelected(null);
            notice('任务已保存');
          }}
          onDelete={remove}
          onTrack={track}
        />
      )}
      {settings && <Settings onClose={() => setSettings(false)} onMessage={notice} />}
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
