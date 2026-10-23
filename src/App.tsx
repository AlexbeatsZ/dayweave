import { Timetable, NextClass } from './components/Timetable';
import { TimeLog } from './components/TimeLog';
import { startTimer as startTracking, liveSpans, duration, formatClock } from './timelog/domain';
import { getTimeZone, zoneLabel } from './timezone';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Sun,
  Inbox,
  ListTodo,
  LayoutGrid,
  Timer,
  ChartNoAxesCombined,
  CircleCheck,
  Trash2,
  Plus,
  Search,
  Settings as SettingsIcon,
  Check,
  ChevronRight,
  ArrowUpDown,
  X,
  Hash,
  Ellipsis,
  CloudOff,
  Leaf,
  Folder,
  Circle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  colors,
  dateKey,
  finishTimer,
  formatDate,
  newTask,
  now,
  priorityLabels,
  quadrant,
  selectTasks,
  shiftDate,
  statistics,
  uid,
  type AppState,
  type Task,
  type TaskList,
  type View,
} from './model';
import { store, useStore } from './store';
import { TaskRow } from './components/TaskRow';
import { TaskEditor } from './components/TaskEditor';
import { Calendar } from './components/Calendar';
import { Focus } from './components/Focus';
import { Statistics } from './components/Statistics';
import { ListModal, Settings } from './components/Settings';
import { useClock, useApplicationTheme } from './runtime';
import { pendingPairingKey } from './sync/invitation';
import { MobileApp } from './phone/MobileApp';
import { usePhone } from './phone/usePhone';

const navigation = [
  { view: 'timetable', label: '课程表', Icon: CalendarDays },
  { view: 'timelog', label: '时间记录', Icon: Timer },
  { view: 'today', label: '今天', Icon: Sun },
  { view: 'upcoming', label: '最近七天', Icon: CalendarDays },
  { view: 'all', label: '全部任务', Icon: ListTodo },
  { view: 'inbox', label: '收集箱', Icon: Inbox },
  { view: 'calendar', label: '日历', Icon: CalendarDays },
  { view: 'quadrants', label: '四象限', Icon: LayoutGrid },
] as const;
const tools = [
  { view: 'focus', label: '专注', Icon: Timer },
  { view: 'stats', label: '统计', Icon: ChartNoAxesCombined },
  { view: 'completed', label: '已完成', Icon: CircleCheck },
  { view: 'trash', label: '回收站', Icon: Trash2 },
] as const;
const descriptions: Record<string, string> = {
  today: '课程、待办与时间，都在今天。',
  timetable: '按课程时区安排这一周。',
  timelog: '记录时间，补上空档，看见投入。',
  upcoming: '把这一周，安排得从容一点。',
  all: '每一件放在心上的事，都在这里。',
  inbox: '先记下来，稍后再安排。',
  calendar: '让每件事，都有合适的时间。',
  quadrants: '分清轻重缓急，把注意力放对地方。',
  focus: '关掉纷扰，留一段完整的时间。',
  stats: '看见每一步，也看见自己的节奏。',
  completed: '做过的事，值得被记住。',
  trash: '暂时放下的事，也能重新拾起。',
};
type Toast = { message: string; undo?: () => void };

export function App() {
  useApplicationTheme();
  return usePhone() ? <MobileApp /> : <DesktopApp />;
}

