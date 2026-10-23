import './TimerPanel.css';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, ChevronRight, Pause, Pencil, Play, Plus, X } from 'lucide-react';
import { dateKey, type Task } from '../../model';
import { dateTimeInput, parseDateTimeInput, zoneClock } from '../../timezone';
import {
  activeActivity,
  adjustTimerStart,
  countdownRemaining,
  duration,
  finishTimer,
  formatClock,
  formatPoints,
  liveSpans,
  nextActivity,
  startTimer,
  timestamp,
  toggleTimer,
  natureLabels,
  type Activity,
  type Nature,
  type State,
} from '../domain';
import { lastRecordEnd } from '../timeline';
import { Dialog } from './Dialog';
import { ActivityIcon } from '../../phone/ActivityIcon';
import type { Commit } from './Editor';

export function TimerPanel({
  state,
  tasks,
  now,
  commit,
  editActivity,
  onFinished,
  tagColors,
}: {
  state: State;
  tasks: Task[];
  now: number;
  commit: Commit;
  editActivity: (activity?: Activity, nature?: Nature) => void;
  onFinished: () => void;
  tagColors: Record<string, string>;
}) {
  const timer = state.timer,
    activities = state.activities.filter(activeActivity);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    panel.current?.closest('.phone-content')?.scrollTo(0, 0);
  }, [timer?.id]);
  const [editing, setEditing] = useState<'times' | 'presets' | 'tags' | 'next' | null>(null);
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [exactStart, setExactStart] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState('');
  const [tags, setTags] = useState(''),
    [error, setError] = useState('');
  const presets = state.settings.timerPresets ?? [5, 30, 45, 60];
  const todaysTasks = tasks.filter(
    (task) => !task.deletedAt && !task.completedAt && task.due === dateKey(),
  );
  const tagOptions = [
    ...new Set([
      ...Object.keys(tagColors),
      ...state.records.filter((record) => !record.deletedAt).flatMap((record) => record.tags),
      ...(timer?.tags ?? []),
    ]),
  ];
  const elapsed = timer ? duration(liveSpans(timer, now)) : 0;
  const countdown = timer?.plannedEndAt != null;
  const clock = timer ? (countdown ? countdownRemaining(timer, now) : elapsed) : 0;
  const progress =
    timer && countdown
      ? Math.min(1, elapsed / Math.max(1, elapsed + countdownRemaining(timer, now)))
      : (elapsed / 3600000) % 1;
  const currentActivity = timer
    ? state.activities.find((activity) => activity.id === timer.activityId)
    : undefined;
  const openTimes = () => {
    if (!timer) return;
    chooseStart(timer.startedAt);
    setEnd(timer.plannedEndAt != null ? dateTimeInput(timer.plannedEndAt) : '');
    setError('');
    setEditing('times');
  };
  function chooseStart(at: number) {
    setStart(dateTimeInput(at));
    setExactStart(at);
  }
  const close = () => {
    setEditing(null);
    setError('');
  };
  async function begin(activityId: string) {
    await commit((current) => startTimer(current, activityId, '', Date.now()), '活动已开始');
  }
  async function saveTimes() {
    try {
      const startAt =
          exactStart != null && start === dateTimeInput(exactStart)
            ? exactStart
            : parseDateTimeInput(start),
        endAt = end
          ? timer?.plannedEndAt && end === dateTimeInput(timer.plannedEndAt)
            ? timer.plannedEndAt
            : parseDateTimeInput(end)
          : null,
        at = Date.now();
      if (startAt > at || (endAt != null && endAt <= startAt))
        throw new Error('请检查起止时间：开始不能晚于现在，结束需晚于开始。');
      if (!timer) throw new Error('请先选择活动开始计时。');
      const id = timer.id;
      const saved = await commit((current) => {
        if (current.timer?.id !== id) throw new Error('活动已变化，请重新调整。');
        const adjusted = adjustTimerStart(
          { ...current, timer: { ...current.timer, plannedEndAt: null } },
          startAt,
          at,
        );
        if (endAt != null && endAt <= at) return finishTimer(adjusted, endAt);
        return { ...adjusted, timer: { ...adjusted.timer!, plannedEndAt: endAt } };
      }, '起止时间已更新');
      if (saved) {
        close();
        if (endAt != null && endAt <= at) onFinished();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function choosePreset(value: number | null) {
    if (!timer) return;
    const id = timer.id;
    await commit(
      (current) => {
        if (current.timer?.id !== id) throw new Error('活动已变化。');
        const at =
          current.timer.runningSince === null
            ? (current.timer.spans.at(-1)?.end ?? current.timer.startedAt)
            : Date.now();
        return {
          ...current,
          timer: { ...current.timer, plannedEndAt: value ? at + value * 60000 : null },
        };
      },
      value ? '已切换倒计时' : '已切换正计时',
    );
  }
  const activityGrid = (select: (id: string) => void) => (
    <div className="activity-grid">
      {activities.map((activity) => (
        <ActivityTile key={activity.id} activity={activity} select={() => select(activity.id)} />
      ))}
    </div>
  );
  return (
    <div ref={panel} className={`activity-timer-panel ${timer ? 'timer-session' : 'timer-picker'}`}>
      {timer ? (
        <>
          <section className="timer-focus-card">
            <header className="timer-detail-header">
              <span
                className="timer-current-activity"
                style={{ '--activity-color': currentActivity?.color } as CSSProperties}
              >
                <ActivityIcon name={currentActivity?.name ?? ''} size={22} />
                <h2>{currentActivity?.name}</h2>
              </span>
              <span className="timer-status" data-paused={timer.runningSince === null}>
                <i />
                {timer.runningSince === null ? '已暂停' : countdown ? '倒计时' : '正计时'}
              </span>
            </header>
            <div className="timer-clock-area">
              <div
                className="activity-clock-ring"
                style={{ '--progress': `${progress * 360}deg` } as CSSProperties}
              >
                <div>
                  <span className="timer-clock-caption">{countdown ? '剩余时间' : '已计时'}</span>
                  <strong className="timer-clock" aria-label="计时时长">
                    {formatClock(clock)}
                  </strong>
                  <span className="timer-points">
                    {formatPoints((elapsed / 3600000) * timer.pointsPerHour)}
                    <small> 积分</small>
                  </span>
                  <button
                    className="timer-pause"
                    aria-label={timer.runningSince === null ? '继续' : '暂停'}
                    onClick={() =>
                      void commit(
                        (current) =>
                          current.timer?.id === timer.id
                            ? toggleTimer(current, Date.now())
                            : current,
                        timer.runningSince === null ? '已继续计时' : '已暂停',
                      )
                    }
                  >
                    {timer.runningSince === null ? <Play size={18} /> : <Pause size={18} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="timer-presets" aria-label="倒计时预设">
              <button aria-pressed={!countdown} onClick={() => void choosePreset(null)}>
                正计时
              </button>
              {presets.map((value) => (
                <button
                  key={value}
                  aria-pressed={countdown && Math.abs(clock - value * 60000) < 1000}
                  onClick={() => void choosePreset(value)}
                >
                  {value} min
                </button>
              ))}
              <button
                className="icon-button"
                aria-label="管理倒计时预设"
                onClick={() => setEditing('presets')}
              >
                <Plus size={17} />
              </button>
            </div>
            <button className="timer-time-summary" aria-label="调整起止时间" onClick={openTimes}>
              <span>
                <small>开始</small>
                <strong>{zoneClock(timer.startedAt)}</strong>
              </span>
              <span>
                <small>结束</small>
                <strong>{timer.plannedEndAt ? zoneClock(timer.plannedEndAt) : '未设置'}</strong>
              </span>
              <ChevronRight size={16} />
            </button>
          </section>
          <section className="timer-related">
            <div className="timer-section-title">
              <h3>相关标签</h3>
              <button
                className="icon-button"
                aria-label="编辑活动标签"
                onClick={() => {
                  setTags(timer.tags.join(', '));
                  setEditing('tags');
                }}
              >
                <Plus size={18} />
              </button>
            </div>
            {!!timer.tags.length && (
              <div className="phone-tag-chips">
                {timer.tags.map((tag) => (
                  <span key={tag} style={{ color: tagColors[tag] }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <label className="timer-plan">
              <span>相关计划</span>
              <select
                aria-label="相关计划"
                value={timer.taskId ?? ''}
                onChange={(event) => {
                  const taskId = event.target.value;
                  void commit(
                    (current) =>
                      current.timer?.id === timer.id
                        ? { ...current, timer: { ...current.timer, taskId: taskId || undefined } }
                        : current,
                    '相关计划已更新',
                  );
                }}
              >
                <option value="">不绑定计划</option>
                {todaysTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
                {timer.taskId && !todaysTasks.some((task) => task.id === timer.taskId) && (
                  <option value={timer.taskId}>
                    {tasks.find((task) => task.id === timer.taskId)?.title ?? '原绑定计划'}
                  </option>
                )}
              </select>
            </label>
            <div className="timer-content-label">活动内容</div>
            <div className="timer-content-field">
              <span
                className="timer-content-activity"
                style={{ '--activity-color': currentActivity?.color } as CSSProperties}
              >
                <ActivityIcon name={currentActivity?.name ?? ''} size={25} />
                <small>{currentActivity?.name}</small>
              </span>
              <textarea
                aria-label="计时描述"
                key={`${timer.id}:${timer.note}`}
                defaultValue={timer.note}
                placeholder="描述这段时间做了什么"
                rows={3}
                maxLength={4000}
                onBlur={(event) => {
                  const note = event.target.value.trim();
                  if (note !== timer.note)
                    void commit(
                      (current) =>
                        current.timer?.id === timer.id
                          ? { ...current, timer: { ...current.timer, note } }
                          : current,
                      '',
                    );
                }}
              />
            </div>
          </section>
          <footer className="timer-footer-actions">
            <button
              className="timer-next"
              disabled={elapsed < 1000}
              onClick={() => setEditing('next')}
            >
              下一个活动
              <ArrowRight size={15} />
            </button>
            <button
              className="primary timer-finish"
              disabled={elapsed < 1000}
              onClick={() =>
                void commit(
                  (current) =>
                    current.timer?.id === timer.id ? finishTimer(current, Date.now()) : current,
                  '活动已记录',
                ).then((saved) => {
                  if (saved) onFinished();
                })
              }
            >
              完成
            </button>
            <button
              className="timer-cancel"
              onClick={() =>
                void commit(
                  (current) =>
                    current.timer?.id === timer.id ? { ...current, timer: null } : current,
                  '本次计时已取消',
                )
              }
            >
              取消
            </button>
          </footer>
        </>
      ) : (
        <div className="activity-library">
          <header className="activity-library-heading">
            <div>
              <h2>选择活动</h2>
              <p className="activity-touch-hint">点按开始计时，长按编辑活动</p>
              <p className="activity-pointer-hint">点击开始计时，点击铅笔编辑活动</p>
            </div>
          </header>
          <div className="activity-groups">
            {(['positive', 'neutral', 'negative'] as const).map((nature) => {
              const group = activities.filter((activity) => activity.nature === nature);
              return (
                <section
                  className="activity-group"
                  key={nature}
                  aria-label={`${natureLabels[nature]}活动`}
                >
                  <h3>
                    {natureLabels[nature]}
                    <small>{group.length}</small>
                  </h3>
                  <div className="activity-grid">
                    {group.map((activity) => (
                      <ActivityTile
                        key={activity.id}
                        activity={activity}
                        select={() => void begin(activity.id)}
                        edit={() => editActivity(activity)}
                      />
                    ))}
                    <button
                      className="activity-create"
                      aria-label={`新建${natureLabels[nature]}活动`}
                      onClick={() => editActivity(undefined, nature)}
                    >
                      <Plus size={28} strokeWidth={1.5} />
                      <span>新建活动</span>
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {editing && (
        <Dialog
          title={
            editing === 'times'
              ? '调整起止时间'
              : editing === 'presets'
                ? '倒计时预设'
                : editing === 'next'
                  ? '下一个活动'
                  : '相关标签'
          }
          close={close}
        >
          {editing === 'times' && (
            <div className="editor">
              <label>
                开始时间
                <input
                  type="datetime-local"
                  aria-label="活动开始时间"
                  value={start}
                  onChange={(event) => {
                    setStart(event.target.value);
                    setExactStart(null);
                  }}
                />
              </label>
              <div className="timer-start-shortcuts">
                <button className="secondary" onClick={() => chooseStart(Date.now())}>
                  当前时间
                </button>
                <button
                  className="secondary"
                  disabled={!lastRecordEnd(state, Date.now())}
                  onClick={() => chooseStart(lastRecordEnd(state, Date.now()))}
                >
                  上一条记录末尾
                </button>
              </div>
              <label>
                结束时间（可选）
                <input
                  type="datetime-local"
                  aria-label="活动结束时间"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
              <button className="text-button" onClick={() => setEnd('')}>
                清除结束时间，使用正计时
              </button>
              <p className="footnote">
                晚于现在的结束时间会进入倒计时；早于现在会保存为已结束记录。时间按日程时区计算。
              </p>
              <button className="primary" onClick={() => void saveTimes()}>
                保存起止时间
              </button>
            </div>
          )}
          {editing === 'presets' && (
            <div className="editor">
              <div className="preset-edit-list">
                {presets.map((value) => (
                  <div key={value}>
                    <span>{value} 分钟</span>
                    <button
                      className="icon-button"
                      aria-label={`删除 ${value} 分钟预设`}
                      onClick={() =>
                        void commit(
                          (current) => ({
                            ...current,
                            settings: {
                              ...current.settings,
                              timerPresets: (
                                current.settings.timerPresets ?? [5, 30, 45, 60]
                              ).filter((minute) => minute !== value),
                              updatedAt: timestamp(current.settings.updatedAt),
                            },
                          }),
                          '预设已删除',
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  </div>
                ))}
              </div>
              <label>
                预设分钟
                <input
                  aria-label="预设分钟"
                  type="number"
                  min="1"
                  max="10080"
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                />
              </label>
              <button
                className="primary"
                onClick={() => {
                  const value = Number(customMinutes);
                  if (!Number.isInteger(value) || value < 1 || value > 10080) {
                    setError('请输入 1 至 10080 的整数分钟');
                    return;
                  }
                  void commit(
                    (current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        timerPresets: [
                          ...new Set([
                            ...(current.settings.timerPresets ?? [5, 30, 45, 60]),
                            value,
                          ]),
                        ].sort((a, b) => a - b),
                        updatedAt: timestamp(current.settings.updatedAt),
                      },
                    }),
                    '预设已添加',
                  ).then((saved) => {
                    if (saved) {
                      setCustomMinutes('');
                      setError('');
                    }
                  });
                }}
              >
                添加预设
              </button>
            </div>
          )}
          {editing === 'tags' && (
            <div className="editor">
              <label>
                相关标签
                <input
                  aria-label="计时标签"
                  value={tags}
                  placeholder="用逗号分隔"
                  onChange={(event) => setTags(event.target.value)}
                />
              </label>
              <div className="phone-tag-chips">
                {tagOptions.map((tag) => (
                  <button
                    style={{ color: tagColors[tag] }}
                    key={tag}
                    onClick={() =>
                      setTags(
                        [
                          ...new Set([
                            ...tags
                              .split(/[,，]/)
                              .map((value) => value.trim())
                              .filter(Boolean),
                            tag,
                          ]),
                        ].join(', '),
                      )
                    }
                  >
                    #{tag}
                  </button>
                ))}
              </div>
              <button
                className="primary"
                onClick={() => {
                  const values = [
                    ...new Set(
                      tags
                        .split(/[,，]/)
                        .map((tag) => tag.trim().replace(/^#/, ''))
                        .filter(Boolean),
                    ),
                  ];
                  void commit(
                    (current) =>
                      current.timer?.id === timer?.id
                        ? { ...current, timer: { ...current.timer!, tags: values } }
                        : current,
                    '标签已更新',
                  ).then((saved) => {
                    if (saved) close();
                  });
                }}
              >
                保存标签
              </button>
            </div>
          )}
          {editing === 'next' && (
            <>
              <p className="section-note">选择下一项后，当前活动会记录并在同一时刻衔接下一项。</p>
              {activityGrid((id) => {
                const at = Date.now();
                void commit((current) => {
                  if (current.timer?.id !== timer?.id) throw new Error('活动已变化');
                  return nextActivity(current, id, at);
                }, '已衔接下一项活动').then((saved) => {
                  if (saved) close();
                });
              })}
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}

/** Touch hold opens immediately; mouse editing uses a visible action or context menu. */
function ActivityTile({
  activity,
  select,
  edit,
}: {
  activity: Activity;
  select: () => void;
  edit?: () => void;
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const consumed = useRef(false);
  const releaseGuard = useRef<(() => void) | null>(null);
  const clear = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    pointer.current = null;
  };
  useEffect(
    () => () => {
      clear();
      releaseGuard.current?.();
    },
    [],
  );
  return (
    <div className="activity-tile-wrap">
      <button
        className="activity-tile"
        style={{ '--activity-color': activity.color } as CSSProperties}
        aria-label={`开始 ${activity.name}`}
        aria-description={edit ? '触屏长按，或使用编辑按钮、右键、F2 编辑活动' : undefined}
        onPointerDown={(event) => {
          clear();
          consumed.current = false;
          if (!edit || event.button !== 0 || event.pointerType === 'mouse') return;
          const pointerId = event.pointerId;
          pointer.current = { x: event.clientX, y: event.clientY };
          hold.current = setTimeout(() => {
            consumed.current = true;
            hold.current = null;
            // showModal makes this tile inert and releases pointer capture. Guard
            // the rest of this gesture before it can reach the new modal/backdrop.
            const dispose = () => {
              document.removeEventListener('pointerup', stopRelease, true);
              document.removeEventListener('click', stopClick, true);
              document.removeEventListener('pointerdown', dispose, true);
              releaseGuard.current = null;
            };
            const stopRelease = (event: PointerEvent) => {
              if (event.pointerId !== pointerId) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              clear();
            };
            const stopClick = (event: MouseEvent) => {
              if (event instanceof PointerEvent && event.pointerId !== pointerId) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              dispose();
            };
            releaseGuard.current?.();
            releaseGuard.current = dispose;
            document.addEventListener('pointerup', stopRelease, true);
            document.addEventListener('click', stopClick, true);
            // Some browsers suppress the compatibility click. The next genuine
            // pointer gesture ends the guard before interacting with the editor.
            document.addEventListener('pointerdown', dispose, true);
            edit();
          }, 450);
        }}
        onPointerMove={(event) => {
          if (
            pointer.current &&
            Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 9
          ) {
            consumed.current = true;
            clear();
          }
        }}
        onPointerUp={(event) => {
          if (consumed.current) event.preventDefault();
          clear();
        }}
        onTouchEnd={(event) => {
          // Pointer release is not enough: the original touch also bubbles to
          // the page swipe handler after the modal has opened.
          if (releaseGuard.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPointerCancel={() => {
          consumed.current = true;
          clear();
        }}
        onPointerLeave={clear}
        onContextMenu={(event) => {
          if (edit) {
            event.preventDefault();
            consumed.current = true;
            if (pointer.current) return;
            clear();
            edit();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') consumed.current = false;
          if (edit && (event.key === 'F2' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault();
            edit();
          }
        }}
        onClick={() => {
          if (consumed.current) {
            consumed.current = false;
            return;
          }
          select();
        }}
      >
        <span className="activity-mark">
          <ActivityIcon name={activity.name} size={26} />
        </span>
        <span className="activity-text">
          <strong>{activity.name}</strong>
        </span>
      </button>
      {edit && (
        <button
          className="activity-edit"
          aria-label={`编辑 ${activity.name}`}
          title="编辑活动"
          onClick={edit}
        >
          <Pencil size={15} />
        </button>
      )}
    </div>
  );
}
