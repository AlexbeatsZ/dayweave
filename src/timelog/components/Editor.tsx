import { dateTimeInput, parseDateTimeInput } from '../../timezone';
import { useState, type FormEvent } from 'react';
import {
  colors,
  duration,
  formatDuration,
  newId,
  timestamp,
  type Activity,
  type Goal,
  type Span,
  type State,
  type TimeRecord,
  type Nature,
} from '../domain';
import { lastRecordEnd } from '../timeline';
import { Dialog } from './Dialog';
import { usePhone } from '../../phone/usePhone';
import { useStore } from '../../store';
export type EditTarget =
  | { kind: 'record'; record?: TimeRecord; range?: Span; activityId?: string }
  | { kind: 'activity'; activity?: Activity }
  | { kind: 'goal'; goal?: Goal };
export type Commit = (transform: (state: State) => State, notice?: string) => Promise<boolean>;
const localInput = (at: number) => (Number.isFinite(at) ? dateTimeInput(at) : '');
export function Editor({
  target,
  state,
  commit,
  close,
}: {
  target: EditTarget;
  state: State;
  commit: Commit;
  close: () => void;
}) {
  const phone = usePhone();
  const tagColors = useStore().data.tagColors.records;
  const record = target.kind === 'record' ? target.record : undefined;
  const fallback = { start: Date.now() - 30 * 60000, end: Date.now() };
  const [spans, setSpans] = useState<Span[]>(
    record?.spans.map((row) => ({ ...row })) || [
      target.kind === 'record' ? target.range || fallback : fallback,
    ],
  );
  const [error, setError] = useState('');
  const [activityId, setActivityId] = useState(
    record?.activityId ||
      (target.kind === 'record' ? target.activityId : undefined) ||
      state.activities.find((row) => !row.archived && !row.deletedAt)?.id ||
      '',
  );
  const [tags, setTags] = useState(record?.tags || []);
  const tagOptions = [
    ...new Set([...Object.keys(tagColors), ...state.records.flatMap((row) => row.tags)]),
  ].sort();
  const [saving, setSaving] = useState(false);
  const title =
    target.kind === 'record'
      ? record
        ? '编辑记录'
        : '添加记录'
      : target.kind === 'activity'
        ? target.activity
          ? '编辑活动'
          : '添加活动'
        : target.goal
          ? '编辑目标'
          : '添加目标';
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    const data = new FormData(event.currentTarget),
      text = (key: string) => String(data.get(key) || '').trim();
    try {
      if (target.kind === 'record') {
        if (
          spans.some(
            (span) =>
              !Number.isFinite(span.start) ||
              !Number.isFinite(span.end) ||
              span.end <= span.start ||
              span.end > Date.now() + 60000,
          )
        )
          throw new Error('请检查起止时间：结束需晚于开始，且不能晚于现在。');
        const saved = await commit((current) => {
          const activity = current.activities.find((row) => row.id === text('activityId'));
          if (!activity) throw new Error('请选择活动。');
          const previous = record && current.records.find((row) => row.id === record.id);
          if (record && previous?.updatedAt !== record.updatedAt)
            throw new Error('记录已在其他窗口更新，请重新编辑。');
          const same = record?.activityId === activity.id;
          const next: TimeRecord = {
            id: record?.id || newId(),
            ...(record?.taskId ? { taskId: record.taskId } : {}),
            activityId: activity.id,
            note: text('note'),
            tags: text('tags')
              .split(/[,，]/)
              .map((tag) => tag.trim().replace(/^#/, ''))
              .filter(Boolean),
            spans,
            nature: same ? record.nature : activity.nature,
            pointsPerHour: same ? record.pointsPerHour : activity.pointsPerHour,
            deletedAt: null,
            updatedAt: timestamp(previous?.updatedAt),
          };
          return {
            ...current,
            records: record
              ? current.records.map((row) => (row.id === record.id ? next : row))
              : [...current.records, next],
          };
        }, '记录已保存');
        if (saved) close();
        else setError('未保存，请查看提示并修正后重试。');
      } else if (target.kind === 'activity') {
        const previous = target.activity;
        const saved = await commit((current) => {
          const existing = previous && current.activities.find((row) => row.id === previous.id);
          if (previous && existing?.updatedAt !== previous.updatedAt)
            throw new Error('活动已更新，请重新编辑。');
          const nature = text('nature') as Nature,
            raw = Number(text('rate'));
          const next: Activity = {
            id: previous?.id || newId(),
            name: text('name'),
            color: text('color'),
            nature,
            pointsPerHour:
              nature === 'neutral' ? 0 : nature === 'negative' ? -Math.abs(raw) : Math.abs(raw),
            archived: false,
            updatedAt: timestamp(existing?.updatedAt),
          };
          if (
            current.activities.some(
              (row) =>
                row.id !== next.id && !row.archived && !row.deletedAt && row.name === next.name,
            )
          )
            throw new Error('已有同名活动。');
          return {
            ...current,
            activities: previous
              ? current.activities.map((row) => (row.id === next.id ? next : row))
              : [...current.activities, next],
          };
        }, '活动已保存');
        if (saved) close();
        else setError('未保存，请查看提示。');
      } else {
        const previous = target.goal;
        const saved = await commit((current) => {
          const existing = previous && current.goals.find((row) => row.id === previous.id);
          if (previous && existing?.updatedAt !== previous.updatedAt)
            throw new Error('目标已更新，请重新编辑。');
          const next: Goal = {
            id: previous?.id || newId(),
            name: text('name'),
            activityId: text('activityId'),
            minutes: Number(text('minutes')),
            period: text('period') as Goal['period'],
            archived: false,
            updatedAt: timestamp(existing?.updatedAt),
          };
          return {
            ...current,
            goals: previous
              ? current.goals.map((row) => (row.id === next.id ? next : row))
              : [...current.goals, next],
          };
        }, '目标已保存');
        if (saved) close();
        else setError('未保存，请查看提示。');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  const activityOptions = (selected?: string) =>
    state.activities
      .filter((row) => (!row.archived && !row.deletedAt) || row.id === selected)
      .map((row) => (
        <option key={row.id} value={row.id}>
          {row.name}
        </option>
      ));
  return (
    <Dialog title={title} close={close}>
      <form className={`editor ${target.kind === 'record' ? 'record-editor' : ''}`} onSubmit={save}>
        {target.kind === 'record' && (
          <>
            {phone && (
              <div className="phone-editor-duration">
                <span>记录时长</span>
                <strong>{formatDuration(duration(spans))}</strong>
              </div>
            )}
            <label>
              活动
              <select
                name="activityId"
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
                required
              >
                {activityOptions(record?.activityId)}
              </select>
            </label>
            {phone && (
              <div className="phone-activity-chips" aria-label="选择记录活动">
                {state.activities
                  .filter(
                    (row) => (!row.archived && !row.deletedAt) || row.id === record?.activityId,
                  )
                  .map((activity) => (
                    <button
                      type="button"
                      key={activity.id}
                      aria-pressed={activityId === activity.id}
                      onClick={() => setActivityId(activity.id)}
                    >
                      <i style={{ background: activity.color }} />
                      {activity.name}
                    </button>
                  ))}
              </div>
            )}
            {spans.map((span, index) => (
              <div key={index} className="form-columns">
                <label className={phone ? 'phone-date-time' : undefined}>
                  {index ? `第 ${index + 1} 段开始` : '开始时间'}
                  {phone && (
                    <span aria-hidden="true">
                      <small>{localInput(span.start).slice(0, 10).replaceAll('-', '/')}</small>
                      <strong>{localInput(span.start).slice(11, 16)}</strong>
                    </span>
                  )}
                  <input
                    aria-label={index ? `第 ${index + 1} 段开始` : '开始时间'}
                    type="datetime-local"
                    step="0.001"
                    value={Number.isFinite(span.start) ? localInput(span.start) : ''}
                    onChange={(event) =>
                      setSpans((rows) =>
                        rows.map((row, at) =>
                          at === index
                            ? {
                                ...row,
                                start: event.target.value
                                  ? parseDateTimeInput(event.target.value)
                                  : NaN,
                              }
                            : row,
                        ),
                      )
                    }
                    required
                  />
                </label>
                <label className={phone ? 'phone-date-time' : undefined}>
                  {index ? `第 ${index + 1} 段结束` : '结束时间'}
                  {phone && (
                    <span aria-hidden="true">
                      <small>{localInput(span.end).slice(0, 10).replaceAll('-', '/')}</small>
                      <strong>{localInput(span.end).slice(11, 16)}</strong>
                    </span>
                  )}
                  <input
                    aria-label={index ? `第 ${index + 1} 段结束` : '结束时间'}
                    type="datetime-local"
                    step="0.001"
                    value={Number.isFinite(span.end) ? localInput(span.end) : ''}
                    onChange={(event) =>
                      setSpans((rows) =>
                        rows.map((row, at) =>
                          at === index
                            ? {
                                ...row,
                                end: event.target.value
                                  ? parseDateTimeInput(event.target.value)
                                  : NaN,
                              }
                            : row,
                        ),
                      )
                    }
                    required
                  />
                </label>
              </div>
            ))}
            {!record && (
              <div className="time-shortcuts">
                {[15, 30, 60].map((minutes) => (
                  <button
                    type="button"
                    className="chip"
                    key={minutes}
                    onClick={() =>
                      setSpans([
                        {
                          start: Math.max(target.range?.start || 0, spans[0].end - minutes * 60000),
                          end: spans[0].end,
                        },
                      ])
                    }
                  >
                    {minutes} 分钟
                  </button>
                ))}
                <button
                  type="button"
                  className="text-button"
                  disabled={!lastRecordEnd(state, spans[0].end - 1)}
                  onClick={() =>
                    setSpans([{ start: lastRecordEnd(state, spans[0].end - 1), end: spans[0].end }])
                  }
                >
                  以上条记录结尾为开始
                </button>
                {target.range && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSpans([target.range!])}
                  >
                    填满此段
                  </button>
                )}
              </div>
            )}
            <label>
              描述
              <textarea
                name="note"
                aria-label="描述"
                defaultValue={record?.note || ''}
                maxLength={4000}
                rows={3}
                placeholder="这段时间做了什么？"
              />
            </label>
            <label>
              标签
              <input
                name="tags"
                value={tags.join(', ')}
                onChange={(event) =>
                  setTags(
                    event.target.value.split(/[,，]/).map((tag) => tag.trim().replace(/^#/, '')),
                  )
                }
                maxLength={600}
                placeholder="用逗号分隔"
              />
            </label>
            {phone && tagOptions.length > 0 && (
              <div className="phone-tag-chips" aria-label="选择记录标签">
                {tagOptions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    style={{ color: tagColors[tag] }}
                    aria-pressed={tags.includes(tag)}
                    onClick={() =>
                      setTags(
                        tags.includes(tag)
                          ? tags.filter((value) => value !== tag)
                          : [...tags.filter(Boolean), tag],
                      )
                    }
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {target.kind === 'activity' && (
          <>
            <label>
              活动名称
              <input name="name" defaultValue={target.activity?.name} maxLength={80} required />
            </label>
            <div className="form-columns">
              <label>
                性质
                <select name="nature" defaultValue={target.activity?.nature || 'positive'}>
                  <option value="positive">积极</option>
                  <option value="neutral">日常</option>
                  <option value="negative">消极</option>
                </select>
              </label>
              <label>
                每小时积分
                <input
                  name="rate"
                  type="number"
                  defaultValue={Math.abs(target.activity?.pointsPerHour ?? 20)}
                  min={0}
                  max={100000}
                  step="0.01"
                  required
                />
              </label>
            </div>
            <label>
              颜色
              <input
                name="color"
                type="color"
                defaultValue={
                  target.activity?.color || colors[state.activities.length % colors.length]
                }
              />
            </label>
            <p className="muted">积分速率调整只影响新记录。</p>
          </>
        )}
        {target.kind === 'goal' && (
          <>
            <label>
              目标名称
              <input name="name" defaultValue={target.goal?.name} maxLength={80} required />
            </label>
            <label>
              关联活动
              <select
                name="activityId"
                defaultValue={
                  target.goal?.activityId ||
                  state.activities.find((row) => !row.archived && !row.deletedAt)?.id
                }
                required
              >
                {activityOptions(target.goal?.activityId)}
              </select>
            </label>
            <div className="form-columns">
              <label>
                周期
                <select name="period" defaultValue={target.goal?.period || 'day'}>
                  <option value="day">每日</option>
                  <option value="week">每周</option>
                </select>
              </label>
              <label>
                目标时长（分钟）
                <input
                  name="minutes"
                  type="number"
                  defaultValue={target.goal?.minutes || 30}
                  min={1}
                  max={1000000}
                  required
                />
              </label>
            </div>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button className="secondary" type="button" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
