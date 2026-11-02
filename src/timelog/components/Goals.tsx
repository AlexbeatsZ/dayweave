import type { CSSProperties } from 'react';
import { Check, MoreHorizontal, Target, X } from 'lucide-react';
import {
  formatDuration,
  goalStatus,
  goalTargetText,
  shiftDay,
  type Goal,
  type State,
} from '../domain';
import { ActivityIcon } from '../../phone/ActivityIcon';

const HISTORY = 7;
const periodLength = (goal: Goal) => (goal.period === 'week' ? 7 : 1);

function statusText(goal: Goal, progress: number, settled: boolean, met: boolean | null) {
  if (settled) return met ? '已达成' : '未达成';
  const gap = formatDuration(Math.ceil(Math.abs(goal.minutes - progress)) * 60000);
  if (goal.comparison === 'atMost')
    return progress <= goal.minutes ? `还可 ${gap}` : `已超出 ${gap}`;
  return progress >= goal.minutes ? '已到目标，周期结束后结算' : `还需 ${gap}`;
}

export function Goals({
  state,
  date,
  edit,
  remove,
}: {
  state: State;
  date: string;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
}) {
  const active = state.goals.filter((goal) => !goal.archived);
  return (
    <div className="goal-groups">
      {(['day', 'week'] as const).map((period) => {
        const rows = active
          .filter((goal) => goal.period === period)
          .map((goal) => ({ goal, status: goalStatus(state, goal, date) }));
        if (!rows.length) return null;
        // The header counts the last finished period, never the one still running.
        const previous = rows.map(({ goal }) =>
          goalStatus(state, goal, shiftDay(date, -periodLength(goal))),
        );
        return (
          <section
            className="goal-group"
            key={period}
            aria-label={period === 'day' ? '每日目标' : '每周目标'}
          >
            <header>
              <h2>{period === 'day' ? '每日目标' : '每周目标'}</h2>
              <span title={period === 'day' ? '昨天' : '上周'}>
                {period === 'day' ? '昨天' : '上周'} {previous.filter((item) => item.met).length}/
                {rows.length}
              </span>
            </header>
            <div className="goal-grid">
              {rows.map(({ goal, status }) => {
                const activity = state.activities.find((item) => item.id === goal.activityId)!;
                const percent = Math.min(100, (status.progress / goal.minutes) * 100);
                const history = Array.from({ length: HISTORY }, (_, index) => {
                  const key = shiftDay(date, -periodLength(goal) * (HISTORY - index));
                  return { key, met: goalStatus(state, goal, key).met };
                });
                const over = goal.comparison === 'atMost' && !status.within;
                return (
                  <article
                    className={`goal-card ${status.met ? 'achieved' : ''} ${status.met === false || over ? 'missed' : ''}`}
                    key={goal.id}
                    style={{ '--activity-color': activity.color } as CSSProperties}
                  >
                    <button
                      className="goal-card-main"
                      aria-label={`编辑目标 ${goal.name}`}
                      onClick={() => edit(goal)}
                    >
                      <h3>
                        <ActivityIcon name={activity.name} size={18} />
                        <span>{goal.name}</span>
                        {status.met && <Check size={15} />}
                      </h3>
                      <div className="goal-card-status">
                        <span>{statusText(goal, status.progress, status.settled, status.met)}</span>
                        <strong>
                          {formatDuration(status.progress * 60000)} / {goalTargetText(goal, true)}
                        </strong>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <ol
                        className="goal-history"
                        aria-label={`${goal.name} 最近 ${HISTORY} 个周期`}
                      >
                        {history.map((item) => (
                          <li
                            key={item.key}
                            className={item.met ? 'met' : 'missed'}
                            title={`${item.key} ${item.met ? '达成' : '未达成'}`}
                          >
                            {item.met ? <Check size={10} /> : <X size={10} />}
                          </li>
                        ))}
                      </ol>
                    </button>
                    <details className="goal-menu">
                      <summary aria-label={`目标操作 ${goal.name}`}>
                        <MoreHorizontal size={16} />
                      </summary>
                      <div>
                        <button onClick={() => edit(goal)}>编辑目标</button>
                        <button onClick={() => remove(goal)}>删除目标</button>
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {!active.length && (
        <div className="empty-state">
          <Target size={28} />
          <p>还没有目标</p>
          <button className="secondary" onClick={() => edit()}>
            添加目标
          </button>
        </div>
      )}
      <p className="section-note">
        按已保存记录计算；周期结束后才判定是否达成，结束前可以修正记录。每周从周一开始。
      </p>
    </div>
  );
}
