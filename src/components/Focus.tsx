import { useState } from 'react';
import { Play, Pause, Square, Coffee, Timer, Check } from 'lucide-react';
import { dateKey, remainingSeconds, uid } from '../model';
import { store, useStore } from '../store';

export function Focus({ preferredTask, clock }: { preferredTask: string | null; clock: number }) {
  const { data } = useStore();
  const [taskId, setTaskId] = useState(preferredTask ?? '');
  const [kind, setKind] = useState<'focus' | 'break'>('focus');
  const [confirmStop, setConfirmStop] = useState(false);
  const timer = data.timer;
  const currentKind = timer?.kind ?? kind;
  const activeTasks = data.tasks.filter((t) => !t.completedAt && !t.deletedAt);
  const duration =
    timer?.duration ??
    (currentKind === 'focus' ? data.settings.focusMinutes : data.settings.breakMinutes) * 60;
  const seconds = timer ? remainingSeconds(timer, clock) : duration;
  const progress = timer ? (duration - seconds) / duration : 0;
  const todaySessions = data.sessions.filter((s) => dateKey(new Date(s.completedAt)) === dateKey());
  const start = () => {
    if (data.timelog.timer) return;
    const task = activeTasks.find((t) => t.id === taskId);
    const title = currentKind === 'break' ? '休息一下' : (task?.title ?? '自由专注');
    store.update((s) => ({
      ...s,
      timer: {
        id: uid(),
        taskId: task?.id ?? null,
        title,
        kind: currentKind,
        duration,
        remaining: duration,
        endAt: Date.now() + duration * 1000,
      },
    }));
  };
  return (
    <div className="focus-view">
      {data.timelog.timer && (
        <p className="field-hint">正在记录时间，请先到时间记录中保存当前计时。</p>
      )}
      <div className="focus-mode" role="group" aria-label="计时模式">
        <button
          className={currentKind === 'focus' ? 'active' : ''}
          disabled={!!timer}
          onClick={() => setKind('focus')}
        >
          <Timer size={15} />
          番茄专注
        </button>
        <button
          className={currentKind === 'break' ? 'active' : ''}
          disabled={!!timer}
          onClick={() => setKind('break')}
        >
          <Coffee size={15} />
          短暂休息
        </button>
      </div>
      <div className={`timer-face ${timer?.endAt ? 'timer-running' : ''}`}>
        <svg viewBox="0 0 300 300" aria-hidden>
          <circle className="timer-track" cx="150" cy="150" r="137" />
          <circle
            className="timer-progress"
            cx="150"
            cy="150"
            r="137"
            strokeDasharray={`${2 * Math.PI * 137}`}
            strokeDashoffset={2 * Math.PI * 137 * (1 - progress)}
          />
        </svg>
        <div className="timer-digits" aria-live="off">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}
          <span>:</span>
          {String(seconds % 60).padStart(2, '0')}
          <small>
            {timer
              ? timer.endAt
                ? '保持专注，慢慢来'
                : '已经暂停'
              : currentKind === 'focus'
                ? '一次只做一件事'
                : '让注意力歇一歇'}
          </small>
        </div>
      </div>
      {timer ? (
        <p className="focused-task">{timer.title}</p>
      ) : (
        <label className="focus-picker">
          <span>这次专注于</span>
          <select
            aria-label="专注任务"
            value={activeTasks.some((t) => t.id === taskId) ? taskId : ''}
            onChange={(e) => setTaskId(e.target.value)}
          >
            <option value="">自由专注</option>
            {activeTasks.map((task) => (
              <option value={task.id} key={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="focus-controls">
        {!timer ? (
          <button
            className="button primary timer-start"
            onClick={start}
            disabled={!!data.timelog.timer}
          >
            <Play size={17} fill="currentColor" />
            {currentKind === 'focus' ? '开始专注' : '开始休息'}
          </button>
        ) : (
          <>
            <button
              className="button primary timer-start"
              onClick={() =>
                store.update((s) => ({
                  ...s,
                  timer: s.timer
                    ? {
                        ...s.timer,
                        remaining: remainingSeconds(s.timer),
                        endAt: s.timer.endAt ? null : Date.now() + s.timer.remaining * 1000,
                      }
                    : null,
                }))
              }
            >
              {timer.endAt ? (
                <>
                  <Pause size={17} />
                  暂停
                </>
              ) : (
                <>
                  <Play size={17} />
                  继续
                </>
              )}
            </button>
            <button
              className="button timer-stop"
              aria-label="结束本次计时"
              onClick={() => setConfirmStop(true)}
            >
              <Square size={15} />
            </button>
          </>
        )}
      </div>
      {confirmStop && (
        <div className="inline-confirm">
          <span>结束后本次计时不计入统计。</span>
          <button className="text-button" onClick={() => setConfirmStop(false)}>
            继续计时
          </button>
          <button
            className="text-button danger"
            onClick={() => {
              store.update((s) => ({ ...s, timer: null }));
              setConfirmStop(false);
            }}
          >
            结束计时
          </button>
        </div>
      )}
      <div className="focus-today">
        <div>
          <strong>{todaySessions.length}</strong>
          <span>今日完成专注</span>
        </div>
        <i />
        <div>
          <strong>
            {todaySessions.reduce((sum, s) => sum + s.minutes, 0)}
            <small> 分钟</small>
          </strong>
          <span>留给重要的事</span>
        </div>
      </div>
      <section className="focus-history">
        <h3>最近的专注</h3>
        {data.sessions.length ? (
          data.sessions
            .slice(-5)
            .reverse()
            .map((s) => (
              <div className="session-row" key={s.id}>
                <span className="session-icon">
                  <Check size={15} />
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(s.completedAt).toLocaleString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </div>
                <span>{s.minutes} 分钟</span>
              </div>
            ))
        ) : (
          <p className="muted">完成一次专注后，记录会出现在这里。</p>
        )}
      </section>
    </div>
  );
}
