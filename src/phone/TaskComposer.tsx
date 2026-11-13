import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { CalendarDays, ListChecks, Plus, Repeat2, Timer, Trash2, X } from 'lucide-react';
import {
  difficultyLabels,
  formatTaskMinutes,
  newTask,
  recordedTaskMinutes,
  taskPrefix,
  copyTask,
  uid,
  type Task,
  type TaskDifficulty,
} from '../model';
import { store, useStore } from '../store';
import { Modal } from '../components/Modal';
import { PlanGroupModal } from '../components/PlanGroupModal';
import { TaskDatesEditor } from '../components/TaskDatesEditor';
import { configureRepeat } from '../task-repeat';
import { TaskCheck } from '../components/TaskCheck';
import { RecurrenceEditor } from '../components/RecurrenceEditor';
import { configureRecurrence } from '../event-domain';
import { usePhone } from './usePhone';

export function TaskComposer({
  initialDate,
  listId,
  today,
  close,
  saved,
  task,
  onDelete,
  onTrack,
}: {
  initialDate: string;
  listId: string;
  today: string;
  close: () => void;
  saved: () => void;
  task?: Task;
  onDelete?: (task: Task) => void;
  onTrack?: (id: string) => void;
}) {
  const phone = usePhone();
  const { data } = useStore();
  const [revision] = useState(task?.updatedAt);
  const [title, setTitle] = useState(task?.title ?? ''),
    [notes, setNotes] = useState(task?.notes ?? '');
  const [dates, setDates] = useState<Task['dates']>(
    task?.dates ?? (initialDate ? { [initialDate]: null } : {}),
  );
  const [creatingGroup, setCreatingGroup] = useState<string>();
  const [list, setList] = useState(task?.listId ?? listId);
  const rule = task
    ? data.repeatRules.find((row) => row.prefix === taskPrefix(task.id))
    : undefined;
  const [repeatBaseline] = useState({
    at: rule?.updatedAt,
    cron: rule?.enabled ? rule.cron : '',
    offsets: rule?.dateOffsets.join(', ') ?? '0',
  });
  const [cron, setCron] = useState(rule?.enabled ? rule.cron : '');
  const unifiedRule = task
    ? data.recurrences.find((row) => row.target === 'task' && row.prefix === taskPrefix(task.id))
    : undefined;
  const [unifiedBaseline] = useState(unifiedRule?.updatedAt);
  const [definitions, setDefinitions] = useState(
    unifiedRule?.enabled ? unifiedRule.definitions : [],
  );
  const [seriesScope, setSeriesScope] = useState(false);
  const [seriesConfirmed, setSeriesConfirmed] = useState(false);
  const [offsetText, setOffsetText] = useState(
    unifiedRule?.dateOffsets.join(', ') ?? rule?.dateOffsets.join(', ') ?? '0',
  );
  const [repeatAvailable, setRepeatAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void window.clearlist?.sync?.status().then((status) => {
      if (live) setRepeatAvailable(status.connected);
    });
    return () => {
      live = false;
    };
  }, []);
  const [subtasks, setSubtasks] = useState<Task['subtasks']>(task?.subtasks ?? []),
    [subtask, setSubtask] = useState('');
  const [tagText, setTagText] = useState(task?.tags.join(', ') ?? '');
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    task?.estimatedMinutes?.toString() ?? '',
  );
  const [actualMinutes, setActualMinutes] = useState(task?.actualMinutes?.toString() ?? '');
  const [difficulty, setDifficulty] = useState<TaskDifficulty>(task?.difficulty ?? 'easy');
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const recordedMinutes = task ? recordedTaskMinutes(data, task.id) : 0;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const tags = [...title.matchAll(/(?:^|\s)#([^\s#]+)/g)]
        .map((match) => match[1])
        .filter((tag) => tag.length <= 40);
      const created = newTask(title.replace(/(?:^|\s)#[^\s#]+/g, '').trim() || title.trim(), {
        dates,
        listId: list,
        notes,
        estimatedMinutes: estimatedMinutes.trim() === '' ? null : Number(estimatedMinutes),
        actualMinutes: actualMinutes.trim() === '' ? null : Number(actualMinutes),
        difficulty,
        priority,
        tags: [
          ...new Set([
            ...tags,
            ...tagText
              .split(/[,，]/)
              .map((tag) => tag.trim().replace(/^#+/, ''))
              .filter(Boolean),
          ]),
        ].slice(0, 30),
        subtasks: [
          ...subtasks,
          ...(subtask.trim()
            ? [
                {
                  id: uid(),
                  title: subtask.trim(),
                  done: false,
                  completedAt: null,
                  deletedAt: null,
                  history: [],
                },
              ]
            : []),
        ],
      });
      await store.transact((state) => {
        const unifiedChanged =
          JSON.stringify(definitions) !==
            JSON.stringify(unifiedRule?.enabled ? unifiedRule.definitions : []) ||
          (definitions.length > 0 && offsetText !== (unifiedRule?.dateOffsets.join(', ') ?? '0'));
        if (
          unifiedChanged &&
          task &&
          state.recurrences.find((row) => row.prefix === taskPrefix(task.id))?.updatedAt !==
            unifiedBaseline
        )
          throw new Error('重复规则已在其他位置修改，请重新打开后编辑');
        if (seriesScope && !seriesConfirmed) throw new Error('请确认批量修改关联实例');
        const applyRepeat = (next: typeof state, entity: Task) => {
          if (!unifiedChanged) return next;
          if (definitions.length)
            return configureRecurrence(
              next,
              entity,
              'task',
              definitions,
              true,
              offsetText.split(/[,，]/).map((value) => Number(value.trim())),
            );
          return {
            ...next,
            recurrences: next.recurrences.map((row) =>
              row.prefix === taskPrefix(entity.id)
                ? { ...row, enabled: false, updatedAt: new Date().toISOString() }
                : row,
            ),
          };
        };
        if (!state.lists.some((item) => item.id === list))
          throw new Error('清单已变化，请重新选择。');
        for (const [day, group] of Object.entries(dates))
          if (
            group &&
            !state.planGroups.some((row) => row.id === group && !row.deletedAt && row.date === day)
          )
            throw new Error('时段已变化，请重新选择。');
        const offsets = offsetText.split(/[,，]/).map((value) => Number(value.trim()));
        const repeatChanged =
          cron !== repeatBaseline.cron || (!!cron && offsetText !== repeatBaseline.offsets);
        if (!repeatAvailable && repeatChanged && !unifiedChanged)
          throw new Error('修改旧 Cron 规则需要连接同步中心');
        if (
          repeatChanged &&
          task &&
          state.repeatRules.find((row) => row.prefix === taskPrefix(task.id))?.updatedAt !==
            repeatBaseline.at
        )
          throw new Error('重复规则已在其他位置修改，请重新打开后编辑。');
        if (cron && offsets.some((value) => !Number.isInteger(value) || value < 0 || value > 365))
          throw new Error('日期偏移须为 0–365 的整数');
        if (task) {
          const latest = state.tasks.find((item) => item.id === task.id);
          if (!latest || latest.deletedAt || latest.updatedAt !== revision)
            throw new Error('任务已在其他位置修改，请重新打开后编辑。');
          let next = {
            ...state,
            tasks: state.tasks.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    dates,
                    difficulty,
                    priority,
                    title: created.title,
                    notes: created.notes,
                    estimatedMinutes: created.estimatedMinutes,
                    actualMinutes: created.actualMinutes,
                    listId: list,
                    tags: created.tags,
                    subtasks: created.subtasks,
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
          if (seriesScope) {
            const patch = Object.fromEntries(
              (
                [
                  'title',
                  'notes',
                  'estimatedMinutes',
                  'difficulty',
                  'priority',
                  'listId',
                  'tags',
                ] as const
              )
                .filter((key) => JSON.stringify(created[key]) !== JSON.stringify(task[key]))
                .map((key) => [key, created[key]]),
            );
            next = {
              ...next,
              tasks: next.tasks.map((row) =>
                row.id !== task.id && !row.deletedAt && taskPrefix(row.id) === taskPrefix(task.id)
                  ? { ...row, ...patch, updatedAt: new Date().toISOString() }
                  : row,
              ),
              recurrences: next.recurrences.map((row) =>
                row.prefix === taskPrefix(task.id) && row.taskTemplate
                  ? {
                      ...row,
                      taskTemplate: { ...row.taskTemplate, ...patch },
                      updatedAt: new Date().toISOString(),
                    }
                  : row,
              ),
              repeatRules: next.repeatRules.map((row) =>
                row.prefix === taskPrefix(task.id)
                  ? {
                      ...row,
                      template: { ...row.template, ...patch },
                      updatedAt: new Date().toISOString(),
                    }
                  : row,
              ),
            };
          }
          next = applyRepeat(
            next,
            next.tasks.find((row) => row.id === task.id)!,
          );
          return repeatChanged
            ? configureRepeat(
                next,
                next.tasks.find((row) => row.id === task.id)!,
                cron || null,
                offsets,
              )
            : next;
        }
        return applyRepeat(
          configureRepeat(
            { ...state, tasks: [...state.tasks, created] },
            created,
            cron || null,
            offsets,
          ),
          created,
        );
      });
      saved();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={task ? '编辑任务' : '新建任务'} close={close} sheet={phone}>
      <form className="phone-task-form" onSubmit={submit}>
        <div className="list-chips" aria-label="选择清单">
          {data.lists.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={list === item.id}
              onClick={() => setList(item.id)}
            >
              <i style={{ background: item.color }} />
              {item.id === 'inbox' ? '未分组' : item.name}
            </button>
          ))}
        </div>
        <input
          className="phone-task-title"
          aria-label={task ? '任务标题' : '新任务标题'}
          placeholder="准备做什么？"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={500}
          required
        />
        <textarea
          className="phone-task-notes"
          aria-label={task ? '任务备注' : '新任务描述'}
          placeholder="添加描述，也可以用 #标签 归类"
          rows={2}
          maxLength={50000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <TaskDatesEditor
          dates={dates}
          onChange={setDates}
          today={today}
          onCreateGroup={setCreatingGroup}
        />
        <div
          className="phone-subtasks"
          style={
            {
              '--task-color':
                list === 'inbox' ? undefined : data.lists.find((item) => item.id === list)?.color,
            } as CSSProperties
          }
        >
          {subtasks
            .filter((item) => !item.deletedAt)
            .map((item) => (
              <div key={item.id} className={`task-subtask ${item.done ? 'subtask-done' : ''}`}>
                <TaskCheck
                  label={`子任务 ${item.title}`}
                  checked={item.done}
                  onChange={() =>
                    setSubtasks(
                      subtasks.map((row) =>
                        row.id === item.id ? { ...row, done: !row.done } : row,
                      ),
                    )
                  }
                />
                <span>{item.title}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除子任务 ${item.title}`}
                  onClick={() =>
                    setSubtasks(
                      subtasks.map((row) =>
                        row.id === item.id ? { ...row, deletedAt: new Date().toISOString() } : row,
                      ),
                    )
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          <div>
            <ListChecks size={18} />
            <input
              className="subtask-entry-input"
              aria-label={task ? '添加子任务' : '新任务子任务'}
              placeholder="添加子任务"
              maxLength={500}
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (subtask.trim()) {
                    setSubtasks([
                      ...subtasks,
                      {
                        id: uid(),
                        title: subtask.trim(),
                        done: false,
                        completedAt: null,
                        deletedAt: null,
                        history: [],
                      },
                    ]);
                    setSubtask('');
                  }
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="加入子任务"
              disabled={!subtask.trim() || subtasks.length >= 199}
              onClick={() => {
                setSubtasks([
                  ...subtasks,
                  {
                    id: uid(),
                    title: subtask.trim(),
                    done: false,
                    completedAt: null,
                    deletedAt: null,
                    history: [],
                  },
                ]);
                setSubtask('');
              }}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="phone-tag-chips">
          {Object.keys(data.tagColors.tasks).map((tag) => (
            <button
              type="button"
              key={tag}
              style={{ color: data.tagColors.tasks[tag] }}
              onClick={() =>
                setTagText(
                  [
                    ...new Set([
                      ...tagText
                        .split(/[,，]/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                      tag,
                    ]),
                  ].join(', '),
                )
              }
            >
              #{tag}
            </button>
          ))}
        </div>
        <label className="form-label">
          相关标签
          <input
            className="text-input"
            aria-label="任务标签"
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            placeholder="用逗号分隔"
          />
        </label>
        {task && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              try {
                await store.transact((state) => ({
                  ...state,
                  tasks: [...state.tasks, copyTask(task)],
                }));
                saved();
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            复制任务
          </button>
        )}
        <div className="phone-form-options">
          <label>
            <span className="phone-form-option-name">优先级</span>
            <select
              aria-label="任务优先级"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            >
              <option value={0}>无</option>
              <option value={1}>低</option>
              <option value={2}>中</option>
              <option value={3}>高</option>
            </select>
          </label>
          {rule?.enabled && (
            <label>
              <Repeat2 size={17} />
              <select
                aria-label="旧 Cron 重复"
                disabled={!repeatAvailable && !cron}
                value={cron ? 'cron' : ''}
                onChange={(event) => setCron(event.target.value ? '0 4 * * *' : '')}
              >
                <option value="">不重复</option>
                <option value="cron">Cron 重复</option>
              </select>
            </label>
          )}
          <label>
            <span className="phone-form-option-name">任务难度</span>
            <select
              aria-label="任务难度"
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as TaskDifficulty)}
            >
              {Object.entries(difficultyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <RecurrenceEditor
          value={definitions}
          onChange={(value) => {
            if (!definitions.length && value.length) {
              const finite = Object.keys(dates)
                .filter((key) => key !== '∞')
                .sort();
              setOffsetText(
                finite.length
                  ? finite
                      .map((day) => (Date.parse(day) - Date.parse(finite[0])) / 86400000)
                      .join(', ')
                  : '0',
              );
            }
            setDefinitions(value);
            if (value.length) setCron('');
          }}
          date={
            Object.keys(dates)
              .filter((key) => key !== '∞')
              .sort()[0] ?? today
          }
          timeZone={data.settings.timeZone}
        />
        {definitions.length > 0 && !cron && (
          <label className="form-label">
            日期偏移
            <input
              className="text-input"
              aria-label="日期偏移"
              value={offsetText}
              onChange={(event) => setOffsetText(event.target.value)}
            />
            <span className="field-hint">每次发生可安排多个日期，0 为发生日，1 为次日。</span>
          </label>
        )}
        {task && (
          <details>
            <summary>关联系列批量修改</summary>
            <label>
              <input
                type="checkbox"
                checked={seriesScope}
                onChange={(event) => {
                  setSeriesScope(event.target.checked);
                  setSeriesConfirmed(false);
                }}
              />
              应用本次更改的标题、备注、清单、标签、难度、优先级与预计用时到关联系列
            </label>
            {seriesScope && (
              <label>
                <input
                  type="checkbox"
                  checked={seriesConfirmed}
                  onChange={(event) => setSeriesConfirmed(event.target.checked)}
                />
                确认更新包含关联实例的独立修改
              </label>
            )}
          </details>
        )}
        {cron && (
          <div className="task-repeat-options">
            <label className="form-label">
              Cron
              <input
                className="text-input"
                aria-label="Cron"
                value={cron}
                onChange={(event) => setCron(event.target.value)}
                placeholder="0 4 * * *"
              />
            </label>
            <label className="form-label">
              日期偏移
              <input
                className="text-input"
                aria-label="日期偏移"
                value={offsetText}
                onChange={(event) => setOffsetText(event.target.value)}
                placeholder="0, 1, 2"
              />
            </label>
            <p className="muted">
              按设置中的时区触发；0 表示触发业务日，1 表示次日。每次生成一个任务。
            </p>
          </div>
        )}
        <div className="task-effort-fields">
          <label className="form-label">
            预计用时
            <span className="task-effort-input">
              <input
                className="text-input"
                type="number"
                aria-label="预计用时"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="可留空"
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(event.target.value)}
              />
              <span>分钟</span>
            </span>
          </label>
          <label className="form-label">
            实际用时
            <span className="task-effort-input">
              <input
                className="text-input"
                type="number"
                aria-label="实际用时"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="可留空"
                value={actualMinutes}
                onChange={(event) => setActualMinutes(event.target.value)}
              />
              <span>分钟</span>
            </span>
          </label>
        </div>
        {actualMinutes.trim() === '' && recordedMinutes > 0 && (
          <p className="task-effort-reference">关联记录累计 {formatTaskMinutes(recordedMinutes)}</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="phone-sheet-actions">
          {task && (
            <>
              <button
                type="button"
                className="button danger"
                aria-label="删除当前任务"
                disabled={busy}
                onClick={() => onDelete?.(task)}
              >
                <Trash2 size={16} />
                删除
              </button>
              <button
                type="button"
                className="button"
                aria-label="开始记录时间"
                disabled={busy}
                onClick={async () => {
                  if (await submit()) onTrack?.(task.id);
                }}
              >
                <Timer size={16} />
                开始记录
              </button>
            </>
          )}
          <button type="submit" className="button primary" disabled={busy || !title.trim()}>
            {busy ? '正在保存…' : task ? '保存任务' : '添加任务'}
          </button>
        </footer>
      </form>
      {creatingGroup && (
        <PlanGroupModal
          date={creatingGroup}
          onClose={() => setCreatingGroup(undefined)}
          onSaved={(_message, group) => {
            if (group) setDates((dates) => ({ ...dates, [creatingGroup]: group.id }));
          }}
        />
      )}
    </Modal>
  );
}
