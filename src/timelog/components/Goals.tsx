import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  Check,
  FileCode2,
  GitBranch,
  ListChecks,
  MoreHorizontal,
  Target,
  Timer,
} from 'lucide-react';
import {
  formatDuration,
  goalPeriodKey,
  goalStatus,
  goalTargetText,
  shiftDay,
  sortGoals,
  describeRules,
  type Goal,
  type BehaviorCounter,
  type GoalTask,
  scriptResult,
  type ScriptOutcome,
  type State,
} from '../domain';
import { useSortDrag } from '../../phone/useSortDrag';
import '../../phone/sort.css';

const periodLength = (goal: Goal) => (goal.period === 'week' ? 7 : 1);
const periodName = (goal: Goal) => (goal.period === 'week' ? '本周' : '今天');
type Status = ReturnType<typeof goalStatus>;
type SubmitReview = (
  ruleId: string,
  date: string,
  counter: BehaviorCounter,
  step?: 1 | -1,
) => Promise<boolean>;

function BehaviorCounterButton({
  label,
  name,
  value,
  disabled,
  count,
}: {
  label: string;
  name: string;
  value: number;
  disabled: boolean;
  count: (step: 1 | -1) => Promise<boolean>;
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const consumed = useRef(false);
  const clear = () => {
    clearTimeout(hold.current);
    hold.current = undefined;
    pointer.current = undefined;
  };
  useEffect(() => {
    if (disabled) clear();
    return clear;
  }, [disabled]);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label} ${name} ${value} 次`}
      aria-description="点击加一，长按减一"
      title="点击加一，长按减一"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        clear();
        consumed.current = false;
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        hold.current = setTimeout(() => {
          hold.current = undefined;
          consumed.current = true;
          void count(-1);
        }, 450);
      }}
      onPointerMove={(event) => {
        const origin = pointer.current;
        if (
          origin &&
          origin.id === event.pointerId &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 9
        ) {
          consumed.current = true;
          clear();
        }
      }}
      onPointerUp={(event) => {
        if (pointer.current?.id === event.pointerId) clear();
      }}
      onPointerCancel={(event) => {
        if (pointer.current?.id !== event.pointerId) return;
        consumed.current = true;
        clear();
      }}
      onLostPointerCapture={(event) => {
        if (pointer.current?.id !== event.pointerId) return;
        consumed.current = true;
        clear();
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          clear();
          consumed.current = false;
        }
      }}
      onClick={(event) => {
        if (consumed.current && event.detail > 0) {
          consumed.current = false;
          return;
        }
        void count(1);
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}
function gapText(minutes: number) {
  return formatDuration(Math.ceil(Math.abs(minutes)) * 60000);
}
function statusText(
  goal: Exclude<Goal, { kind: 'behaviorRule' }>,
  status: Status,
  outcome?: ScriptOutcome,
) {
  if (goal.kind === 'script') {
    if (outcome?.error) return `脚本出错：${outcome.error}`;
    if (!outcome) return '等待同步中心判定';
    const verdict = status.settled
      ? status.met === null
        ? '无法判定'
        : status.met
          ? '已达成'
          : '未达成'
      : '';
    return (
      [verdict, outcome.note].filter(Boolean).join(' · ') ||
      (status.within ? '目前满足' : '目前未满足')
    );
  }
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
function amountText(
  goal: Exclude<Goal, { kind: 'behaviorRule' }>,
  status: Status,
  date: string,
  state: State,
) {
  if (goal.kind === 'script')
    return state.scripts?.find((row) => row.id === goal.scriptId)?.name ?? '脚本已删除';
  if (goal.kind === 'tasks') return `#${goal.taskTag}`;
  if (goal.kind === 'manual')
    return goal.checks[goalPeriodKey(goal, date)]?.by === 'ai' ? 'AI 判定' : '手动勾选';
  return `${formatDuration(status.progress * 60000)} / ${goalTargetText(goal, true)}`;
}
export function Goals({
  state,
  tasks,
  date,
  now,
  review,
  edit,
  remove,
  check,
  move,
}: {
  state: State;
  tasks: GoalTask[];
  date: string;
  now: number;
  review: SubmitReview;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
  check: (goal: Goal, done: boolean) => void;
  /** Moves `source` to `target`'s place among `visible` (one group, in display order). */
  move: (visible: string[], source: string, target: string) => void;
}) {
  const active = useMemo(() => sortGoals(state.goals.filter((goal) => !goal.archived)), [state]);
  const previousKey = (goal: Goal) => shiftDay(date, -periodLength(goal));
  const cards = active.map((goal) => ({
    goal,
    // Script results are computed by the sync hub and arrive with the synced state.
    outcome: goal.kind === 'script' ? scriptResult(state, goal, date) : undefined,
    status: goalStatus(state, goal, date, now, tasks),
    previous: goalStatus(state, goal, previousKey(goal), now, tasks),
  }));
  const groups = [...new Set(active.map((goal) => goal.group ?? ''))];
  return (
    <div className="goal-groups">
      {groups.map((group) => {
        const rows = cards.filter(({ goal }) => (goal.group ?? '') === group);
        const graded = rows.filter(({ goal }) => goal.kind !== 'behaviorRule');
        const visible = rows.map(({ goal }) => goal.id);
        const title = group || (groups.length > 1 ? '其他目标' : '目标');
        return (
          <section className="goal-group" key={group} aria-label={title}>
            <header>
              <h2>{title}</h2>
              {graded.length > 0 && (
                <span title="每个目标的上一周期">
                  上期 {graded.filter((row) => row.previous.met).length}/{graded.length}
                </span>
              )}
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
                  review={review}
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
        达成类目标在周期结束后判定。每周从周一开始。长按目标可拖动排序。
      </p>
    </div>
  );
}

function GoalCard({
  goal,
  outcome,
  status: current,
  state,
  date,
  sortGroup,
  edit,
  remove,
  check,
  review,
  move,
}: {
  goal: Goal;
  outcome?: ScriptOutcome;
  status: Status;
  state: State;
  date: string;
  sortGroup: string;
  edit: (goal?: Goal) => void;
  remove: (goal: Goal) => void;
  check: (goal: Goal, done: boolean) => void;
  review: SubmitReview;
  move?: (source: string, target: string) => void;
}) {
  const drag = useSortDrag(goal.id, sortGroup, move);
  // One icon language for every goal: a blue stopwatch for "at least", a red one for
  // "at most", a checklist for task-bound goals and the check itself for manual goals.
  const ceiling = goal.kind === undefined && goal.comparison === 'atMost';
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
      data-kind={goal.kind ?? (ceiling ? 'ceiling' : 'time')}
      style={{ '--activity-color': ceiling ? 'var(--red)' : 'var(--accent)' } as CSSProperties}
      onClickCapture={drag.onClickCapture}
    >
      <button
        className="goal-card-main"
        data-sort-handle
        aria-label={`编辑目标 ${goal.name}`}
        onClick={() => edit(goal)}
      >
        <h3>
          {goal.kind === undefined ? (
            <Timer size={18} aria-hidden />
          ) : goal.kind === 'script' ? (
            <FileCode2 size={18} aria-hidden />
          ) : goal.kind === 'tasks' ? (
            <ListChecks size={18} aria-hidden />
          ) : goal.kind === 'behaviorRule' ? (
            <GitBranch size={18} aria-hidden />
          ) : (
            // The check button sits over this slot; it cannot nest inside the edit button.
            <span className="goal-icon-slot" aria-hidden />
          )}
          <span>{goal.name}</span>
          {current.met && <Check size={15} />}
        </h3>
        {goal.kind === undefined && (
          <p className="goal-match">{describeRules(goal.rules, state.activities)}</p>
        )}
        {goal.kind === 'behaviorRule' ? (
          <div className="behavior-rule-text">
            <span>触发条件：{goal.trigger}</span>
            <span>目标行为：{goal.action}</span>
          </div>
        ) : (
          <>
            <div className="goal-card-status">
              <span>{statusText(goal, current, outcome)}</span>
              <strong>{amountText(goal, current, date, state)}</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${percent}%` }} />
              {thresholds.length > 1 &&
                thresholds.map((value) => (
                  <i key={value} style={{ left: `${(value / scale) * 100}%` }} />
                ))}
            </div>
          </>
        )}
      </button>
      {goal.kind === 'behaviorRule' && (
        <div className="behavior-counters" role="group" aria-label={`今日行为回顾 ${goal.name}`}>
          <BehaviorCounterButton
            key={`trigger:${date}`}
            label="触发条件"
            name={goal.name}
            value={current.triggered ?? 0}
            disabled={current.settled}
            count={(step) => review(goal.id, date, 'trigger', step)}
          />
          <BehaviorCounterButton
            key={`action:${date}`}
            label="目标行为"
            name={goal.name}
            value={current.executed ?? 0}
            disabled={current.settled}
            count={(step) => review(goal.id, date, 'action', step)}
          />
        </div>
      )}
      {goal.kind === 'manual' && (
        <button
          className="goal-check"
          aria-pressed={!!manualCheck?.done}
          aria-label={`${manualCheck?.done ? '取消勾选' : '勾选'}${periodName(goal)} ${goal.name}`}
          onClick={() => check(goal, !manualCheck?.done)}
        >
          <Check size={10} strokeWidth={3.5} />
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
