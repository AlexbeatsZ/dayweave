import { useMemo, useState, type CSSProperties } from 'react';
import { dayRange, formatDuration, formatTime, liveSpans, type State } from '../timelog/domain';
import { Modal } from '../components/Modal';
import { useUsage } from './client';
import type { UsageEvent } from './domain';
import { createTimelineAxis, mergeUsageEvents } from './timeline-layout';
import { intervalLanes } from '../interval-lanes';
import { getTimeZone } from '../timezone';
import { useTimelineViewport } from './useTimelineViewport';
import './usage.css';

export type TimelineMode = 'manual' | 'automatic' | 'compare';
export function UsageToolbar({
  mode,
  setMode,
}: {
  mode: TimelineMode;
  setMode: (mode: TimelineMode) => void;
}) {
  return (
    <div className="usage-toolbar">
      <div className="phone-segments" aria-label="时间线视图">
        {(['manual', 'automatic', 'compare'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {{ manual: '手动记录', automatic: '自动记录', compare: '对照时间线' }[value]}
          </button>
        ))}
      </div>
    </div>
  );
}
type Block = {
  id: string;
  start: number;
  end: number;
  label: string;
  detail: string;
  color?: string;
  event?: UsageEvent;
  manualId?: string;
};
export function AlignedUsageTimeline({
  day,
  state,
  now,
  mode,
  onManual,
  filter,
}: {
  day: string;
  state: State;
  now: number;
  mode: Exclude<TimelineMode, 'manual'>;
  onManual: (id: string) => void;
  filter?: { activityId?: string; tag?: string };
}) {
  const zone = getTimeZone();
  const dayBounds = useMemo(() => dayRange(day), [day, zone]);
  const range = { start: dayBounds.start, end: Math.min(dayBounds.end, now) };
  const result = useUsage(dayBounds, false);
  const [selected, setSelected] = useState<Block>();
  const visible = (block: { start: number; end: number }) =>
    block.start < range.end &&
    (block.end > range.start || (block.start === block.end && block.start >= range.start));
  const automatic = useMemo<Block[]>(
    () =>
      mergeUsageEvents(result.events).map((event) => ({
        id: event.id,
        start: event.start,
        end: event.end,
        label:
          event.kind === 'unlock'
            ? '解锁'
            : event.app || (event.kind === 'web' ? '网页访问' : '设备活动'),
        detail: event.titles.length ? event.titles.join(' · ') : event.url,
        color: event.kind === 'web' ? '#a687bb' : event.kind === 'media' ? '#b08962' : '#638fa6',
        event,
      })),
    [result.events],
  );
  const matches = (row: { activityId: string; tags: string[] }) =>
    (!filter?.activityId || filter.activityId === row.activityId) &&
    (!filter?.tag || row.tags.includes(filter.tag));
  const savedManual = useMemo<Block[]>(
    () =>
      mode !== 'compare'
        ? []
        : state.records
            .filter((record) => !record.deletedAt && matches(record))
            .flatMap((record) =>
              record.spans.map((span, index) => ({
                ...span,
                id: `${record.id}:${index}`,
                manualId: record.id,
                label:
                  state.activities.find((activity) => activity.id === record.activityId)?.name ??
                  '活动',
                detail: record.note,
                color: state.activities.find((activity) => activity.id === record.activityId)
                  ?.color,
              })),
            ),
    [mode, state.records, state.activities, filter?.activityId, filter?.tag],
  );
  const manual = useMemo(() => {
    if (mode !== 'compare' || !state.timer || !matches(state.timer)) return savedManual;
    return [
      ...savedManual,
      ...liveSpans(state.timer, now).map((span, index) => ({
        ...span,
        id: `timer:${index}`,
        label: '正在计时',
        detail: '',
        color: '#71a8c7',
      })),
    ];
  }, [
    savedManual,
    mode,
    state.timer,
    state.timer ? now : undefined,
    filter?.activityId,
    filter?.tag,
  ]);
  const layout = useMemo(() => {
    const manualBlocks = manual.filter(visible);
    const automaticBlocks = automatic.filter(visible);
    const axis = createTimelineAxis([...manualBlocks, ...automaticBlocks], range);
    const place = (blocks: Block[]) => {
      const lanes = intervalLanes(
        blocks.filter((block) => block.end > block.start),
        (left, right) => right.end - left.end || left.id.localeCompare(right.id),
      );
      return blocks.map((block) => {
        const instant = block.end === block.start;
        const placement = lanes.get(block) ?? { lane: 0, lanes: 1 };
        const endTop = axis.top(Math.min(range.end, block.end));
        const top = instant ? Math.max(0, endTop - 11) : endTop;
        const height = instant ? 22 : axis.top(Math.max(range.start, block.start)) - endTop - 6;
        const style = {
          top,
          height,
          left: instant ? 'auto' : `${(placement.lane / placement.lanes) * 100}%`,
          right: instant ? 0 : undefined,
          width: instant ? 'min(38px, 100%)' : `${100 / placement.lanes}%`,
          '--activity-color': block.color ?? '#638fa6',
        } as CSSProperties;
        return {
          block,
          style,
          dense: placement.lanes >= 3,
          top,
          bottom: top + height,
        };
      });
    };
    return { axis, manual: place(manualBlocks), automatic: place(automaticBlocks) };
  }, [automatic, manual, range.start, range.end]);
  const { axis } = layout;
  const { element, viewport } = useTimelineViewport(axis.height);
  const columns = useMemo(() => {
    function renderColumn(blocks: typeof layout.automatic, side: 'manual' | 'automatic') {
      return blocks
        .filter(
          ({ top, bottom }) => !viewport || (bottom >= viewport.top && top <= viewport.bottom),
        )
        .map(({ block, style, dense }) => {
          const instant = block.end === block.start;
          const startTime = formatTime(block.start);
          const endTime = formatTime(block.end);
          return (
            <button
              type="button"
              key={block.id}
              className={`usage-block record-card ${side === 'manual' ? 'manual' : block.event!.kind}${instant ? ' instant' : dense ? ' dense' : ''}`}
              data-start={block.start}
              data-end={block.end}
              data-device={block.event?.deviceId}
              style={style}
              title={`${block.label} · ${startTime}–${endTime}${block.detail ? ` · ${block.detail}` : ''}`}
              onClick={() => {
                if (side === 'automatic') setSelected(block);
                else if (block.manualId) onManual(block.manualId);
              }}
            >
              <strong>{block.label}</strong>
              {!instant && (
                <>
                  <small>
                    {block.start < range.start ? formatTime(range.start) : startTime}–
                    {block.end > range.end ? formatTime(range.end) : endTime}
                  </small>
                  <span>
                    {block.detail ||
                      formatDuration(
                        Math.min(range.end, block.end) - Math.max(range.start, block.start),
                      )}
                  </span>
                </>
              )}
            </button>
          );
        });
    }
    return {
      manual: renderColumn(layout.manual, 'manual'),
      automatic: renderColumn(layout.automatic, 'automatic'),
    };
  }, [layout, viewport, range.start, range.end, onManual, zone]);
  return (
    <div className="usage-day">
      {result.loading && <p role="status">正在载入自动记录…</p>}
      {result.error && <p role="alert">{result.error}</p>}
      {!result.loading && !result.error && !axis.height && <p className="usage-empty">暂无记录</p>}
      {axis.height > 0 && (
        <div className="usage-frame" role="region" aria-label={`${day} 记录对照`}>
          <div
            ref={element}
            className={`usage-aligned ${mode}`}
            style={{ height: axis.height }}
            aria-label={`${day} 对齐时间线`}
          >
            {mode === 'compare' && (
              <div className="usage-lane manual" aria-label="手动记录列">
                {columns.manual}
              </div>
            )}
            <div className="usage-ruler">
              {axis.ticks
                .filter(
                  (tick) =>
                    !viewport ||
                    (tick.top >= viewport.top - 24 && tick.top <= viewport.bottom + 24),
                )
                .map((tick) => (
                  <time
                    key={tick.time}
                    dateTime={new Date(tick.time).toISOString()}
                    style={{ top: tick.top }}
                  >
                    {formatTime(tick.time)}
                  </time>
                ))}
            </div>
            <div className="usage-lane automatic" aria-label="自动记录列">
              {columns.automatic}
            </div>
          </div>
        </div>
      )}
      {selected && (
        <Modal close={() => setSelected(undefined)} title="自动记录详情">
          <div className="usage-detail">
            <h3>{selected.label}</h3>
            <p>
              {selected.event!.deviceName} · {selected.event!.source}
            </p>
            <p>
              {formatTime(selected.start)}–{formatTime(selected.end)} ·{' '}
              {formatDuration(selected.end - selected.start)}
            </p>
            {selected.detail && <p>{selected.detail}</p>}
            <button type="button" onClick={() => setSelected(undefined)}>
              关闭
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
