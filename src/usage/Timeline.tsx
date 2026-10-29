import { useState, type CSSProperties } from 'react';
import { dayRange, formatDuration, formatTime, liveSpans, type State } from '../timelog/domain';
import { Modal } from '../components/Modal';
import { useUsage } from './client';
import type { UsageEvent, UsageStatus } from './domain';
import './usage.css';

export type TimelineMode = 'manual' | 'automatic' | 'compare';
export function UsageToolbar({
  mode,
  setMode,
  deviceId,
  setDeviceId,
  status,
}: {
  mode: TimelineMode;
  setMode: (mode: TimelineMode) => void;
  deviceId: string;
  setDeviceId: (id: string) => void;
  status?: UsageStatus;
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
      {mode !== 'manual' && (
        <div className="usage-actions">
          <select
            aria-label="自动记录设备"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            <option value="">全部设备</option>
            {status?.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </div>
      )}
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
  deviceId,
  onManual,
  filter,
}: {
  day: string;
  state: State;
  now: number;
  mode: Exclude<TimelineMode, 'manual'>;
  deviceId: string;
  onManual: (id: string) => void;
  filter?: { activityId?: string; tag?: string };
}) {
  const range = dayRange(day),
    result = useUsage({ ...range, deviceId: deviceId || undefined }, false);
  const [selected, setSelected] = useState<Block>();
  const [scale, setScale] = useState(1);
  const automatic: Block[] = [];
  for (const event of result.events
    .slice()
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))) {
    const previous = automatic.at(-1);
    if (
      previous?.event &&
      event.kind === 'app' &&
      previous.event.kind === 'app' &&
      previous.event.deviceId === event.deviceId &&
      previous.event.app === event.app &&
      previous.event.title === event.title &&
      event.start - previous.end <= 1000 &&
      event.start >= previous.start
    )
      previous.end = Math.max(previous.end, event.end);
    else
      automatic.push({
        id: event.id,
        start: event.start,
        end: event.end,
        label:
          event.kind === 'unlock'
            ? '解锁'
            : event.app || (event.kind === 'web' ? '网页访问' : '设备活动'),
        detail: event.title || event.url,
        event,
      });
  }
  const matches = (row: { activityId: string; tags: string[] }) =>
    (!filter?.activityId || filter.activityId === row.activityId) &&
    (!filter?.tag || row.tags.includes(filter.tag));
  const manual: Block[] = state.records
    .filter((record) => !record.deletedAt && matches(record))
    .flatMap((record) =>
      record.spans.map((span, index) => ({
        ...span,
        id: `${record.id}:${index}`,
        manualId: record.id,
        label:
          state.activities.find((activity) => activity.id === record.activityId)?.name ?? '活动',
        detail: record.note,
        color: state.activities.find((activity) => activity.id === record.activityId)?.color,
      })),
    );
  if (state.timer && matches(state.timer))
    manual.push(
      ...liveSpans(state.timer, now).map((span, index) => ({
        ...span,
        id: `timer:${index}`,
        label: '正在计时',
        detail: '',
        color: '#71a8c7',
      })),
    );
  const end = Math.max(range.start + 60000, Math.min(range.end, now)),
    height = Math.max(120, ((end - range.start) / 60000) * scale);
  const laneKey = (block: Block) =>
    `${block.event!.deviceId}:${block.event!.kind === 'web' ? 'web' : 'app'}`;
  const devices = [...new Set(automatic.map(laneKey))];
  const manualLanes = new Map<string, number>(),
    manualEnds: number[] = [];
  for (const block of manual
    .filter((row) => row.end >= range.start && row.start < end)
    .sort((left, right) => left.start - right.start)) {
    const free = manualEnds.findIndex((at) => at <= block.start),
      lane = free < 0 ? manualEnds.length : free;
    manualEnds[lane] = block.end;
    manualLanes.set(block.id, lane);
  }
  function style(block: Block, side: 'manual' | 'automatic'): CSSProperties {
    const top = ((end - Math.min(end, block.end)) / 60000) * scale;
    const bottom = Math.max(range.start, block.start);
    const lane =
      side === 'automatic'
        ? Math.max(0, devices.indexOf(laneKey(block)))
        : (manualLanes.get(block.id) ?? 0);
    const count =
      side === 'automatic' ? Math.max(1, devices.length) : Math.max(1, manualEnds.length);
    return {
      top,
      height: Math.max(3, ((Math.min(end, block.end) - bottom) / 60000) * scale),
      left: `${(lane / count) * 100}%`,
      width: `${100 / count}%`,
      '--usage-color': block.color ?? '#638fa6',
    } as CSSProperties;
  }
  const visible = (blocks: Block[]) =>
    blocks.filter((block) => block.end >= range.start && block.start < end);
  return (
    <div className="usage-day">
      <div className="usage-day-heading">
        <span>{mode === 'compare' ? '手动记录 / 自动记录' : '自动记录'}</span>
        <label>
          缩放
          <select
            aria-label="时间线缩放"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
      </div>
      {result.loading && <p role="status">正在载入自动记录…</p>}
      {result.error && <p role="alert">{result.error}</p>}
      {!result.loading && !result.error && !automatic.length && (
        <p className="usage-empty">暂无记录</p>
      )}
      <div className={`usage-aligned ${mode}`} style={{ height }} aria-label={`${day} 对齐时间线`}>
        <div className="usage-ruler">
          {Array.from(
            { length: Math.floor((end - range.start) / 3600000) + 1 },
            (_, index) => range.start + index * 3600000,
          ).map((time) => (
            <time key={time} style={{ top: ((end - time) / 60000) * scale }}>
              {formatTime(time)}
            </time>
          ))}
        </div>
        {mode === 'compare' && (
          <div className="usage-lane manual" aria-label="手动记录列">
            {visible(manual).map((block) => (
              <button
                type="button"
                key={block.id}
                className="usage-block manual"
                data-start={block.start}
                style={style(block, 'manual')}
                onClick={() => {
                  if (block.manualId) onManual(block.manualId);
                }}
                title={`${block.label} ${formatTime(block.start)}–${formatTime(block.end)}`}
              >
                <strong>{block.label}</strong>
                <small>{formatDuration(block.end - block.start)}</small>
              </button>
            ))}
          </div>
        )}
        <div className="usage-lane automatic" aria-label="自动记录列">
          {visible(automatic).map((block) => (
            <button
              type="button"
              key={block.id}
              className={`usage-block ${block.event!.kind}`}
              data-start={block.start}
              data-device={block.event!.deviceId}
              style={style(block, 'automatic')}
              title={`${block.event!.deviceName} · ${block.label} · ${block.detail}`}
              onClick={() => setSelected(block)}
            >
              <strong>{block.label}</strong>
              <small>{block.event!.deviceName}</small>
              <span>{block.detail}</span>
            </button>
          ))}
        </div>
      </div>
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
            <p>{selected.event!.url}</p>
            <button type="button" onClick={() => setSelected(undefined)}>
              关闭
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
