import type { CSSProperties } from 'react';
import { Check, MoreHorizontal, Target } from 'lucide-react';
import { formatDuration, goalProgress, type Goal, type State } from '../domain';
import { ActivityIcon } from '../../phone/ActivityIcon';

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
          .map((goal) => ({ goal, progress: goalProgress(state, goal, date) }));
        if (!rows.length) return null;
        return (
          <section
            className="goal-group"
            key={period}
            aria-label={period === 'day' ? '每日目标' : '每周目标'}
          >
            <header>
              <h2>{period === 'day' ? '每日目标' : '每周目标'}</h2>
              <span>
                {rows.filter(({ goal, progress }) => progress >= goal.minutes).length}/{rows.length}
              </span>
            </header>
            <div className="goal-grid">
              {rows.map(({ goal, progress }) => {
                const activity = state.activities.find((item) => item.id === goal.activityId)!;
                const percent = Math.min(100, (progress / goal.minutes) * 100);
                return (
                  <article
                    className={`goal-card ${percent >= 100 ? 'achieved' : ''}`}
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
                        {percent >= 100 && <Check size={15} />}
                      </h3>
                      <div className="goal-card-status">
                        <span>
                          {percent >= 100
                            ? '已达标'
                            : `还需 ${formatDuration(Math.ceil(Math.max(0, goal.minutes - progress)) * 60000)}`}
                        </span>
                        <strong>{Math.floor(percent)}%</strong>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${percent}%` }} />
                      </div>
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
      <p className="section-note">按已保存记录计算进度，每周从周一开始。</p>
    </div>
  );
}
