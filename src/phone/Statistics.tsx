import { dateKey } from '../model';
import { useStore } from '../store';
import { Statistics } from '../components/Statistics';
import { dayRange, formatDuration, formatPoints, stats } from '../timelog/domain';
import { DateNavigator } from './DateNavigator';
import { PhoneAnalysis } from './Analysis';

export type StatisticsPage = 'daily' | 'tasks' | 'records';
export function PhoneStatistics({
  page,
  date,
  setDate,
  onTimeline,
}: {
  page: StatisticsPage;
  date: string;
  setDate: (value: string) => void;
  onTimeline: (date: string) => void;
}) {
  const { data } = useStore();
  if (page === 'tasks') return <Statistics />;
  if (page === 'records')
    return (
      <PhoneAnalysis
        state={data.timelog}
        date={dateKey()}
        setDate={setDate}
        onTimeline={onTimeline}
        allTime
      />
    );
  const tasks = data.tasks.filter((task) => !task.deletedAt),
    planned = tasks.filter((task) => task.due === date);
  const completed = tasks.filter(
    (task) => task.completedAt && dateKey(new Date(task.completedAt)) === date,
  );
  const summary = stats(data.timelog, dayRange(date));
  return (
    <div className="phone-daily-statistics">
      <DateNavigator date={date} onDate={setDate} label="每日统计日期" />
      <section className="phone-analysis-card">
        <header>
          <h2>每日待办</h2>
        </header>
        <div className="phone-summary-grid">
          <div>
            <strong>{planned.length}</strong>
            <span>计划任务</span>
          </div>
          <div>
            <strong>{completed.length}</strong>
            <span>当天完成</span>
          </div>
          <div>
            <strong>{planned.filter((task) => !task.completedAt).length}</strong>
            <span>计划未完成</span>
          </div>
        </div>
      </section>
      <section className="phone-analysis-card">
        <header>
          <h2>每日记录</h2>
        </header>
        <div className="phone-summary-grid record-summary">
          <div>
            <strong>{formatDuration(summary.tracked)}</strong>
            <span>记录时长</span>
          </div>
          <div>
            <strong>{summary.count}</strong>
            <span>活动记录</span>
          </div>
          <div>
            <strong>{formatPoints(summary.points)}</strong>
            <span>当天积分</span>
          </div>
        </div>
        <button className="phone-stat-link" onClick={() => onTimeline(date)}>
          查看当天时间线
        </button>
      </section>
    </div>
  );
}
