import { CheckCheck, CalendarDays, ListTodo, TrendingUp } from 'lucide-react';
import { dateKey, fromDateKey, shiftDate } from '../model';
import { useStore } from '../store';

export function Statistics() {
  const { data } = useStore();

  const live = data.tasks.filter((t) => !t.deletedAt);
  const completed = live.filter((t) => t.completedAt).length;
  const planned = live.filter((task) => task.due).length;
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDate(dateKey(), index - 6);
    return {
      day,
      completed: live.filter(
        (task) => task.completedAt && dateKey(new Date(task.completedAt)) === day,
      ).length,
      created: live.filter((task) => dateKey(new Date(task.createdAt)) === day).length,
    };
  });
  const rate = live.length ? Math.round((completed / live.length) * 100) : 0;
  return (
    <div className="stats-view">
      <div className="stat-cards">
        {[
          { icon: CheckCheck, label: '累计完成', value: completed, unit: '件' },
          { icon: CalendarDays, label: '已安排计划', value: planned, unit: '件' },
          { icon: ListTodo, label: '尚待完成', value: live.length - completed, unit: '件' },
          { icon: TrendingUp, label: '任务完成率', value: rate, unit: '%' },
        ].map(({ icon: Icon, label, value, unit }) => (
          <div className="stat-card" key={label}>
            <span>
              <Icon size={17} />
              {label}
            </span>
            <strong>
              {value}
              <small>{unit}</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="chart-grid">
        {(
          [
            { field: 'completed', title: '每天完成一点', unit: '件任务' },
            { field: 'created', title: '新增待办', unit: '件任务' },
          ] as const
        ).map(({ field, title, unit }) => {
          const max = Math.max(1, ...days.map((d) => d[field]));
          return (
            <section className="chart-card" key={field}>
              <header>
                <h3>{title}</h3>
                <span>近 7 天 · {unit}</span>
              </header>
              <div className={`bar-chart chart-${field}`}>
                {days.map((d) => (
                  <div className="chart-column" key={d.day}>
                    <span className="bar-value">{d[field]}</span>
                    <div className="bar-space">
                      <div
                        className="chart-bar"
                        style={{ height: `${(d[field] / max) * 100}%` }}
                        title={`${d.day}：${d[field]} ${unit}`}
                      />
                    </div>
                    <span>
                      {fromDateKey(d.day).toLocaleDateString('zh-CN', { weekday: 'short' })}
                    </span>
                    <small>{d.day.slice(5).replace('-', '/')}</small>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <section className="distribution-card">
        <header>
          <h3>清单进度</h3>
          <span>完成 / 全部</span>
        </header>
        {data.lists.map((list) => {
          const tasks = live.filter((t) => t.listId === list.id);
          const done = tasks.filter((t) => t.completedAt).length;
          return (
            <div className="distribution-row" key={list.id}>
              <span>
                <i style={{ background: list.color }} />
                {list.id === 'inbox' ? '未分组' : list.name}
              </span>
              <div className="progress-track">
                <div
                  style={{
                    width: `${tasks.length ? (done / tasks.length) * 100 : 0}%`,
                    background: list.color,
                  }}
                />
              </div>
              <small>
                {done} / {tasks.length}
              </small>
            </div>
          );
        })}
      </section>
      <p className="stats-note">
        统计包含全部未删除待办；完成率与清单进度按全部历史计算，上图展示最近七天的变化。
      </p>
    </div>
  );
}
