import { useMemo, type CSSProperties } from 'react';
import { Target } from 'lucide-react';
import {
  goalPeriodKey,
  goalRange,
  goalStatus,
  matchesRules,
  shiftDay,
  sortGoals,
  type Goal,
  type GoalTask,
  type State,
} from '../domain';
import { weekday } from '../../timezone';

/** Daily goals show eight calendar weeks; weekly goals fourteen weeks. Seven cells per row. */
const CELLS = { day: 56, week: 14 } as const;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
type Status = ReturnType<typeof goalStatus>;

/** 0 is gray and 1 the theme blue; stages split the range evenly. */
export function goalShade(goal: Goal, status: Status) {
  if (goal.kind === undefined && !goal.stages?.length && goal.comparison === 'atLeast')
    return Math.min(1, status.progress / status.target);
  if (goal.kind === 'tasks') return status.target ? status.progress / status.target : 0;
  return status.reached / status.levels;
}
function label(goal: Goal, key: string, status: Status) {
  const name = goal.period === 'week' ? `${key} 起一周` : key;
  const stage =
    goal.kind === undefined && goal.stages?.length
      ? ` 阶段 ${status.reached}/${status.levels}`
      : '';
  if (!status.settled) return `${name} 进行中${stage}`;
  return `${name}${stage} ${status.met ? '达成' : '未达成'}`;
}

/** Statistics › 记录 › 目标: one completion heatmap per goal, ending at `date`. */
export function GoalHeatmaps({
  state,
  tasks,
  date,
}: {
  state: State;
  tasks: GoalTask[];
  date: string;
}) {
  const rows = useMemo(() => {
    const now = Date.now();
    // Periods that ended before the first saved record have no data, not a result: an
    // "at most" goal would otherwise look fully met for every day before tracking began.
    const firstRecord = Math.min(
      ...state.records.filter((row) => !row.deletedAt).map((row) => row.spans[0].start),
    );
    return sortGoals(state.goals.filter((goal) => !goal.archived)).map((goal) => {
      // Time goals only read matching records; filtering once keeps every cell cheap.
      const scoped =
        goal.kind === undefined
          ? { ...state, records: state.records.filter((row) => matchesRules(goal.rules, row)) }
          : state;
      const last = goalPeriodKey(goal, date);
      const count = CELLS[goal.period];
      const step = goal.period === 'week' ? 7 : 1;
      // Daily rows are calendar weeks (Monday first) so a column is always the same weekday.
      const first =
        goal.period === 'week'
          ? shiftDay(last, -7 * (count - 1))
          : shiftDay(date, 1 - weekday(date) - 7 * (count / 7 - 1));
      const cells = Array.from({ length: count }, (_, index) => {
        const key = shiftDay(first, index * step);
        if (key > last) return { key, shade: null, current: false, label: `${key} 尚未到来` };
        if (goalRange(goal, key).end <= firstRecord)
          return { key, shade: null, current: false, label: `${key} 无记录` };
        const status = goalStatus(scoped, goal, key, now, tasks);
        return {
          key,
          shade: goalShade(goal, status),
          current: !status.settled,
          label: label(goal, key, status),
        };
      });
      const settled = cells.filter((cell) => cell.shade !== null && !cell.current);
      const full = settled.filter((cell) => cell.shade === 1).length;
      return { goal, cells, summary: `${full}/${settled.length} 期全部完成` };
    });
  }, [state, tasks, date]);
  if (!rows.length)
    return (
      <div className="empty-state">
        <Target size={28} />
        <p>还没有目标</p>
      </div>
    );
  return (
    <div className="goal-heatmaps">
      <p className="section-note">颜色越蓝完成越多；有阶段的目标按达到的阶段数均分。</p>
      {rows.map(({ goal, cells, summary }) => (
        <section className="phone-analysis-card goal-heatmap" key={goal.id}>
          <header>
            <h2>{goal.name}</h2>
            <span>
              {goal.period === 'week' ? '每周' : '每日'} · {summary}
            </span>
          </header>
          {goal.period === 'day' && (
            <ol className="goal-heat-weekdays" aria-hidden="true">
              {WEEKDAYS.map((day) => (
                <li key={day}>{day}</li>
              ))}
            </ol>
          )}
          <ol className="goal-heat" aria-label={`${goal.name} 完成情况`}>
            {cells.map((cell) => (
              <li
                key={cell.key}
                className={`${cell.shade === null ? 'future' : ''} ${cell.current ? 'current' : ''}`}
                title={cell.label}
                aria-label={cell.label}
                style={
                  cell.shade === null
                    ? undefined
                    : ({ '--heat': `${Math.round(cell.shade * 100)}%` } as CSSProperties)
                }
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