function DesktopApp() {
  useEffect(() => {
    const open = () => {
      if (location.hash === '#timetable') setView('timetable');
    };
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  const snapshot = useStore();
  const { data } = snapshot;
  const [view, setView] = useState<View>(() =>
    location.hash === '#timetable' ? 'timetable' : 'today',
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'manual' | 'date' | 'priority'>('manual');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (snapshot.loaded && sessionStorage.getItem(pendingPairingKey)) setSettings(true);
  }, [snapshot.loaded]);
  const [editingList, setEditingList] = useState<TaskList | 'new' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const clock = useClock();
  const [calendarDate, setCalendarDate] = useState(dateKey());
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDue, setDraftDue] = useState<string>(dateKey());
  const [draftList, setDraftList] = useState('inbox');
  const [draftPriority, setDraftPriority] = useState<Task['priority']>(4);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const composer = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const today = dateKey(new Date(clock));
  useEffect(() => {
    if (snapshot.loaded) {
      setCalendarDate(dateKey());
      if (['today', 'upcoming', 'quadrants'].includes(view)) setDraftDue(dateKey());
    }
  }, [snapshot.loaded, data.settings.timeZone]);
  const live = data.tasks.filter((t) => !t.deletedAt && !t.completedAt);
  const tags = [...new Set(data.tasks.filter((t) => !t.deletedAt).flatMap((t) => t.tags))].sort(
    (a, b) => a.localeCompare(b, 'zh-CN'),
  );
  const selectedTask = data.tasks.find((t) => t.id === selectedId);
  const taskViews = !['timetable', 'timelog', 'focus', 'stats', 'calendar', 'quadrants'].includes(
    view,
  );
  const taskScreen = taskViews || !!query.trim();
  const allowComposer =
    !!query.trim() ||
    !['timetable', 'timelog', 'focus', 'stats', 'completed', 'trash'].includes(view);
  const tasks = selectTasks(data, view, query, sort, today);
  const title = query.trim()
    ? '搜索结果'
    : view.startsWith('list:')
      ? (data.lists.find((l) => l.id === view.slice(5))?.name ?? '清单')
      : view.startsWith('tag:')
        ? `#${view.slice(4)}`
        : ([...navigation, ...tools].find((n) => n.view === view)?.label ?? '任务');
  const message = (text: string) => setToast({ message: text });
  const navigate = (next: View) => {
    setView(next);
    setQuery('');
    setSelectedId(null);
  };
  const openComposer = () => {
    if (!allowComposer) navigate('today');
    setTimeout(() => composer.current?.focus(), 50);
  };
  const focusSearch = () => {
    setSidebarOpen(true);
    setSearchOpen(true);
    setTimeout(() => search.current?.focus(), 0);
  };

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), toast.undo ? 9000 : 4500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    setDraftDue(
      view === 'today' || view === 'upcoming' || view === 'quadrants'
        ? dateKey()
        : view === 'calendar'
          ? calendarDate
          : '',
    );
    setDraftList(view.startsWith('list:') ? view.slice(5) : 'inbox');
  }, [view]);
  useEffect(() => {
    const timer = store.get().timer;
    if (!timer || !timer.endAt || timer.endAt > clock) return;
    store.update((s) => finishTimer(s, clock));
    const text =
      timer.kind === 'focus'
        ? `完成了 ${Math.round(timer.duration / 60)} 分钟专注，休息一下吧。`
        : '休息结束，可以开始下一件事了。';
    message(text);
    void window.clearlist?.notify('时织', text).catch(() => {});
  }, [clock]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettings(false);
        setEditingList(null);
        setSelectedId(null);
        setQuery('');
        return;
      }
      const editing = (e.target as HTMLElement).matches(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') ||
        (!editing && e.key === '/')
      ) {
        e.preventDefault();
        focusSearch();
      }
      if (!editing && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openComposer();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    if (view.startsWith('list:') && !data.lists.some((l) => l.id === view.slice(5))) setView('all');
    if (!data.lists.some((l) => l.id === draftList)) setDraftList('inbox');
  }, [data.lists]);
  useEffect(() => {
    const back = (event: Event) => {
      if (settings) setSettings(false);
      else if (editingList) setEditingList(null);
      else if (selectedId) setSelectedId(null);
      else if (query) {
        setQuery('');
        setSearchOpen(false);
      } else if (view !== 'today') navigate('today');
      else return;
      event.preventDefault();
    };
    document.addEventListener('clearlist:back', back);
    return () => document.removeEventListener('clearlist:back', back);
  });
  useEffect(() => {
    const open = () => setSettings(true);
    document.addEventListener('clearlist:settings', open);
    return () => document.removeEventListener('clearlist:settings', open);
  }, []);

  const remove = (task: Task) => {
    store.patchTask(task.id, { deletedAt: now() });
    if (selectedId === task.id) setSelectedId(null);
    setToast({
      message: '任务已移入回收站',
      undo: () => store.patchTask(task.id, { deletedAt: null }),
    });
  };
  const move = (source: string, target: string) => {
    const rows = tasks.filter((t) => t.id !== source);
    const position = rows.findIndex((t) => t.id === target);
    const sourceTask = data.tasks.find((t) => t.id === source);
    if (position < 0 || !sourceTask) return;
    rows.splice(position, 0, sourceTask);
    const orders = new Map(rows.map((t, i) => [t.id, i + 1]));
    store.update((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        orders.has(t.id) ? { ...t, order: orders.get(t.id)!, updatedAt: now() } : t,
      ),
    }));
    setSort('manual');
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedTags = [...draftTitle.matchAll(/(?:^|\s)#([^\s#]+)/g)]
      .map((m) => m[1])
      .filter((t) => t.length <= 40);
    const taskTitle = draftTitle.replace(/(?:^|\s)#[^\s#]+/g, '').trim() || draftTitle.trim();
    if (!taskTitle) return;
    const task = newTask(taskTitle, {
      due: draftDue || null,
      listId: draftList,
      priority: draftPriority,
      tags: [...new Set(parsedTags)].slice(0, 30),
    });
    store.update((s) => ({ ...s, tasks: [...s.tasks, task] }));
    setDraftTitle('');
    composer.current?.focus();
    if (query.trim()) {
      setQuery('');
      setView('all');
    }
    message('任务已添加');
  };
  const examples = () => {
    const learning = uid(),
      life = uid();
    store.update((s): AppState => ({
      ...s,
      lists: [
        ...s.lists,
        { id: learning, name: '学习与创造', color: colors[0], order: Date.now() },
        { id: life, name: '生活小事', color: colors[2], order: Date.now() + 1 },
      ],
      tasks: [
        ...s.tasks,
        newTask('把最重要的一件事，留在今天', {
          due: today,
          listId: learning,
          priority: 1,
          pinned: true,
          tags: ['开始'],
          notes: '这是入门示例，可以自由修改或删除。\n\n点击标题打开详情；拖动任务可以调整顺序。',
          subtasks: [
            { id: uid(), title: '写下一个具体的目标', done: false },
            { id: uid(), title: '拆成可以马上动手的第一步', done: false },
          ],
        }),
        newTask('留 25 分钟，安静地读一会儿', {
          due: today,
          listId: learning,
          priority: 2,
          tags: ['阅读'],
          notes: '点击详情里的「为这件事专注」，试一次番茄计时。',
        }),
        newTask('出门走走，给大脑换换空气', {
          due: today,
          listId: life,
          priority: 4,
          tags: ['生活'],
        }),
        newTask('整理本周想做的事', { due: shiftDate(today, 2), listId: learning, priority: 2 }),
        newTask('给绿植浇水', {
          due: shiftDate(today, 1),
          listId: life,
          priority: 3,
          repeat: 'weekly',
        }),
        newTask('一个以后想试试的点子', { listId: 'inbox', tags: ['灵感'] }),
      ],
    }));
    message('已添加 6 件入门示例，可以自由修改或删除');
  };
  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      selected={task.id === selectedId}
      onSelect={setSelectedId}
      onDelete={remove}
      onMove={move}
    />
  );
  const count = (name: View) =>
    name === 'today'
      ? live.filter((t) => t.due && t.due <= today).length
      : name === 'upcoming'
        ? live.filter((t) => t.due && t.due >= today && t.due <= shiftDate(today, 6)).length
        : name === 'inbox'
          ? live.filter((t) => !t.due).length
          : name === 'all'
            ? live.length
            : 0;
  const todayTasks = data.tasks.filter(
    (t) =>
      !t.deletedAt &&
      (t.due === today || (t.completedAt && dateKey(new Date(t.completedAt)) === today)),
  );
  const todayDone = todayTasks.filter((t) => t.completedAt).length;
  const completion = todayTasks.length ? Math.round((todayDone / todayTasks.length) * 100) : 0;

  if (!snapshot.loaded)
    return (
      <div className="loading-screen">
        <span className="brand-mark">
          <Check size={28} />
        </span>
        <h1>时织</h1>
        {snapshot.error ? (
          <div role="alert">
            <p>{snapshot.error}</p>
            <p>请保留数据文件，修复或恢复备份后重新打开。</p>
            <button className="button" onClick={() => void store.initialize()}>
              重新读取
            </button>
            {window.clearlist && (
              <button className="button" onClick={() => void store.restore()}>
                选择备份恢复
              </button>
            )}
          </div>
        ) : (
          <p>正在打开你的清单…</p>
        )}
      </div>
    );

  return (
    <div
      className={`app-shell ${selectedTask ? 'with-detail' : ''} ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
    >
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <div>
            <strong>时织</strong>
            <span>DAYWEAVE</span>
          </div>
          <button
            className="icon-button sidebar-toggle"
            title="收起侧栏"
            aria-label="收起侧栏"
            onClick={() => {
              setSidebarOpen(false);
            }}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        <label className={`search-box ${searchOpen ? 'search-open' : ''}`}>
          <Search size={16} />
          <button className="mobile-search-trigger" aria-label="打开搜索" onClick={focusSearch}>
            <Search size={16} />
          </button>
          <input
            ref={search}
            aria-label="搜索任务"
            placeholder="搜索任务或 #标签"
            value={query}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              if (!query) setSearchOpen(false);
            }}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="sidebar-scroll">
          <nav className="nav-primary">
            {navigation.map(({ view: next, label, Icon }) => (
              <button
                key={next}
                aria-label={label}
                title={label}
                className={`nav-item ${view === next && !query ? 'active' : ''}`}
                aria-current={view === next && !query ? 'page' : undefined}
                onClick={() => navigate(next)}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {count(next) > 0 && <small>{count(next)}</small>}
              </button>
            ))}
          </nav>
          <section className="sidebar-section">
            <header>
              <h2>我的清单</h2>
              <button
                className="icon-button"
                title="新建清单"
                aria-label="新建清单"
                onClick={() => setEditingList('new')}
              >
                <Plus size={16} />
              </button>
            </header>
            {data.lists
              .filter((l) => l.id !== 'inbox')
              .sort((a, b) => a.order - b.order)
              .map((list) => (
                <div
                  className={`list-nav-wrap ${view === `list:${list.id}` && !query ? 'active' : ''}`}
                  key={list.id}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/clearlist-task'))
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('application/clearlist-task');
                    if (id) {
                      store.patchTask(id, { listId: list.id });
                      message(`已移到「${list.name}」`);
                    }
                  }}
                >
                  <button
                    className="nav-item"
                    aria-label={list.name}
                    title={list.name}
                    onClick={() => navigate(`list:${list.id}`)}
                  >
                    <span className="list-square" style={{ background: list.color }} />
                    <span>{list.name}</span>
                    <small>{live.filter((t) => t.listId === list.id).length || ''}</small>
                  </button>
                  <button
                    className="list-edit icon-button"
                    title={`编辑清单 ${list.name}`}
                    aria-label={`编辑清单 ${list.name}`}
                    onClick={() => setEditingList(list)}
                  >
                    <Ellipsis size={16} />
                  </button>
                </div>
              ))}
            {data.lists.length === 1 && (
              <button className="create-list-hint" onClick={() => setEditingList('new')}>
                <Plus size={13} />
                为工作和生活各留一个位置
              </button>
            )}
          </section>
          {tags.length > 0 && (
            <section className="sidebar-section tags-section">
              <header>
                <h2>标签</h2>
                <Hash size={13} />
              </header>
              <div className="sidebar-tags">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    className={view === `tag:${tag}` ? 'active' : ''}
                    onClick={() => navigate(`tag:${tag}`)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </section>
          )}
          <nav className="nav-tools">
            {tools.map(({ view: next, label, Icon }) => (
              <button
                key={next}
                aria-label={label}
                title={label}
                className={`nav-item ${view === next && !query ? 'active' : ''}`}
                onClick={() => navigate(next)}
              >
                <Icon size={18} strokeWidth={1.7} />
                <span>{label}</span>
                {next === 'focus' && data.timer && <span className="timer-nav-dot" />}
              </button>
            ))}
          </nav>
        </div>
        <footer className="sidebar-footer">
          <span>
            <i className={snapshot.error ? 'status-error' : ''} />
            {snapshot.error ? '保存遇到问题' : snapshot.saving ? '正在保存' : '已保存在本地'}
          </span>
          <button
            className="icon-button"
            aria-label="打开设置"
            title="设置"
            onClick={() => {
              setSettings(true);
            }}
          >
            <SettingsIcon size={18} />
          </button>
        </footer>
      </aside>
      <main className="main-panel">
        <header className="main-header">
          <div className="page-heading">
            {!sidebarOpen && (
              <button
                className="icon-button open-sidebar"
                aria-label="展开侧栏"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen size={20} />
              </button>
            )}
            <div>
              <div className="date-eyebrow">
                {new Date(clock).toLocaleDateString('zh-CN', {
                  timeZone: getTimeZone(),
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                })}
                <span>{zoneLabel(data.settings.timeZone, clock)}</span>
              </div>
              <h1>
                {title}
                {(taskScreen || view === 'quadrants') && <small>{tasks.length}</small>}
              </h1>
              <p>
                {query
                  ? `在全部任务中查找「${query}」`
                  : view.startsWith('tag:')
                    ? '用一个标签，连接相关的事。'
                    : view.startsWith('list:')
                      ? '专门留给这一部分生活。'
                      : descriptions[view]}
              </p>
            </div>
          </div>
          <div className="header-actions">
            <span className="offline-badge">
              <CloudOff size={13} />
              离线可用
            </span>
            <button className="button primary new-task-button" onClick={openComposer}>
              <Plus size={17} />
              新建任务<kbd>N</kbd>
            </button>
          </div>
        </header>
        {snapshot.error && (
          <div className="error-banner" role="alert">
            <span>{snapshot.error}</span>
            <button onClick={() => store.retry()}>重试保存</button>
            <button onClick={() => setSettings(true)}>导出备份</button>
            <button onClick={() => void store.reload()}>舍弃未保存并重新读取</button>
          </div>
        )}
        {snapshot.recovered && (
          <div className="recovery-banner">
            已从最近一次有效备份恢复。原文件已保留，建议导出一份新的备份。
          </div>
        )}
        <div className="main-scroll">
          <div className={`page-content ${view === 'calendar' ? 'calendar-content' : ''}`}>
            {!query && view === 'timetable' && <Timetable clock={clock} />}
            {!query && view === 'timelog' && <TimeLog />}
            {!query && view === 'today' && (
              <NextClass clock={clock} compact onOpen={() => navigate('timetable')} />
            )}
            {data.timelog.timer && view !== 'timelog' && (
              <button className="tracking-strip" onClick={() => navigate('timelog')}>
                <Timer size={18} />
                <span>
                  {data.timelog.timer.note ||
                    data.timelog.activities.find((a) => a.id === data.timelog.timer?.activityId)
                      ?.name}
                </span>
                <strong>{formatClock(duration(liveSpans(data.timelog.timer, clock)))}</strong>
                <ChevronRight size={16} />
              </button>
            )}
            {allowComposer && (
              <form className="composer" onSubmit={add}>
                <div className="composer-title">
                  <Plus size={20} />
                  <input
                    ref={composer}
                    aria-label="新任务标题"
                    placeholder={view === 'inbox' ? '想到什么，先记下来…' : '添加一件想做的事…'}
                    maxLength={500}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                  <span className="composer-shortcut">Enter ↵</span>
                </div>
                <div className="composer-options">
                  <label className="date-choice">
                    <CalendarDays size={14} />
                    <input
                      aria-label="新任务日期"
                      title="计划日期，留空即放入收集箱"
                      type="date"
                      min="2000-01-01"
                      max="2200-12-31"
                      value={draftDue}
                      onChange={(e) => setDraftDue(e.target.value)}
                    />
                  </label>
                  <label>
                    <Circle size={12} className={`priority-${draftPriority}`} />
                    <select
                      aria-label="新任务优先级"
                      value={draftPriority}
                      onChange={(e) => setDraftPriority(Number(e.target.value) as Task['priority'])}
                    >
                      {Object.entries(priorityLabels).map(([n, label]) => (
                        <option value={n} key={n}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="composer-list">
                    <Folder size={14} />
                    <select
                      aria-label="新任务清单"
                      value={draftList}
                      onChange={(e) => setDraftList(e.target.value)}
                    >
                      {data.lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="add-task-button"
                    type="submit"
                    disabled={!draftTitle.trim()}
                    aria-label="添加任务"
                  >
                    <span>添加</span>
                    <Plus size={15} />
                  </button>
                </div>
              </form>
            )}
            {taskScreen && (
              <>
                <div className="list-toolbar">
                  <span>
                    {query
                      ? `${tasks.length} 件相关任务`
                      : view === 'trash'
                        ? '删除的任务可随时恢复'
                        : view === 'completed'
                          ? '每一次完成，都算数'
                          : '待办事项'}
                  </span>
                  {view !== 'trash' && view !== 'completed' && (
                    <div>
                      <label className="show-completed">
                        <input
                          type="checkbox"
                          checked={data.settings.showCompleted}
                          onChange={(e) =>
                            store.update((s) => ({
                              ...s,
                              settings: { ...s.settings, showCompleted: e.target.checked },
                            }))
                          }
                        />
                        显示已完成
                      </label>
                      <label className="sort-control">
                        <ArrowUpDown size={13} />
                        <select
                          aria-label="排序方式"
                          value={sort}
                          onChange={(e) => setSort(e.target.value as typeof sort)}
                        >
                          <option value="manual">手动排序</option>
                          <option value="date">按日期</option>
                          <option value="priority">按优先级</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
                {tasks.length ? (
                  <div className="task-list">
                    {view === 'today' && !query ? (
                      <>
                        {tasks.some((t) => t.due && t.due < today && !t.completedAt) && (
                          <section className="task-group">
                            <h2 className="group-title overdue">
                              逾期
                              <span>
                                {
                                  tasks.filter((t) => t.due && t.due < today && !t.completedAt)
                                    .length
                                }
                              </span>
                            </h2>
                            {tasks.filter((t) => t.due && t.due < today && !t.completedAt).map(row)}
                          </section>
                        )}
                        <section className="task-group">
                          <h2 className="group-title">
                            今天
                            <span>
                              {tasks.filter((t) => t.due === today && !t.completedAt).length}
                            </span>
                          </h2>
                          {tasks.filter((t) => t.due === today && !t.completedAt).map(row)}
                        </section>
                        {tasks.some((t) => t.completedAt) && (
                          <section className="task-group">
                            <h2 className="group-title">已完成</h2>
                            {tasks.filter((t) => t.completedAt).map(row)}
                          </section>
                        )}
                      </>
                    ) : (
                      tasks.map(row)
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <span className="paper-line" />
                      <span className="paper-line" />
                      <Check size={28} />
                      <Leaf className="empty-leaf" size={25} />
                    </div>
                    <h2>
                      {query
                        ? '暂时没有找到'
                        : view === 'completed'
                          ? '第一件完成的事，会出现在这里'
                          : view === 'trash'
                            ? '回收站是空的'
                            : view === 'inbox'
                              ? '给一闪而过的想法，留个位置'
                              : '给今天留一件值得完成的事'}
                    </h2>
                    <p>
                      {query
                        ? '试试其他关键词，标题、备注、子任务和标签都可以搜索。'
                        : view === 'trash'
                          ? '删除的任务会保留在这里，方便你随时恢复。'
                          : view === 'completed'
                            ? '从一件很小的事开始，完成后勾选它。'
                            : '不必一下子安排好所有事，从一个小小的行动开始。'}
                    </p>
                    {!data.tasks.length && (
                      <button className="text-button example-button" onClick={examples}>
                        添加入门示例
                        <ChevronRight size={15} />
                      </button>
                    )}
                    {query && (
                      <button className="text-button" onClick={() => setQuery('')}>
                        清除搜索
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {!query && view === 'calendar' && (
              <>
                <Calendar
                  tasks={tasks}
                  selectedDate={calendarDate}
                  onDate={(date) => {
                    setCalendarDate(date);
                    setDraftDue(date);
                    composer.current?.focus();
                  }}
                  onSelect={setSelectedId}
                  onDrop={(id, due) => {
                    store.patchTask(id, { due, repeatDay: Number(due.slice(-2)) });
                    message(`已安排到 ${formatDate(due)}`);
                  }}
                />
                <section className="calendar-day-list">
                  <h2 className="group-title">
                    {formatDate(calendarDate)}
                    <span>{tasks.filter((t) => t.due === calendarDate).length}</span>
                  </h2>
                  {tasks.filter((t) => t.due === calendarDate).map(row)}
                </section>
              </>
            )}
            {!query && view === 'quadrants' && (
              <div className="quadrant-grid">
                {[
                  { title: '重要且紧急', hint: '先把这件事做好', className: 'urgent-important' },
                  { title: '重要不紧急', hint: '留出时间，认真安排', className: 'important' },
                  { title: '紧急不重要', hint: '简化处理，尽快完成', className: 'urgent' },
                  { title: '不紧急不重要', hint: '有余力时，再慢慢来', className: 'someday' },
                ].map((q, index) => (
                  <section className={`quadrant ${q.className}`} key={q.title}>
                    <header>
                      <i />
                      <div>
                        <h2>{q.title}</h2>
                        <p>{q.hint}</p>
                      </div>
                      <span>
                        {tasks.filter((t) => !t.completedAt && quadrant(t, today) === index).length}
                      </span>
                    </header>
                    <div>
                      {tasks.filter((t) => !t.completedAt && quadrant(t, today) === index).map(row)}
                      {!tasks.some((t) => !t.completedAt && quadrant(t, today) === index) && (
                        <p className="quadrant-empty">这里暂时没有任务</p>
                      )}
                    </div>
                  </section>
                ))}
                <p className="quadrant-explainer">高、中优先级视为重要；今天到期及逾期视为紧急。</p>
              </div>
            )}
            {!query && view === 'focus' && (
              <Focus key={focusTask ?? 'free'} preferredTask={focusTask} clock={clock} />
            )}
            {!query && view === 'stats' && <Statistics />}
            {taskScreen && tasks.length > 0 && view !== 'trash' && (
              <p className="list-end">
                <span />
                一步一步，事情会慢慢清晰。
                <span />
              </p>
            )}
          </div>
        </div>
        <footer className="main-footer">
          <span>
            <span className="key-hint">N</span>新建任务<span className="key-hint">/</span>搜索
            <span className="key-hint">Esc</span>返回
          </span>
          <span>时织 · 给生活一点条理</span>
        </footer>
      </main>
      {selectedTask ? (
        <TaskEditor
          id={selectedTask.id}
          onClose={() => setSelectedId(null)}
          onDelete={remove}
          onTrack={async (id) => {
            try {
              await store.transact((s) => {
                if (s.timer) throw new Error('请先结束番茄计时');
                const task = s.tasks.find((t) => t.id === id);
                if (!task) throw new Error('任务不存在');
                const timelog = startTracking(
                  s.timelog,
                  s.timelog.activities.find((a) => !a.archived)?.id ?? '',
                  task!.title,
                  Date.now(),
                );
                timelog.timer!.taskId = id;
                return { ...s, timelog };
              });
              navigate('timelog');
            } catch (e) {
              message(e instanceof Error ? e.message : String(e));
            }
          }}
          onFocus={(id) => {
            setFocusTask(id);
            navigate('focus');
          }}
        />
      ) : (
        view === 'today' &&
        !query && (
          <aside className="rhythm-panel">
            <span className="eyebrow">TODAY, AT YOUR PACE</span>
            <h2>今天的节奏</h2>
            <div
              className="daily-ring"
              style={{
                background: `conic-gradient(var(--accent) ${completion * 3.6}deg, var(--line) 0)`,
              }}
            >
              <div>
                <strong>
                  {completion}
                  <small>%</small>
                </strong>
                <span>今天的安排</span>
              </div>
            </div>
            <p className="rhythm-count">
              已完成 <strong>{todayDone}</strong> / {todayTasks.length} 件
            </p>
            <div className="rhythm-divider" />
            <button className="focus-invitation" onClick={() => navigate('focus')}>
              <span className="focus-invitation-icon">
                <Timer size={24} strokeWidth={1.5} />
              </span>
              <div>
                <h3>{data.timer ? '回到正在进行的专注' : '给自己一段专注时间'}</h3>
                <p>
                  {data.timer
                    ? data.timer.title
                    : `${data.settings.focusMinutes} 分钟，一次只做一件事。`}
                </p>
              </div>
              <ChevronRight size={16} />
            </button>
            <div className="today-summary">
              <span>今日专注</span>
              <strong>
                {statistics(data, today).at(-1)?.minutes ?? 0}
                <small> 分钟</small>
              </strong>
            </div>
            <div className="gentle-note">
              <Leaf size={20} strokeWidth={1.4} />
              <p>
                清单是为了减轻负担，
                <br />
                也记得给自己留白。
              </p>
            </div>
          </aside>
        )
      )}
      {settings && <Settings onClose={() => setSettings(false)} onMessage={message} />}
      {editingList && (
        <ListModal
          list={editingList === 'new' ? undefined : editingList}
          onClose={() => setEditingList(null)}
          onSaved={message}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast.message}</span>
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
          <button className="toast-close" aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
