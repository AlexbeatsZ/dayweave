import { useMemo, type CSSProperties } from 'react';
import { Check, CircleCheck, ListChecks, MoreHorizontal, Target, Timer } from 'lucide-react';
import {
  formatDuration,
  goalPeriodKey,
  goalStatus,
  goalTargetText,
  shiftDay,
  sortGoals,
  describeRules,
  rulesActivity,
  type Goal,
  type GoalTask,
  type State,
} from '../domain';
import { ActivityIcon } from '../../phone/ActivityIcon';
import { useSortDrag } from '../../phone/useSortDrag';
import '../../phone/sort.css';

const ACCENT = '#76b9ed';
const periodLength = (goal: Goal) => (goal.period === 'week' ? 7 : 1);
const periodName = (goal: Goal) => (goal.period === 'week' ? '本周' : '今天');
type Status = ReturnType<typeof goalStatus>;
function gapText(minutes: number) {
  return formatDuration(Math.ceil(Math.abs(minutes)) * 60000);
}
function statusText(goal: Goal, status: Status) {
  const staged = goal.kind === undefined && !!goal.stages?.length;
  if (status.settled) {
    if (status.met) return '已达成';
    return staged && status.reached ? `达到阶段 ${status.reached}/${status.levels}` : '未达成';
  }
  if (goal.kind === 'tasks')
    return status.target ? `${periodName(goal)}完成 ${status.progress}/${status.target}` : '无任务';
  if (goal.kind === 'manual') return status.within ? '已勾选' : '未勾选';
  if (goal.comparison === 'atMost') {
    const text =
      status.progress <= goal.minutes
        ? `还可 ${gapText(goal.minutes - status.progress)}`
        : `已超出 ${gapText(status.progress - goal.minutes)}`;
    return staged ? `阶段 ${status.reached}/${status.levels} · ${text}` : text;
  }
  if (!staged)
    return status.progress >= goal.minutes
      ? '已到目标，周期结束后结算'
      : `还需 ${gapText(goal.minutes - status.progress)}`;
  const next = [...goal.stages!, goal.minutes].find((value) => value > status.progress);
  return next === undefined
    ? `阶段 ${status.levels}/${status.levels} · 已到目标`
    : `阶段 ${status.reached}/${status.levels} · 下一阶段还需 ${gapText(next - status.progress)}`;
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
  move,
}: {
  state: State;
  tasks: GoalTask[];
  date: string;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
  check: (goal: Goal, done: boolean) => void;
  /** Moves `source` to `target`'s place among `visible` (one group, in display order). */
  move: (visible: string[], source: string, target: string) => void;
}) {
  const active = useMemo(() => sortGoals(state.goals.filter((goal) => !goal.archived)), [state]);
  // Statuses only read saved records, so they change with state/tasks/date, not every clock tick.
  const cards = useMemo(() => {
    const now = Date.now();
    return active.map((goal) => ({
      goal,
      status: goalStatus(state, goal, date, now, tasks),
      previous: goalStatus(state, goal, shiftDay(date, -periodLength(goal)), now, tasks),
    }));
  }, [active, state, tasks, date]);
  const groups = [...new Set(active.map((goal) => goal.group ?? ''))];
  return (
    <div className="goal-groups">
      {groups.map((group) => {
        const rows = cards.filter(({ goal }) => (goal.group ?? '') === group);
        const visible = rows.map(({ goal }) => goal.id);
        const title = group || (groups.length > 1 ? '其他目标' : '目标');
        return (
          <section className="goal-group" key={group} aria-label={title}>
            <header>
              <h2>{title}</h2>
              <span title="每个目标的上一周期">
                上期 {rows.filter((row) => row.previous.met).length}/{rows.length}
              </span>
            </header>
            <div className="goal-grid">
              {rows.map((row) => (
                <GoalCard
                  key={row.goal.id}
                  {...row}
                  state={state}
                  date={date}
                  sortGroup={`goal:${group}`}
                  edit={edit}
                  remove={remove}
                  check={check}
                  move={
                    rows.length > 1 ? (source, target) => move(visible, source, target) : undefined
                  }
                />
              ))}
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
        周期结束后才判定是否达成，结束前可以修正记录或勾选。每周从周一开始。长按目标可拖动排序。
      </p>
    </div>
  );
}

function GoalCard({
  goal,
  status: current,
  state,
  date,
  sortGroup,
  edit,
  remove,
  check,
  move,
}: {
  goal: Goal;
  status: Status;
  state: State;
  date: string;
  sortGroup: string;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
  check: (goal: Goal, done: boolean) => void;
  move?: (source: string, target: string) => void;
}) {
  const drag = useSortDrag(goal.id, sortGroup, move);
  const single = goal.kind === undefined ? rulesActivity(goal.rules) : undefined;
  const activity = single ? state.activities.find((item) => item.id === single) : undefined;
  // Staged goals scale the bar to the loosest threshold and mark every stage on it.
  const thresholds = goal.kind === undefined ? [...(goal.stages ?? []), goal.minutes] : [];
  const scale = Math.max(current.target, ...thresholds);
  const percent = scale ? Math.min(100, (current.progress / scale) * 100) : 0;
  const over = goal.kind === undefined && goal.comparison === 'atMost' && !current.within;
  const manualCheck = goal.kind === 'manual' ? goal.checks[goalPeriodKey(goal, date)] : undefined;
  return (
    <article
      ref={drag.ref}
      className={`goal-card ${current.met ? 'achieved' : ''} ${current.met === false || over ? 'missed' : ''} ${drag.dragging ? 'sort-source' : ''}`}
      data-sort-id={move ? goal.id : undefined}
      data-sort-group={move ? sortGroup : undefined}
      style={{ '--activity-color': activity?.color ?? ACCENT } as CSSProperties}
      onClickCapture={drag.onClickCapture}
    >
      <button
        className="goal-card-main"
        data-sort-handle
        aria-label={`编辑目标 ${goal.name}`}
        onClick={() => edit(goal)}
      >
        <h3>
          {activity ? (
            <ActivityIcon name={activity.name} size={18} />
          ) : goal.kind === undefined ? (
            <Timer size={18} />
          ) : goal.kind === 'tasks' ? (
            <ListChecks size={18} />
          ) : (
            <CircleCheck size={18} />
          )}
          <span>{goal.name}</span>
          {current.met && <Check size={15} />}
        </h3>
        {goal.kind === undefined && !activity && (
          <p className="goal-match">{describeRules(goal.rules, state.activities)}</p>
        )}
        <div className="goal-card-status">
          <span>{statusText(goal, current)}</span>
          <strong>{amountText(goal, current, date)}</strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${percent}%` }} />
          {thresholds.length > 1 &&
            thresholds.map((value) => (
              <i key={value} style={{ left: `${(value / scale) * 100}%` }} />
            ))}
        </div>
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
}
