import { useState, type CSSProperties } from 'react';
import { dayRange, formatDuration, formatTime, liveSpans, type State } from '../timelog/domain';
import { Modal } from '../components/Modal';
import { pickText, exportText } from '../files';
import { parseUsageImport } from './import';
import { loadUsageRange, usageBridge, usageChanged, useUsage } from './client';
import type { UsageEvent, UsageStatus } from './domain';
import './usage.css';

export type TimelineMode = 'manual' | 'automatic' | 'compare';
export function UsageToolbar({
  mode,
  setMode,
  deviceId,
  setDeviceId,
  day,
  status,
}: {
  mode: TimelineMode;
  setMode: (mode: TimelineMode) => void;
  deviceId: string;
  setDeviceId: (id: string) => void;
  day: string;
  status?: UsageStatus;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function action(operation: () => Promise<string>) {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await operation());
      usageChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="usage-toolbar">
      <div className="phone-segments" aria-label="时间线视图">
        {(['manual', 'automatic', 'compare'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setMessage('');
            }}
          >
            {{ manual: '手动记录', automatic: '自动记录', compare: '对照时间线' }[value]}
          </button>
        ))}
      </div>
      <div className="usage-actions">
        {mode !== 'manual' && (
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
        )}
        <details>
          <summary>载入与同步</summary>
          <div className="usage-menu">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await usageBridge().sync();
                  return '已刷新本地记录；未配对中心时不会上传，投递情况以最近同步时间为准';
                })
              }
            >
              立即同步自动记录
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const text = await pickText('.json');
                  if (!text) return '已取消载入';
                  const events = parseUsageImport(JSON.parse(text));
                  if (
                    !window.confirm(
                      `载入 ${events.length} 条自动记录？将按来源 ID 合并，不修改原文件或手动记录。`,
                    )
                  )
                    return '已取消载入';
                  return `已载入 ${await usageBridge().import(events)} 条新增或修订记录`;
                })
              }
            >
              载入 AW / Work Review JSON
            </button>
            {window.clearlist?.usageSource && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      (await window.clearlist!.usageSource!('work-review'))
                        ? '已连接 Work Review 数据库，只读载入'
                        : '已取消连接',
                    )
                  }
                >
                  连接 Work Review 数据库
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () =>
                      (await window.clearlist!.usageSource!('activitywatch'))
                        ? '已连接 AW 接收目录，只读载入'
                        : '已取消连接',
                    )
                  }
                >
                  连接 AW 接收目录
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const events = await loadUsageRange({
                    ...dayRange(day),
                    deviceId: deviceId || undefined,
                  });
                  await exportText(
                    `Dayweave-usage-${day}.json`,
                    JSON.stringify({ format: 'dayweave-usage', version: 1, events }, null, 2),
                  );
                  return '当天自动记录已导出';
                })
              }
            >
              导出当天自动记录
            </button>
          </div>
        </details>
      </div>
      {status && mode !== 'manual' && (
        <p className="usage-empty">
          {status.lastSync
            ? `本地记录 · 最近同步 ${new Date(status.lastSync).toLocaleString()}`
            : '本地记录 · 尚无中心同步回执'}
          {status.error ? ` · ${status.error}` : ''}
        </p>
      )}
      {message && <p role="status">{message}</p>}
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
        <span>{mode === 'compare' ? '手动记录 / 自动记录' : '自动记录'} · 同一时间刻度</span>
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
        <p className="usage-empty">
          本地没有此日期的自动记录。可在“载入与同步”导入历史或同步中心；没有记录不代表没有使用设备。
        </p>
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
            <p>{selected.detail || '此来源未提供标题'}</p>
            <p>{selected.event!.url}</p>
            <p>这是一条设备观察，不会自动增加手动记录或积分。</p>
            <button type="button" onClick={() => setSelected(undefined)}>
              关闭
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
