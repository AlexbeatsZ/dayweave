import type { CSSProperties } from 'react';
import { Check, CircleCheck, ListChecks, MoreHorizontal, Target, X } from 'lucide-react';
import {
  formatDuration,
  goalPeriodKey,
  goalStatus,
  goalTargetText,
  shiftDay,
  type Goal,
  type GoalTask,
  type State,
} from '../domain';
import { ActivityIcon } from '../../phone/ActivityIcon';

const HISTORY = 7;
const ACCENT = '#76b9ed';
const periodLength = (goal: Goal) => (goal.period === 'week' ? 7 : 1);
const periodName = (goal: Goal) => (goal.period === 'week' ? '本周' : '今天');
type Status = ReturnType<typeof goalStatus>;

function statusText(goal: Goal, status: Status) {
  if (status.settled) return status.met ? '已达成' : '未达成';
  if (goal.kind === 'tasks')
    return status.target ? `${periodName(goal)}完成 ${status.progress}/${status.target}` : '无任务';
  if (goal.kind === 'manual') return status.within ? '已勾选' : '未勾选';
  const gap = formatDuration(Math.ceil(Math.abs(goal.minutes - status.progress)) * 60000);
  if (goal.comparison === 'atMost')
    return status.progress <= goal.minutes ? `还可 ${gap}` : `已超出 ${gap}`;
  return status.progress >= goal.minutes ? '已到目标，周期结束后结算' : `还需 ${gap}`;
}
function amountText(goal: Goal, status: Status, date: string) {
  if (goal.kind === 'tasks') return `#${goal.taskTag}`;
  if (goal.kind === 'manual')
    return goal.checks[goalPeriodKey(goal, date)]?.by === 'ai' ? 'AI 判定' : '手动勾选';
  return `${formatDuration(status.progress * 60000)} / ${goalTargetText(goal, true)}`;
}

export function Goals({
  state,
  tasks,
  date,
  edit,
  remove,
  check,
}: {
  state: State;
  tasks: GoalTask[];
  date: string;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
  check: (goal: Goal, done: boolean) => void;
}) {
  const active = state.goals.filter((goal) => !goal.archived);
  const status = (goal: Goal, key: string) => goalStatus(state, goal, key, Date.now(), tasks);
  // User-named groups keep their first-seen order; daily goals come before weekly ones inside.
  const groups = [...new Set(active.map((goal) => goal.group ?? ''))];
  return (
    <div className="goal-groups">
      {groups.map((group) => {
        const rows = active
          .filter((goal) => (goal.group ?? '') === group)
          .sort((a, b) => periodLength(a) - periodLength(b))
          .map((goal) => ({ goal, status: status(goal, date) }));
        // The header counts each goal's last finished period, never the one still running.
        const previous = rows.map(({ goal }) => status(goal, shiftDay(date, -periodLength(goal))));
        const title = group || (groups.length > 1 ? '其他目标' : '目标');
        return (
          <section className="goal-group" key={group} aria-label={title}>
            <header>
              <h2>{title}</h2>
              <span title="每个目标的上一周期">
                上期 {previous.filter((item) => item.met).length}/{rows.length}
              </span>
            </header>
            <div className="goal-grid">
              {rows.map(({ goal, status: current }) => {
                const activity =
                  goal.kind === undefined
                    ? state.activities.find((item) => item.id === goal.activityId)
                    : undefined;
                const percent = current.target
                  ? Math.min(100, (current.progress / current.target) * 100)
                  : 0;
                const history = Array.from({ length: HISTORY }, (_, index) => {
                  const key = shiftDay(date, -periodLength(goal) * (HISTORY - index));
                  return { key, met: status(goal, key).met };
                });
                const over =
                  goal.kind === undefined && goal.comparison === 'atMost' && !current.within;
                const manualCheck =
                  goal.kind === 'manual' ? goal.checks[goalPeriodKey(goal, date)] : undefined;
                return (
                  <article
                    className={`goal-card ${current.met ? 'achieved' : ''} ${current.met === false || over ? 'missed' : ''}`}
                    key={goal.id}
                    style={{ '--activity-color': activity?.color ?? ACCENT } as CSSProperties}
                  >
                    <button
                      className="goal-card-main"
                      aria-label={`编辑目标 ${goal.name}`}
                      onClick={() => edit(goal)}
                    >
                      <h3>
                        {activity ? (
                          <ActivityIcon name={activity.name} size={18} />
                        ) : goal.kind === 'tasks' ? (
                          <ListChecks size={18} />
                        ) : (
                          <CircleCheck size={18} />
                        )}
                        <span>{goal.name}</span>
                        {current.met && <Check size={15} />}
                      </h3>
                      <div className="goal-card-status">
                        <span>{statusText(goal, current)}</span>
                        <strong>{amountText(goal, current, date)}</strong>
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
                    {goal.kind === 'manual' && (
                      <button
                        className="goal-check"
                        aria-pressed={!!manualCheck?.done}
                        aria-label={`${manualCheck?.done ? '取消勾选' : '勾选'}${periodName(goal)} ${goal.name}`}
                        onClick={() => check(goal, !manualCheck?.done)}
                      >
                        <Check size={15} />
                      </button>
                    )}
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
        周期结束后才判定是否达成，结束前可以修正记录或勾选。每周从周一开始。
      </p>
    </div>
  );
}
