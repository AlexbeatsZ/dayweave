import { dateTimeInput, parseDateTimeInput } from '../../timezone';
import { useState, type FormEvent } from 'react';
import {
  activeActivity,
  colors,
  duration,
  formatDuration,
  emptyRule,
  type RecordRule,
  goalTargetText,
  MAX_BEHAVIOR_TEXT,
  newId,
  parseGoalTarget,
  timestamp,
  type Activity,
  type Goal,
  type Span,
  type State,
  type TimeRecord,
  type Nature,
  type ScriptParam,
} from '../domain';
import { lastRecordEnd } from '../timeline';
import { Dialog } from './Dialog';
import { GoalRules } from './GoalRules';
import { GoalScripts } from './GoalScripts';
import { TagToggles } from './TagChips';
import { usePhone } from '../../phone/usePhone';
import { useStore } from '../../store';
export type EditTarget =
  | { kind: 'record'; record?: TimeRecord; range?: Span; activityId?: string }
  | { kind: 'activity'; activity?: Activity; nature?: Nature }
  | { kind: 'goal'; goal?: Goal };
export type Commit = (
  transform: (state: State) => State,
  notice?: string,
  onError?: (message: string) => void,
) => Promise<boolean>;
const localInput = (at: number) => (Number.isFinite(at) ? dateTimeInput(at) : '');
export function Editor({
  target,
  state,
  commit: runCommit,
  close,
}: {
  target: EditTarget;
  state: State;
  commit: Commit;
  close: () => void;
}) {
  const phone = usePhone();
  const { data } = useStore();
  const tagColors = data.tagColors.records;
  const [goalKind, setGoalKind] = useState<NonNullable<Goal['kind']> | 'time'>(
    target.kind === 'goal' ? (target.goal?.kind ?? 'time') : 'time',
  );
  const editedScriptGoal =
    target.kind === 'goal' && target.goal?.kind === 'script' ? target.goal : undefined;
  const editedBehavior =
    target.kind === 'goal' && target.goal?.kind === 'behaviorRule' ? target.goal : undefined;
  const [scriptId, setScriptId] = useState(
    editedScriptGoal?.scriptId ?? state.scripts?.[0]?.id ?? '',
  );
  const [scriptParams, setScriptParams] = useState<Record<string, ScriptParam>>(
    editedScriptGoal?.params ?? {},
  );
  const [goalPeriod, setGoalPeriod] = useState<Goal['period']>(
    target.kind === 'goal' ? (target.goal?.period ?? 'day') : 'day',
  );
  const goalGroups = [...new Set(state.goals.flatMap((goal) => (goal.group ? [goal.group] : [])))];
  const taskTags = [
    ...new Set([...Object.keys(data.tagColors.tasks), ...data.tasks.flatMap((task) => task.tags)]),
  ].sort();
  const record = target.kind === 'record' ? target.record : undefined;
  const fallback = { start: Date.now() - 30 * 60000, end: Date.now() };
  const [spans, setSpans] = useState<Span[]>(
    record?.spans.map((row) => ({ ...row })) || [
      target.kind === 'record' ? target.range || fallback : fallback,
    ],
  );
  const [error, setError] = useState('');
  const commit: Commit = (transform, notice) => runCommit(transform, notice, setError);
  const [activityId, setActivityId] = useState(
    record?.activityId ||
      (target.kind === 'record' ? target.activityId : undefined) ||
      state.activities.find(activeActivity)?.id ||
      '',
  );
  const [tags, setTags] = useState(record?.tags || []);
  const [rules, setRules] = useState<RecordRule[]>(() =>
    target.kind === 'goal' && target.goal?.kind === undefined && target.goal
      ? target.goal.rules
      : [emptyRule()],
  );
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
          if (!activity || (!activeActivity(activity) && record?.activityId !== activity.id))
            throw new Error('请选择可用的活动。');
          const previous = record && current.records.find((row) => row.id === record.id);
          if (record && previous?.updatedAt !== record.updatedAt)
            throw new Error('记录已在其他窗口更新，请重新编辑。');
          const same = record?.activityId === activity.id;
          const next: TimeRecord = {
            id: record?.id || newId(),
            ...(record?.taskId ? { taskId: record.taskId } : {}),
            activityId: activity.id,
            note: text('note'),
            tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
            spans,
            nature: same ? record.nature : activity.nature,
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
      } else if (target.kind === 'activity') {
        const previous = target.activity;
        const saved = await commit((current) => {
          const existing = previous && current.activities.find((row) => row.id === previous.id);
          if (previous && existing?.updatedAt !== previous.updatedAt)
            throw new Error('活动已更新，请重新编辑。');
          const nature = text('nature') as Nature;
          const next: Activity = {
            id: previous?.id || newId(),
            name: text('name'),
            color: text('color'),
            nature,
            archived: false,
            ...(existing?.order === undefined ? {} : { order: existing.order }),
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
      } else {
        const previous = target.goal;
        const saved = await commit((current) => {
          const existing = previous && current.goals.find((row) => row.id === previous.id);
          if (previous && existing?.updatedAt !== previous.updatedAt)
            throw new Error('目标已更新，请重新编辑。');
          const group = text('group');
          const base = {
            id: previous?.id || newId(),
            name: text('name'),
            ...(group ? { group } : {}),
            period: goalPeriod,
            archived: false,
            ...(existing?.order === undefined ? {} : { order: existing.order }),
            updatedAt: timestamp(existing?.updatedAt),
          };
          let next: Goal;
          switch (goalKind) {
            case 'behaviorRule':
              next = {
                ...base,
                kind: goalKind,
                period: 'day',
                trigger: text('trigger'),
                action: text('action'),
              };
              break;
            case 'script':
              if (!current.scripts?.some((row) => row.id === scriptId))
                throw new Error('请选择或新建一个脚本。');
              next = { ...base, kind: goalKind, scriptId, params: scriptParams };
              break;
            case 'tasks':
              next = { ...base, kind: goalKind, taskTag: text('taskTag').replace(/^#+/, '') };
              break;
            case 'manual':
              next = {
                ...base,
                kind: goalKind,
                checks: existing?.kind === 'manual' ? existing.checks : {},
              };
              break;
            case 'time':
              next = { ...base, rules, ...parseGoalTarget(text('target')) };
              break;
          }
          return {
            ...current,
            goals: previous
              ? current.goals.map((row) => (row.id === next.id ? next : row))
              : [...current.goals, next],
          };
        }, '目标已保存');
        if (saved) close();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  const recordActivities = state.activities.filter(
    (row) => activeActivity(row) || row.id === record?.activityId,
  );
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
                {!recordActivities.some((row) => row.id === activityId) && (
                  <option value="" disabled>
                    请选择活动
                  </option>
                )}
                {recordActivities.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {phone && (
              <div className="phone-activity-chips" aria-label="选择记录活动">
                {recordActivities.map((activity) => (
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
              <div className="quick-chips" aria-label="快速设置时间">
                <button
                  type="button"
                  disabled={!lastRecordEnd(state, spans[0].end - 1)}
                  onClick={() =>
                    setSpans([{ start: lastRecordEnd(state, spans[0].end - 1), end: spans[0].end }])
                  }
                >
                  接上条记录
                </button>
                {[15, 30, 60].map((minutes) => (
                  <button
                    type="button"
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
                    最近 {minutes} 分钟
                  </button>
                ))}
                {target.range && (
                  <button type="button" onClick={() => setSpans([target.range!])}>
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
            <div className="form-field">
              <span>标签</span>
              <TagToggles
                label="记录标签"
                options={tagOptions}
                selected={tags}
                colors={tagColors}
                onChange={setTags}
              />
            </div>
          </>
        )}
        {target.kind === 'activity' && (
          <>
            <label>
              活动名称
              <input name="name" defaultValue={target.activity?.name} maxLength={80} required />
            </label>
            <label>
              性质
              <select
                name="nature"
                defaultValue={target.activity?.nature || target.nature || 'positive'}
              >
                <option value="positive">积极</option>
                <option value="neutral">日常</option>
                <option value="negative">消极</option>
              </select>
            </label>
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
          </>
        )}
        {target.kind === 'goal' && (
          <>
            <label>
              目标名称
              <input name="name" defaultValue={target.goal?.name} maxLength={80} required />
            </label>
            <div className="form-columns">
              <label>
                分组
                <input
                  name="group"
                  list="goal-groups"
                  defaultValue={target.goal?.group}
                  maxLength={80}
                  placeholder="不分组"
                />
                <datalist id="goal-groups">
                  {goalGroups.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
              </label>
              <label>
                周期
                <select
                  name="period"
                  aria-label="周期"
                  value={goalKind === 'behaviorRule' ? 'day' : goalPeriod}
                  disabled={goalKind === 'behaviorRule'}
                  onChange={(event) => setGoalPeriod(event.target.value as Goal['period'])}
                >
                  <option value="day">每日</option>
                  <option value="week">每周</option>
                </select>
              </label>
            </div>
            <label>
              判定方式
              <select
                aria-label="判定方式"
                value={goalKind}
                onChange={(event) => setGoalKind(event.target.value as typeof goalKind)}
              >
                <option value="time">自动：按计时</option>
                <option value="tasks">绑定待办标签</option>
                <option value="manual">手动勾选</option>
                <option value="behaviorRule">行为规则</option>
                <option value="script">自动化脚本</option>
              </select>
            </label>
            {goalKind === 'time' && (
              <>
                <GoalRules
                  state={state}
                  tagOptions={tagOptions}
                  rules={rules}
                  onChange={setRules}
                />
                <label>
                  目标时间
                  <input
                    name="target"
                    defaultValue={
                      target.goal && target.goal.kind === undefined
                        ? goalTargetText(target.goal)
                        : '30'
                    }
                    placeholder="9h、<2h、8-16h、<1-3h"
                    maxLength={200}
                    required
                  />
                </label>
                <p className="muted">
                  纯数字按分钟、表示至少；&lt; 表示不超过。写范围即分阶段：8-16h 为 8 到 16
                  小时每小时一阶，&lt;1-3h 为 ≤1h、≤2h、≤3h。
                </p>
              </>
            )}
            {goalKind === 'tasks' && (
              <>
                <label>
                  待办标签
                  <input
                    name="taskTag"
                    list="goal-task-tags"
                    defaultValue={target.goal?.kind === 'tasks' ? target.goal.taskTag : ''}
                    maxLength={40}
                    required
                  />
                  <datalist id="goal-task-tags">
                    {taskTags.map((tag) => (
                      <option key={tag} value={tag} />
                    ))}
                  </datalist>
                </label>
                <p className="muted">
                  周期内带这个标签的待办全部完成才算达成；没有这类待办时算未达成。
                </p>
              </>
            )}
            {goalKind === 'script' && (
              <GoalScripts
                state={state}
                commit={commit}
                period={goalPeriod}
                scriptId={scriptId}
                onScript={(id) => {
                  if (id !== scriptId) setScriptParams({});
                  setScriptId(id);
                }}
                params={scriptParams}
                onParams={setScriptParams}
              />
            )}
            {goalKind === 'manual' && (
              <p className="muted">在目标卡片上勾选；AI 也可以代为勾选。</p>
            )}
            {goalKind === 'behaviorRule' ? (
              <>
                <label>
                  触发条件（P）
                  <textarea
                    name="trigger"
                    rows={2}
                    defaultValue={editedBehavior?.trigger}
                    placeholder="例如：第二次重复考虑已经想过的理由"
                    maxLength={MAX_BEHAVIOR_TEXT}
                    required
                  />
                </label>
                <label>
                  目标行为（Q）
                  <textarea
                    name="action"
                    rows={2}
                    defaultValue={editedBehavior?.action}
                    placeholder="例如：打开速记，写下问题与下一步"
                    maxLength={MAX_BEHAVIOR_TEXT}
                    required
                  />
                </label>
                <p className="muted">每日回顾，结算后只可查看。</p>
              </>
            ) : (
              <p className="muted">周期结束后才判定是否达成。</p>
            )}
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
          <button
            className="primary"
            disabled={saving || (target.kind === 'record' && !recordActivities.length)}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
