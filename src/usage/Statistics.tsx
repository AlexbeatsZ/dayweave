import { useState } from 'react';
import { dayRange, formatDuration, shiftDay, stats, type State } from '../timelog/domain';
import { DateNavigator } from '../phone/DateNavigator';
import { PhoneAnalysis } from '../phone/Analysis';
import { useUsage } from './client';
import { usageSummary } from './domain';
import './usage.css';

export function RecordStatistics({
  state,
  date,
  setDate,
  onTimeline,
}: {
  state: State;
  date: string;
  setDate: (date: string) => void;
  onTimeline: (date: string) => void;
}) {
  const [mode, setMode] = useState<'manual' | 'automatic' | 'compare'>('manual'),
    [days, setDays] = useState(1),
    [deviceId, setDeviceId] = useState('');
  const range = { start: dayRange(shiftDay(date, 1 - days)).start, end: dayRange(date).end };
  const result = useUsage({ ...range, deviceId: deviceId || undefined }),
    summary = usageSummary(result.events, range);
  return (
    <div className="usage-statistics">
      <div className="phone-segments" aria-label="记录统计来源">
        {(['manual', 'automatic', 'compare'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {{ manual: '手动', automatic: '自动', compare: '对照' }[value]}
          </button>
        ))}
      </div>
      {mode === 'manual' ? (
        <PhoneAnalysis
          state={state}
          date={date}
          setDate={setDate}
          onTimeline={onTimeline}
          allTime
        />
      ) : (
        <>
          <DateNavigator date={date} onDate={setDate} label="自动统计日期" />
          <div className="usage-actions">
            <select
              aria-label="自动统计范围"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={1}>当天</option>
              <option value={7}>近七天</option>
              <option value={30}>近一月</option>
            </select>
            <select
              aria-label="自动统计设备"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">全部设备</option>
              {result.status?.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>
          {result.loading ? (
            <p role="status">正在计算…</p>
          ) : result.error ? (
            <p role="alert">{result.error}</p>
          ) : (
            <>
              <section className="phone-analysis-card">
                <h2>设备使用</h2>
                <div className="phone-summary-grid">
                  <div>
                    <strong>{formatDuration(summary.active)}</strong>
                    <span>时间覆盖（去重）</span>
                  </div>
                  <div>
                    <strong>{formatDuration(summary.deviceTime)}</strong>
                    <span>设备累计</span>
                  </div>
                  <div>
                    <strong>{summary.unlocks}</strong>
                    <span>解锁次数</span>
                  </div>
                </div>
              </section>
              {mode === 'compare' && (
                <section className="phone-analysis-card">
                  <h2>手动与自动对照</h2>
                  <p>
                    手动记录 {formatDuration(stats(state, range).tracked)} / 设备观察覆盖{' '}
                    {formatDuration(summary.active)}
                  </p>
                  <button type="button" onClick={() => onTimeline(date)}>
                    查看当天时间线
                  </button>
                </section>
              )}
              {(['devices', 'apps', 'categories', 'websites'] as const).map((key) => (
                <section className="phone-analysis-card" key={key}>
                  <h2>
                    {
                      {
                        devices: '按设备',
                        apps: '应用使用',
                        categories: '来源分类',
                        websites: '网站访问',
                      }[key]
                    }
                  </h2>
                  {summary[key].length ? (
                    summary[key].slice(0, 50).map((item) => (
                      <div className="usage-breakdown" key={item.name}>
                        <span>
                          {key === 'devices'
                            ? (result.status?.devices.find((device) => device.id === item.name)
                                ?.name ?? item.name)
                            : item.name}
                        </span>
                        <strong>{formatDuration(item.duration)}</strong>
                      </div>
                    ))
                  ) : (
                    <p>暂无记录</p>
                  )}
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
