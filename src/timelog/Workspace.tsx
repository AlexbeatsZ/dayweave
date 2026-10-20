import { getTimeZone } from '../timezone';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  List,
  Moon,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Square,
  Sun,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import {
  clipped,
  dayKey,
  dayRange,
  dayStart,
  duration,
  finishTimer,
  formatClock,
  formatDuration,
  formatPoints,
  formatTime,
  goalProgress,
  liveSpans,
  natureLabels,
  recordPoints,
  recordsIn,
  shiftDay,
  startTimer,
  stats,
  timestamp,
  toggleTimer,
  type State,
  type TimeRecord,
} from './domain';
import { download, mutateState, readRawStorage, readState, subscribe } from './storage';
import {
  adjacentGap,
  buildTimeline,
  fillAdjacentGap,
  lastRecordEnd,
  type TimelineEntry,
} from './timeline';
import { useTheme } from './theme';
import { Dialog } from './components/Dialog';
import { Editor, type EditTarget } from './components/Editor';
import { Settings } from './components/Settings';
type Page = 'timeline' | 'timer' | 'goals' | 'analysis';
type Confirm = { title: string; body: string; action: () => Promise<boolean> };
const panels = [
  { id: 'timeline', name: '时间线', icon: History },
  { id: 'timer', name: '计时', icon: Clock3 },
  { id: 'goals', name: '目标', icon: Target },
  { id: 'analysis', name: '分析', icon: BarChart3 },
] as const;
const activityStyle = (color: string) => ({ '--activity-color': color }) as CSSProperties;
const points = (value: number) => `${value > 0 ? '+' : ''}${formatPoints(value)}`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function Workspace() {
  const [state, setState] = useState<State | null>(null),
    [loadError, setLoadError] = useState(''),
    [page, setPage] = useState<Page>('timeline'),
    [date, setDate] = useState(dayKey(Date.now())),
    [now, setNow] = useState(Date.now());
  const [editor, setEditor] = useState<EditTarget | null>(null),
    [settings, setSettings] = useState(false),
    [manage, setManage] = useState(false),
    [confirmation, setConfirmation] = useState<Confirm | null>(null),
    [focus, setFocus] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null),
    [query, setQuery] = useState(''),
    [fromPrevious, setFromPrevious] = useState(false),
    [days, setDays] = useState(7),
    [shortGaps, setShortGaps] = useState(() => {
      try {
        return localStorage.getItem('timelog-short-gaps') === 'true';
      } catch {
        return false;
      }
    });
  const [selectedActivity, setSelectedActivity] = useState('study'),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    noteInput = useRef<HTMLTextAreaElement>(null),
    theme = useTheme();
  useEffect(() => {
    let live = true;
    const refresh = () =>
      readState()
        .then((next) => {
          if (live) {
            setState(next);
            setLoadError('');
          }
        })
        .catch((error) => {
          if (live) setLoadError(errorText(error));
        });
    refresh();
    const off = subscribe(refresh);
    window.addEventListener('timelog-resume', refresh);
    return () => {
      live = false;
      off();
      window.removeEventListener('timelog-resume', refresh);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 10000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (editor || settings || confirmation)
      document.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'));
  }, [editor, settings, confirmation]);
  useEffect(() => {
    document.title = state?.timer
      ? `${formatClock(duration(liveSpans(state.timer, now)))} · 时织`
      : '时织 · Dayweave';
  }, [state?.timer, now]);
  async function commit(transform: (current: State) => State, message = '已保存') {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      setState(await mutateState(transform));
      setNow(Date.now());
      if (message) setNotice({ text: message, error: false });
      return true;
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (loadError)
    return (
      <main className="loading">
        <h1>暂时无法读取数据</h1>
        <p>{loadError}</p>
        <p>原始数据已保留，请先导出恢复文件。</p>
        <button
          className="primary"
          onClick={() =>
            readRawStorage()
              .then((raw) => download('open-timelog-recovery.json', raw))
              .catch((error) => setNotice({ text: errorText(error), error: true }))
          }
        >
          导出恢复文件
        </button>
        {notice && <p role="alert">{notice.text}</p>}
      </main>
    );
  if (!state)
    return (
      <main className="loading">
        <Clock3 />
        <p>正在打开时间记录…</p>
      </main>
    );
  const getActivity = (id: string) => state.activities.find((row) => row.id === id)!;
  const timer = state.timer,
    active = state.activities.filter((row) => !row.archived),
    timerMs = timer ? duration(liveSpans(timer, now)) : 0;
  const entries = buildTimeline(state, date, now, shortGaps),
    daily = stats(state, dayRange(date));
  const activityQuery = query.toLocaleLowerCase();
  const shownEntries = entries.filter(
    (row) =>
      !query ||
      (row.kind === 'record' &&
        `${getActivity(row.record.activityId).name} ${row.record.note} ${row.record.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(activityQuery)),
  );
  const endText = (at: number) => (at === dayRange(date).end ? '24:00' : formatTime(at));
  function datePicker() {
    return (
      <div className="date-picker">
        <button
          className="icon-button"
          aria-label="前一天"
          onClick={() => setDate(shiftDay(date, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <input
          aria-label="查看日期"
          type="date"
          value={date}
          onChange={(event) => {
            if (event.target.value) setDate(event.target.value);
          }}
        />
        <button
          className="icon-button"
          aria-label="后一天"
          onClick={() => setDate(shiftDay(date, 1))}
        >
          <ChevronRight size={18} />
        </button>
        {date !== dayKey(now) && (
          <button className="text-button" onClick={() => setDate(dayKey(now))}>
            今天
          </button>
        )}
      </div>
    );
  }
  async function begin(activityId: string) {
    const saved = await commit((current) => {
      const at = fromPrevious ? lastRecordEnd(current, Date.now()) : Date.now();
      if (!at) throw new Error('没有上条记录，请先添加记录。');
      return startTimer(current, activityId, '', at);
    }, '计时已开始');
    if (saved) {
      setSelectedActivity(activityId);
      setPage('timer');
      setFromPrevious(false);
    }
  }
  async function stop() {
    if (!timer) return;
    const id = timer.id,
      note = noteInput.current?.value.trim();
    if (
      await commit((current) => {
        if (current.timer?.id !== id) throw new Error('计时已变化，请重新查看。');
        return finishTimer(
          { ...current, timer: { ...current.timer, note: note ?? current.timer.note } },
          Date.now(),
        );
      }, '计时已加入时间线')
    ) {
      setFocus(false);
      setDate(dayKey(Date.now()));
      setPage('timeline');
    }
  }
  function timerControls() {
    return (
      <div className="timer-controls">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (timer)
              commit(
                (current) => {
                  if (
                    current.timer?.id !== timer.id ||
                    current.timer.runningSince !== timer.runningSince
                  )
                    throw new Error('计时已在其他窗口更新。');
                  return toggleTimer(current, Date.now());
                },
                timer.runningSince === null ? '已继续计时' : '已暂停',
              );
          }}
        >
          {timer?.runningSince === null ? <Play size={18} /> : <Pause size={18} />}{' '}
          {timer?.runningSince === null ? '继续' : '暂停'}
        </button>
        <button className="primary" disabled={busy} onClick={stop}>
          <Square size={16} />
          结束并保存
        </button>
      </div>
    );
  }
  function requestFill(row: Extract<TimelineEntry, { kind: 'record' }>, direction: 'up' | 'down') {
    const gap = adjacentGap(entries, row, direction);
    if (!gap) return;
    setConfirmation({
      title: `填满${direction === 'up' ? '上方' : '下方'}空闲时间`,
      body: `将「${getActivity(row.record.activityId).name}」延长 ${formatDuration(gap.end - gap.start)}（${formatTime(gap.start)}–${endText(gap.end)}）。`,
      action: () =>
        commit(
          (current) =>
            fillAdjacentGap(
              current,
              row.record.id,
              row.spanIndex,
              row.record.updatedAt,
              date,
              direction,
              Date.now(),
            ),
          '已填满空闲时间',
        ),
    });
  }
  function renderRecord(row: Extract<TimelineEntry, { kind: 'record' }>) {
    const record = row.record,
      activity = getActivity(record.activityId),
      up = adjacentGap(entries, row, 'up'),
      down = adjacentGap(entries, row, 'down');
    return (
      <article
        className="record-card"
        style={activityStyle(activity.color)}
        data-record-id={record.id}
      >
        <div className="card-main">
          <span className="activity-mark">{activity.name.slice(0, 1)}</span>
          <div className="card-content">
            <h3>
              {activity.name}
              <span className={`nature ${record.nature}`}>{natureLabels[record.nature]}</span>
            </h3>
            {record.note && <p className="record-note">{record.note}</p>}
            {!!record.tags.length && (
              <div className="tags">
                {record.tags.map((tag, index) => (
                  <span key={index}>#{tag}</span>
                ))}
              </div>
            )}
            <div className="card-meta">
              <span>
                {formatTime(row.start)}–{endText(row.end)}
              </span>
              <span>{formatDuration(row.end - row.start)}</span>
              <span className={record.pointsPerHour < 0 ? 'negative-text' : 'positive-text'}>
                {points(((row.end - row.start) / 3600000) * record.pointsPerHour)} 分
              </span>
              {record.spans.length > 1 && <span>第 {row.spanIndex + 1} 段</span>}
            </div>
          </div>
          <details className="card-menu">
            <summary aria-label={`记录操作 ${activity.name}`}>
              <MoreHorizontal size={20} />
            </summary>
            <div>
              <button onClick={() => setEditor({ kind: 'record', record })}>
                <Pencil size={14} />
                编辑记录
              </button>
              <button
                className="danger"
                onClick={() =>
                  setConfirmation({
                    title: '删除记录',
                    body: `删除「${activity.name}」${formatDuration(duration(record.spans))} 的记录？可在设置中恢复。`,
                    action: () =>
                      commit((current) => {
                        const latest = current.records.find((item) => item.id === record.id);
                        if (latest?.updatedAt !== record.updatedAt)
                          throw new Error('记录已更新，请重新查看。');
                        return {
                          ...current,
                          records: current.records.map((item) =>
                            item.id === record.id
                              ? {
                                  ...item,
                                  deletedAt: Date.now(),
                                  updatedAt: timestamp(item.updatedAt),
                                }
                              : item,
                          ),
                        };
                      }, '记录已删除，可在设置中恢复'),
                  })
                }
              >
                <Trash2 size={14} />
                删除记录
              </button>
            </div>
          </details>
        </div>
        {(up || down) && (
          <div className="fill-actions">
            {up && (
              <button
                aria-label={`填满上方空闲时间 ${activity.name}`}
                onClick={() => requestFill(row, 'up')}
              >
                <ArrowUp size={13} />
                填满上方空闲
              </button>
            )}
            {down && (
              <button
                aria-label={`填满下方空闲时间 ${activity.name}`}
                onClick={() => requestFill(row, 'down')}
              >
                <ArrowDown size={13} />
                填满下方空闲
              </button>
            )}
          </div>
        )}
      </article>
    );
  }
  return (
    <div className="workspace-shell">
      <aside className="navigation">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <strong>时迹</strong>
        </div>
        <nav aria-label="主导航">
          {panels.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => {
                setPage(id);
                setQuery('');
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === 'timer' && timer && <i className="running-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <button aria-label="设置与数据" onClick={() => setSettings(true)}>
            <Settings2 size={18} />
            <span>设置</span>
          </button>
          <small>v{'0.3.0'}</small>
        </div>
      </aside>
      <main className="main">
        <header className="page-header">
          <h1>{panels.find((row) => row.id === page)?.name}</h1>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label={theme.resolved === 'dark' ? '切换到浅色模式' : '切换到暗色模式'}
              onClick={() => theme.choose(theme.resolved === 'dark' ? 'light' : 'dark')}
            >
              {theme.resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-button mobile-settings"
              aria-label="设置与数据"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </button>
            <span className="saved-indicator">
              <Check size={13} />
              {busy ? '保存中' : '已保存'}
            </span>
          </div>
        </header>
        <div className={`panel-content ${page}`}>
          {page === 'timeline' && (
            <>
              <div className="panel-toolbar">
                {datePicker()}
                <button
                  className="primary"
                  disabled={date > dayKey(now)}
                  onClick={() => {
                    const end = Math.min(Date.now(), dayRange(date).end);
                    setEditor({
                      kind: 'record',
                      activityId: selectedActivity,
                      range: { start: Math.max(dayStart(date), end - 1800000), end },
                    });
                  }}
                >
                  <Plus size={16} />
                  添加记录
                </button>
              </div>
              <div className="timeline-summary">
                <span>
                  已记录 <strong>{formatDuration(daily.tracked)}</strong>
                </span>
                <span>
                  积极 <strong>{formatDuration(daily.positive)}</strong>
                </span>
                <span>
                  积分 <strong>{points(daily.points)}</strong>
                </span>
                <span className="weekday">
                  {new Date(dayStart(date)).toLocaleDateString('zh-CN', {
                    timeZone: getTimeZone(),
                    weekday: 'long',
                  })}
                </span>
              </div>
              {timer && (
                <button className="active-timer-strip" onClick={() => setPage('timer')}>
                  <span className="running-dot" />
                  <strong>{getActivity(timer.activityId).name}</strong>
                  <span>{timer.runningSince === null ? '已暂停' : '计时中'}</span>
                  <time>{formatClock(timerMs)}</time>
                  <ChevronRight size={16} />
                </button>
              )}
              <div className="timeline-options">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="搜索记录"
                    placeholder="搜索活动、描述或标签"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={shortGaps}
                    onChange={(event) => {
                      setShortGaps(event.target.checked);
                      try {
                        localStorage.setItem('timelog-short-gaps', String(event.target.checked));
                      } catch {}
                    }}
                  />
                  显示不足一分钟空闲
                </label>
              </div>
              <div className="timeline-list">
                {shownEntries.length ? (
                  shownEntries.map((row) => (
                    <div key={row.key} className={`timeline-entry ${row.kind}`}>
                      <div className="time-rail">
                        <time>{endText(row.end)}</time>
                        <span />
                        {<time>{formatTime(row.start)}</time>}
                      </div>
                      <div className="entry-body">
                        {row.kind === 'gap' ? (
                          <button
                            className="gap-card"
                            aria-label={`添加空闲记录 ${formatTime(row.start)}-${endText(row.end)}`}
                            onClick={() =>
                              setEditor({
                                kind: 'record',
                                range: { start: row.start, end: row.end },
                                activityId: selectedActivity,
                              })
                            }
                          >
                            <Plus size={17} />
                            <span>
                              空闲 <strong>{formatDuration(row.end - row.start)}</strong>
                            </span>
                            <span className="gap-hint">点击添加记录</span>
                          </button>
                        ) : row.kind === 'timer' ? (
                          <button className="timer-card" onClick={() => setPage('timer')}>
                            <span className="running-dot" />
                            正在计时 · {timer && getActivity(timer.activityId).name}
                            <span>{formatDuration(row.end - row.start)}</span>
                          </button>
                        ) : (
                          renderRecord(row)
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <History size={28} />
                    <p>{query ? '没有匹配记录' : '这个日期还没有可记录的时间'}</p>
                  </div>
                )}
              </div>
            </>
          )}
          {page === 'timer' &&
            (timer ? (
              <section className="timer-detail">
                <div className="timer-detail-header">
                  <span className={`nature ${timer.nature}`}>{natureLabels[timer.nature]}</span>
                  <span className="timer-state">
                    {timer.runningSince === null ? '已暂停' : '计时中'}
                  </span>
                </div>
                <h2>{getActivity(timer.activityId).name}</h2>
                <strong className="timer-clock" aria-label="计时时长">
                  {formatClock(timerMs)}
                </strong>
                <p className="timer-start">
                  {formatTime(timer.startedAt)} 开始 ·{' '}
                  {points((timerMs / 3600000) * timer.pointsPerHour)} 积分
                </p>
                <textarea
                  ref={noteInput}
                  key={`${timer.id}:${timer.note}`}
                  aria-label="计时描述"
                  placeholder="添加描述…"
                  defaultValue={timer.note}
                  maxLength={4000}
                  onBlur={(event) => {
                    const note = event.target.value.trim();
                    if (note !== timer.note)
                      mutateState((current) => {
                        if (current.timer?.id !== timer.id) throw new Error('计时已结束。');
                        return { ...current, timer: { ...current.timer, note } };
                      }).catch((error) => setNotice({ text: errorText(error), error: true }));
                  }}
                />
                {timerControls()}
                <div className="timer-secondary">
                  <button className="text-button" onClick={() => setFocus(true)}>
                    专注模式
                  </button>
                  <button
                    className="text-button muted"
                    onClick={() =>
                      setConfirmation({
                        title: '放弃本次计时',
                        body: '这次计时不会生成时间记录。',
                        action: () =>
                          commit((current) => {
                            if (current.timer?.id !== timer.id) throw new Error('计时已变化。');
                            return { ...current, timer: null };
                          }, '已放弃计时'),
                      })
                    }
                  >
                    放弃
                  </button>
                </div>
                <p className="footnote">关闭应用后保留计时，暂停期间不计入。</p>
              </section>
            ) : (
              <>
                <div className="panel-toolbar">
                  <p className="muted">选择一个活动开始计时</p>
                  <button className="secondary" onClick={() => setManage(true)}>
                    <List size={16} />
                    管理活动
                  </button>
                </div>
                <label className="check-label timer-previous">
                  <input
                    type="checkbox"
                    checked={fromPrevious}
                    disabled={!lastRecordEnd(state, now)}
                    onChange={(event) => setFromPrevious(event.target.checked)}
                  />
                  从上条记录结束开始{' '}
                  {lastRecordEnd(state, now) > 0 && (
                    <span className="muted">{formatTime(lastRecordEnd(state, now))}</span>
                  )}
                </label>
                <div className="activity-grid">
                  {active.map((activity) => (
                    <button
                      key={activity.id}
                      className="activity-tile"
                      style={activityStyle(activity.color)}
                      disabled={busy}
                      onClick={() => begin(activity.id)}
                    >
                      <span className="activity-mark">{activity.name.slice(0, 1)}</span>
                      <span className="activity-text">
                        <strong>{activity.name}</strong>
                        <small>
                          {natureLabels[activity.nature]} · {points(activity.pointsPerHour)} 分/小时
                        </small>
                      </span>
                      <Play size={18} />
                    </button>
                  ))}
                </div>
                {!active.length && (
                  <button className="secondary" onClick={() => setEditor({ kind: 'activity' })}>
                    添加第一个活动
                  </button>
                )}
              </>
            ))}
          {page === 'goals' && (
            <>
              <div className="panel-toolbar">
                {datePicker()}
                <button className="primary" onClick={() => setEditor({ kind: 'goal' })}>
                  <Plus size={16} />
                  添加目标
                </button>
              </div>
              <p className="section-note">进度来自已保存的记录，每周从周一开始。</p>
              <div className="goal-grid">
                {state.goals
                  .filter((row) => !row.archived)
                  .map((goal) => {
                    const progress = goalProgress(state, goal, date),
                      percent = Math.min(100, (progress / goal.minutes) * 100),
                      activity = getActivity(goal.activityId);
                    return (
                      <article
                        className="goal-card"
                        key={goal.id}
                        style={activityStyle(activity.color)}
                      >
                        <div className="goal-header">
                          <div>
                            <span className="period-badge">
                              {goal.period === 'day' ? '每日' : '每周'}
                            </span>
                            <h3>{goal.name}</h3>
                            <p>{activity.name}</p>
                          </div>
                          <button
                            className="icon-button"
                            aria-label={`编辑目标 ${goal.name}`}
                            onClick={() => setEditor({ kind: 'goal', goal })}
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                        <div className="goal-numbers">
                          <strong>
                            {Math.floor(progress)}
                            <small> / {goal.minutes} 分钟</small>
                          </strong>
                          <span>
                            {percent >= 100 ? (
                              <>
                                <Check size={15} />
                                已达标
                              </>
                            ) : (
                              `${Math.floor(percent)}%`
                            )}
                          </span>
                        </div>
                        <div className="progress-track">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <footer>
                          <span>
                            {percent >= 100
                              ? '目标已完成'
                              : `还需 ${Math.ceil(Math.max(0, goal.minutes - progress))} 分钟`}
                          </span>
                          <button
                            className="text-button muted"
                            onClick={() =>
                              commit(
                                (current) => ({
                                  ...current,
                                  goals: current.goals.map((row) =>
                                    row.id === goal.id
                                      ? {
                                          ...row,
                                          archived: true,
                                          updatedAt: timestamp(row.updatedAt),
                                        }
                                      : row,
                                  ),
                                }),
                                '目标已归档',
                              )
                            }
                          >
                            归档
                          </button>
                        </footer>
                      </article>
                    );
                  })}
              </div>
              {!state.goals.some((row) => !row.archived) && (
                <div className="empty-state">
                  <Target size={28} />
                  <p>还没有目标</p>
                  <button className="secondary" onClick={() => setEditor({ kind: 'goal' })}>
                    添加目标
                  </button>
                </div>
              )}
            </>
          )}
          {page === 'analysis' &&
            (() => {
              const keys = Array.from({ length: days }, (_, index) =>
                  shiftDay(date, index - days + 1),
                ),
                range = { start: dayStart(keys[0]), end: dayRange(date).end },
                total = stats(state, range);
              const daily = keys.map((key) => ({ date: key, ...stats(state, dayRange(key)) })),
                max = Math.max(3600000, ...daily.map((row) => row.tracked));
              const breakdown = state.activities
                .map((activity) => {
                  const rows = recordsIn(state, range).filter(
                    (row) => row.activityId === activity.id,
                  );
                  return {
                    ...activity,
                    ms: rows.reduce((sum, row) => sum + duration(clipped(row.spans, range)), 0),
                    points: rows.reduce((sum, row) => sum + recordPoints(row, range), 0),
                  };
                })
                .filter((row) => row.ms > 0)
                .sort((a, b) => b.ms - a.ms);
              return (
                <>
                  <div className="panel-toolbar">
                    {datePicker()}
                    <div className="segmented">
                      {[1, 7, 30].map((value) => (
                        <button
                          key={value}
                          className={days === value ? 'selected' : ''}
                          onClick={() => setDays(value)}
                        >
                          {value === 1 ? '当日' : `近 ${value} 天`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="analysis-summary">
                    <div>
                      <span>记录时长</span>
                      <strong>{formatDuration(total.tracked)}</strong>
                    </div>
                    <div>
                      <span>积极时长</span>
                      <strong>{formatDuration(total.positive)}</strong>
                    </div>
                    <div>
                      <span>积分</span>
                      <strong>{points(total.points)}</strong>
                    </div>
                    <div>
                      <span>记录数</span>
                      <strong>
                        {total.count}
                        <small> 条</small>
                      </strong>
                    </div>
                  </div>
                  <section className="analysis-card">
                    <h3>时间分布</h3>
                    <div className={`bar-chart days-${days}`} role="img" aria-label="每日记录时长">
                      {daily.map((row) => (
                        <button
                          key={row.date}
                          title={`${row.date} ${formatDuration(row.tracked)}`}
                          onClick={() => {
                            setDate(row.date);
                            setPage('timeline');
                          }}
                        >
                          <div>
                            <span style={{ height: `${(row.tracked / max) * 100}%` }} />
                          </div>
                          <small>{row.date.slice(5).replace('-', '/')}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="analysis-card">
                    <h3>活动统计</h3>
                    {breakdown.length ? (
                      <table className="activity-stats">
                        <thead>
                          <tr>
                            <th>活动</th>
                            <th>时长</th>
                            <th>积分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdown.map((row) => (
                            <tr key={row.id}>
                              <td>
                                <i style={{ background: row.color }} />
                                {row.name}
                              </td>
                              <td>{formatDuration(row.ms)}</td>
                              <td className={row.points < 0 ? 'negative-text' : 'positive-text'}>
                                {points(row.points)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="empty-state">这个时段还没有记录。</p>
                    )}
                  </section>
                  <p className="footnote">总时长合并重叠区间；活动时长和积分按各条记录累计。</p>
                </>
              );
            })()}
        </div>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {settings && (
        <Settings state={state} date={date} commit={commit} close={() => setSettings(false)} />
      )}
      {editor && (
        <Editor
          key={JSON.stringify(editor)}
          target={editor}
          state={state}
          commit={commit}
          close={() => setEditor(null)}
        />
      )}
      {manage && (
        <Dialog title="管理活动" close={() => setManage(false)}>
          <div className="activity-management">
            <button className="primary" onClick={() => setEditor({ kind: 'activity' })}>
              <Plus size={16} />
              添加活动
            </button>
            {state.activities.map((activity) => (
              <div className="setting-row" key={activity.id}>
                <span>
                  <i style={{ background: activity.color }} />
                  {activity.name}
                  <small>
                    {natureLabels[activity.nature]} · {points(activity.pointsPerHour)} 分/小时
                    {activity.archived ? ' · 已归档' : ''}
                  </small>
                </span>
                <div className="inline-actions">
                  <button
                    className="icon-button"
                    aria-label={`编辑活动 ${activity.name}`}
                    onClick={() => setEditor({ kind: 'activity', activity })}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="text-button muted"
                    disabled={timer?.activityId === activity.id}
                    onClick={() =>
                      commit(
                        (current) => ({
                          ...current,
                          activities: current.activities.map((row) =>
                            row.id === activity.id
                              ? {
                                  ...row,
                                  archived: !row.archived,
                                  updatedAt: timestamp(row.updatedAt),
                                }
                              : row,
                          ),
                        }),
                        activity.archived ? '活动已恢复' : '活动已归档',
                      )
                    }
                  >
                    {activity.archived ? '恢复' : '归档'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {confirmation && (
        <Dialog title={confirmation.title} close={() => setConfirmation(null)}>
          <p className="confirm-body">{confirmation.body}</p>
          <footer className="dialog-actions">
            <button className="secondary" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await confirmation.action()) setConfirmation(null);
              }}
            >
              确认
            </button>
          </footer>
        </Dialog>
      )}
      {focus && timer && (
        <Dialog title="专注模式" close={() => setFocus(false)} wide>
          <div className="focus-content">
            <h2>{getActivity(timer.activityId).name}</h2>
            <strong className="timer-clock">{formatClock(timerMs)}</strong>
            <p>{timer.note}</p>
            {timerControls()}
          </div>
        </Dialog>
      )}
    </div>
  );
}
