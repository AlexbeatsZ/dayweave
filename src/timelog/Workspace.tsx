import { getTimeZone } from '../timezone';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, Clock3, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import {
  activeActivity,
  dayKey,
  dayRange,
  dayStart,
  duration,
  formatClock,
  formatDuration,
  formatPoints,
  formatTime,
  liveSpans,
  natureLabels,
  timestamp,
  type State,
} from './domain';
import { mutateState } from './storage';
import { useStore } from '../store';
import { useClock } from '../runtime';
import { adjacentGap, buildTimeline, fillAdjacentGap, type TimelineEntry } from './timeline';
import { Dialog } from './components/Dialog';
import { Editor, type EditTarget } from './components/Editor';
import { FloatingAdd } from '../phone/Navigation';
import { TimelineEntries } from './components/TimelineEntries';
import { Goals } from './components/Goals';
import { useTimelineDays } from '../phone/useTimelineDays';
import { TimerPanel } from './components/TimerPanel';
import { DateNavigator } from '../phone/DateNavigator';
import { AlignedUsageTimeline, UsageToolbar, type TimelineMode } from '../usage/Timeline';
import { CaptureControl } from '../usage/Settings';
import { useUsage } from '../usage/client';
export type TimePage = 'timeline' | 'timer' | 'goals';
type Confirm = { title: string; body: string; action: () => Promise<boolean> };
const activityStyle = (color: string) => ({ '--activity-color': color }) as CSSProperties;
const points = (value: number) => `${value > 0 ? '+' : ''}${formatPoints(value)}`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function Workspace({
  page,
  onPageChange,
  initialDate,
  filter,
}: {
  page: TimePage;
  onPageChange: (page: TimePage) => void;
  initialDate?: string;
  filter?: { activityId?: string; tag?: string };
}) {
  const { data, loaded } = useStore();
  const state = data.timelog;
  const [date, setVisibleDate] = useState(initialDate ?? dayKey(Date.now()));
  const now = useClock();
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('manual');
  const [usageDevice, setUsageDevice] = useState('');
  const usage = useUsage();
  const timeline = useTimelineDays(page === 'timeline', date, setVisibleDate);
  const setDate = timeline.jump;
  const [editor, setEditor] = useState<EditTarget | null>(null),
    [confirmation, setConfirmation] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingWrites = useRef(0);
  useEffect(() => {
    const back = (event: Event) => {
      if (editor) setEditor(null);
      else if (confirmation) setConfirmation(null);
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('clearlist:back', back, true);
    return () => document.removeEventListener('clearlist:back', back, true);
  }, [editor, confirmation]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 10000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (editor || confirmation)
      document.querySelectorAll('details[open]').forEach((menu) => menu.removeAttribute('open'));
  }, [editor, confirmation]);
  useEffect(() => {
    document.title = state?.timer
      ? `${formatClock(duration(liveSpans(state.timer, now)))} · 时织`
      : '时织 · Dayweave';
  }, [state?.timer, now]);
  async function commit(transform: (current: State) => State, message = '已保存') {
    pendingWrites.current += 1;
    setBusy(true);
    try {
      await mutateState(transform);
      if (message) setNotice({ text: message, error: false });
      return true;
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
      return false;
    } finally {
      pendingWrites.current -= 1;
      setBusy(pendingWrites.current > 0);
    }
  }
  if (!loaded)
    return (
      <main className="loading">
        <Clock3 />
        <p>正在打开时间记录…</p>
      </main>
    );
  const getActivity = (id: string) => state.activities.find((row) => row.id === id)!;
  const timer = state.timer;
  const matches = (row: TimelineEntry) =>
    (!filter?.activityId && !filter?.tag) ||
    (row.kind === 'record' &&
      (!filter.activityId || row.record.activityId === filter.activityId) &&
      (!filter.tag || row.record.tags.includes(filter.tag)));
  const endText = (at: number, day: string) =>
    at === dayRange(day).end ? '24:00' : formatTime(at);
  function requestFill(
    row: Extract<TimelineEntry, { kind: 'record' }>,
    direction: 'up' | 'down',
    day: string,
    group: TimelineEntry[],
  ) {
    const gap = adjacentGap(group, row, direction);
    if (!gap) return;
    setConfirmation({
      title: `填满${direction === 'up' ? '上方' : '下方'}空闲时间`,
      body: `将「${getActivity(row.record.activityId).name}」延长 ${formatDuration(gap.end - gap.start)}（${formatTime(gap.start)}–${endText(gap.end, day)}）。`,
      action: () =>
        commit(
          (current) =>
            fillAdjacentGap(
              current,
              row.record.id,
              row.spanIndex,
              row.record.updatedAt,
              day,
              direction,
              Date.now(),
            ),
          '已填满空闲时间',
        ),
    });
  }
  function addRecord(range?: { start: number; end: number }) {
    const end = Math.min(Date.now(), dayRange(date).end);
    setEditor({
      kind: 'record',
      activityId: state.activities.find(activeActivity)?.id,
      range: range ?? { start: Math.max(dayStart(date), end - 1800000), end },
    });
  }
  function renderRecord(
    row: Extract<TimelineEntry, { kind: 'record' }>,
    day: string,
    group: TimelineEntry[],
  ) {
    const record = row.record,
      activity = getActivity(record.activityId),
      up = adjacentGap(group, row, 'up'),
      down = adjacentGap(group, row, 'down');
    return (
      <article
        className="record-card"
        style={activityStyle(activity.color)}
        data-record-id={record.id}
      >
        <div className="card-main">
          <span className="activity-mark">{activity.name.slice(0, 1)}</span>
          <div
            className="card-content"
            role="button"
            tabIndex={0}
            aria-label={`编辑${activity.name}记录`}
            onClick={() => setEditor({ kind: 'record', record })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setEditor({ kind: 'record', record });
              }
            }}
          >
            <h3>
              {activity.name}
              <span className={`nature ${record.nature}`}>{natureLabels[record.nature]}</span>
            </h3>
            <div className="phone-record-numbers">
              <span>{formatDuration(row.end - row.start)}</span>
              <strong className={record.pointsPerHour < 0 ? 'negative-text' : 'positive-text'}>
                {points(((row.end - row.start) / 3600000) * record.pointsPerHour)}
              </strong>
            </div>
            {record.note && <p className="record-note">{record.note}</p>}
            {!!record.tags.length && (
              <div className="tags">
                {record.tags.map((tag, index) => (
                  <span key={index} style={{ color: data.tagColors.records[tag] }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <div className="card-meta">
              <span>
                {formatTime(row.start)}–{endText(row.end, day)}
              </span>
              <span>{formatDuration(row.end - row.start)}</span>
              <span className={record.pointsPerHour < 0 ? 'negative-text' : 'positive-text'}>
                {points(((row.end - row.start) / 3600000) * record.pointsPerHour)} 分
              </span>
              {record.spans.length > 1 && <span>第 {row.spanIndex + 1} 段</span>}
            </div>
          </div>
          <details className="card-menu">
            <summary aria-label={`记录操作 ${activity.name}`}>
              <MoreHorizontal size={20} />
            </summary>
            <div>
              <button onClick={() => setEditor({ kind: 'record', record })}>
                <Pencil size={14} />
                编辑记录
              </button>
              <button
                className="danger"
                onClick={() =>
                  setConfirmation({
                    title: '删除记录',
                    body: `删除「${activity.name}」${formatDuration(duration(record.spans))} 的记录？`,
                    action: () =>
                      commit((current) => {
                        const latest = current.records.find((item) => item.id === record.id);
                        if (latest?.updatedAt !== record.updatedAt)
                          throw new Error('记录已更新，请重新查看。');
                        return {
                          ...current,
                          records: current.records.map((item) =>
                            item.id === record.id
                              ? {
                                  ...item,
                                  deletedAt: Date.now(),
                                  updatedAt: timestamp(item.updatedAt),
                                }
                              : item,
                          ),
                        };
                      }, '记录已删除'),
                  })
                }
              >
                <Trash2 size={14} />
                删除记录
              </button>
            </div>
          </details>
        </div>
        {(up || down) && (
          <div className="fill-actions">
            {up && (
              <button
                aria-label={`填满上方空闲时间 ${activity.name}`}
                onClick={() => requestFill(row, 'up', day, group)}
              >
                <ArrowUp size={13} />
                填满上方空闲
              </button>
            )}
            {down && (
              <button
                aria-label={`填满下方空闲时间 ${activity.name}`}
                onClick={() => requestFill(row, 'down', day, group)}
              >
                <ArrowDown size={13} />
                填满下方空闲
              </button>
            )}
          </div>
        )}
      </article>
    );
  }
  return (
    <div className="workspace-shell">
      <main className="main">
        <div className={`panel-content ${page}`}>
          {page === 'timeline' && (
            <>
              <div className="phone-record-toolbar">
                <div className="panel-toolbar">
                  <DateNavigator date={date} onDate={setDate} />
                </div>
                <UsageToolbar
                  mode={timelineMode}
                  setMode={setTimelineMode}
                  deviceId={usageDevice}
                  setDeviceId={setUsageDevice}
                  status={usage.status}
                />
                {timelineMode !== 'manual' &&
                  usage.status &&
                  (!usage.status.settings.enabled || usage.status.permissionRequired) && (
                    <CaptureControl status={usage.status} />
                  )}
                <FloatingAdd
                  label="添加记录"
                  disabled={date > dayKey(now)}
                  onClick={() => addRecord()}
                />
              </div>
              <div ref={timeline.list} className="timeline-list phone-day-groups">
                {timeline.dates.map((day) => {
                  const group = buildTimeline(state, day, now, false);
                  const shown = group.filter(matches);
                  return (
                    <section
                      key={day}
                      className="phone-timeline-day"
                      data-timeline-day={day}
                      aria-label={`${day} 时间线`}
                    >
                      <h2>
                        {day.slice(5).replace('-', '月')}日 ·{' '}
                        {new Date(dayStart(day)).toLocaleDateString('zh-CN', {
                          timeZone: getTimeZone(),
                          weekday: 'short',
                        })}
                      </h2>
                      {timelineMode !== 'manual' ? (
                        <AlignedUsageTimeline
                          day={day}
                          state={state}
                          now={now}
                          mode={timelineMode}
                          deviceId={usageDevice}
                          devices={usage.status?.devices}
                          filter={filter}
                          onManual={(id) => {
                            const record = state.records.find((row) => row.id === id);
                            if (record) setEditor({ kind: 'record', record });
                          }}
                        />
                      ) : (
                        <TimelineEntries
                          entries={shown}
                          day={day}
                          renderRecord={(row) => renderRecord(row, day, group)}
                          addRecord={addRecord}
                          showTimer={() => onPageChange('timer')}
                          timerName={timer ? getActivity(timer.activityId).name : ''}
                        />
                      )}
                      {timelineMode === 'manual' && !shown.length && (
                        <p className="phone-analysis-empty">
                          {filter?.activityId || filter?.tag
                            ? '没有匹配记录'
                            : '这个日期还没有可记录的时间'}
                        </p>
                      )}
                    </section>
                  );
                })}
                <div className="phone-history-sentinel" aria-hidden="true" />
              </div>
            </>
          )}
          {page === 'timer' && (
            <TimerPanel
              tagColors={data.tagColors.records}
              state={state}
              tasks={data.tasks}
              now={now}
              commit={commit}
              editActivity={(activity, nature) => setEditor({ kind: 'activity', activity, nature })}
              onFinished={() => {
                setDate(dayKey(Date.now()));
                onPageChange('timeline');
              }}
            />
          )}
          {page === 'goals' && (
            <>
              <FloatingAdd label="添加目标" onClick={() => setEditor({ kind: 'goal' })} />
              <Goals
                state={state}
                date={dayKey(now)}
                edit={(goal) => setEditor({ kind: 'goal', goal })}
                remove={(goal) => {
                  void commit(
                    (current) => ({
                      ...current,
                      goals: current.goals.filter((row) => row.id !== goal.id),
                    }),
                    '目标已删除',
                  );
                }}
              />
            </>
          )}
        </div>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {editor && (
        <Editor
          key={JSON.stringify(editor)}
          target={editor}
          state={state}
          commit={commit}
          close={() => setEditor(null)}
        />
      )}
      {confirmation && (
        <Dialog title={confirmation.title} close={() => setConfirmation(null)}>
          <p className="confirm-body">{confirmation.body}</p>
          <footer className="dialog-actions">
            <button className="secondary" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (await confirmation.action()) setConfirmation(null);
              }}
            >
              确认
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
