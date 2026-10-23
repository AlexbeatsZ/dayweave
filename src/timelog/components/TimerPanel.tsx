import './TimerPanel.css';
import { useState } from 'react';
import { ArrowRight, Clock3, List, Pause, Play, Plus, Settings2, Square, X } from 'lucide-react';
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
  manage,
  onFinished,
  tagColors,
}: {
  state: State;
  tasks: Task[];
  now: number;
  commit: Commit;
  manage: () => void;
  onFinished: () => void;
  tagColors: Record<string, string>;
}) {
  const timer = state.timer,
    activities = state.activities.filter(activeActivity);
  const [editing, setEditing] = useState<'times' | 'presets' | 'tags' | 'next' | null>(null);
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [exactStart, setExactStart] = useState<number | null>(null);
  const [pendingStart, setPendingStart] = useState<number | null>(null),
    [pendingEnd, setPendingEnd] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null),
    [customMinutes, setCustomMinutes] = useState('');
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
  const clock = timer
    ? countdown
      ? countdownRemaining(timer, now)
      : elapsed
    : (minutes ?? 0) * 60000;
  const progress =
    timer && countdown
      ? Math.min(1, elapsed / Math.max(1, elapsed + countdownRemaining(timer, now)))
      : 0;
  const openTimes = () => {
    chooseStart(timer?.startedAt ?? pendingStart ?? Date.now());
    setEnd(
      timer?.plannedEndAt != null
        ? dateTimeInput(timer.plannedEndAt)
        : pendingEnd
          ? dateTimeInput(pendingEnd)
          : '',
    );
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
    const at = Date.now(),
      startAt = pendingStart ?? at,
      endAt = pendingEnd ?? (minutes ? at + minutes * 60000 : null);
    const saved = await commit((current) => {
      const next = startTimer(current, activityId, '', startAt, {
        plannedEndAt: endAt != null && endAt > at ? endAt : null,
      });
      return endAt != null && endAt <= at ? finishTimer(next, endAt) : next;
    }, '活动已开始');
    if (saved) {
      setPendingStart(null);
      setPendingEnd(null);
    }
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
      if (!timer) {
        setPendingStart(startAt);
        setPendingEnd(endAt);
        setMinutes(null);
        close();
        return;
      }
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
    if (!timer) {
      setMinutes(value);
      setPendingEnd(null);
      return;
    }
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
        <button
          key={activity.id}
          className="activity-tile"
          style={{ '--activity-color': activity.color } as React.CSSProperties}
          onClick={() => select(activity.id)}
        >
          <span className="activity-mark">
            <ActivityIcon name={activity.name} />
          </span>
          <span className="activity-text">
            <strong>{activity.name}</strong>
          </span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="activity-timer-panel">
      <div className="timer-presets" aria-label="倒计时预设">
        <button
          aria-pressed={!countdown && !minutes && !pendingEnd}
          onClick={() => void choosePreset(null)}
        >
          正计时
        </button>
        {presets.map((value) => (
          <button
            key={value}
            aria-pressed={!timer && minutes === value}
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
          <Plus size={18} />
        </button>
      </div>
      {timer ? (
        <>
          <section className="timer-detail">
            <div className="timer-detail-header">
              <span>
                {countdown ? '倒计时' : '正计时'} ·{' '}
                {timer.runningSince === null ? '已暂停' : '进行中'}
              </span>
              <button className="icon-button" aria-label="调整起止时间" onClick={openTimes}>
                <Settings2 size={19} />
              </button>
            </div>
            <h2>{state.activities.find((activity) => activity.id === timer.activityId)?.name}</h2>
            <div
              className="activity-clock-ring"
              style={{ '--progress': `${progress * 360}deg` } as React.CSSProperties}
            >
              <div>
                <strong className="timer-clock" aria-label="计时时长">
                  {formatClock(clock)}
                </strong>
                <span>{formatPoints((elapsed / 3600000) * timer.pointsPerHour)} 积分</span>
              </div>
            </div>
            <button className="timer-time-summary" onClick={openTimes}>
              <span>开始 {zoneClock(timer.startedAt)}</span>
              <span>
                {timer.plannedEndAt ? `结束 ${zoneClock(timer.plannedEndAt)}` : '设置结束时间'}
                <Clock3 size={14} />
              </span>
            </button>
            <div className="timer-controls">
              <button
                className="secondary"
                onClick={() =>
                  void commit(
                    (current) =>
                      current.timer?.id === timer.id ? toggleTimer(current, Date.now()) : current,
                    timer.runningSince === null ? '已继续计时' : '已暂停',
                  )
                }
              >
                {timer.runningSince === null ? <Play size={18} /> : <Pause size={18} />}
                {timer.runningSince === null ? '继续' : '暂停'}
              </button>
              <button
                className="primary"
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
                <Square size={17} />
                完成
              </button>
            </div>
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
            <div className="phone-tag-chips">
              {timer.tags.map((tag) => (
                <span key={tag} style={{ color: tagColors[tag] }}>
                  #{tag}
                </span>
              ))}
            </div>
            <label className="timer-plan">
              相关计划
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
            <label>
              活动内容
              <textarea
                aria-label="计时描述"
                key={`${timer.id}:${timer.note}`}
                defaultValue={timer.note}
                placeholder="描述"
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
            </label>
          </section>
          <div className="timer-footer-actions">
            <button
              className="secondary"
              disabled={elapsed < 1000}
              onClick={() => setEditing('next')}
            >
              下一个活动
              <ArrowRight size={16} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                void commit(
                  (current) =>
                    current.timer?.id === timer.id ? { ...current, timer: null } : current,
                  '本次计时已取消',
                );
              }}
            >
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="panel-toolbar">
            <button className="secondary" onClick={openTimes}>
              <Clock3 size={17} />
              调整起止时间
            </button>
            <button className="secondary" onClick={manage}>
              <List size={17} />
              管理活动
            </button>
          </div>
          <p className="section-note">
            {pendingStart
              ? `开始 ${dateTimeInput(pendingStart).replace('T', ' ')}`
              : '选择活动开始'}
            {pendingEnd
              ? ` · 结束 ${dateTimeInput(pendingEnd).replace('T', ' ')}`
              : minutes
                ? ` · 倒计时 ${minutes} 分钟`
                : ''}
          </p>
          {activityGrid((id) => void begin(id))}
        </>
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
