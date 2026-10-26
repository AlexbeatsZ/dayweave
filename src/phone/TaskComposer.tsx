import { useState, type CSSProperties, type FormEvent } from 'react';
import { CalendarDays, Flag, ListChecks, Plus, Repeat2, X } from 'lucide-react';
import {
  formatTaskMinutes,
  newTask,
  priorityLabels,
  recordedTaskMinutes,
  shiftDate,
  uid,
  type Task,
} from '../model';
import { store, useStore } from '../store';
import { Modal } from '../components/Modal';
import { TaskCheck } from '../components/TaskCheck';
import { usePhone } from './usePhone';

export function TaskComposer({
  due,
  listId,
  today,
  close,
  saved,
  task,
  onDelete,
  onTrack,
}: {
  due: string;
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
  const [date, setDate] = useState(task?.due ?? due),
    [list, setList] = useState(task?.listId ?? listId);
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 4);
  const [repeat, setRepeat] = useState<Task['repeat']>(task?.repeat ?? 'none');
  const [subtasks, setSubtasks] = useState<Task['subtasks']>(task?.subtasks ?? []),
    [subtask, setSubtask] = useState('');
  const [tagText, setTagText] = useState(task?.tags.join(', ') ?? '');
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    task?.estimatedMinutes?.toString() ?? '',
  );
  const [actualMinutes, setActualMinutes] = useState(task?.actualMinutes?.toString() ?? '');
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
        due: date || null,
        listId: list,
        notes,
        estimatedMinutes: estimatedMinutes.trim() === '' ? null : Number(estimatedMinutes),
        actualMinutes: actualMinutes.trim() === '' ? null : Number(actualMinutes),
        priority,
        repeat: date ? repeat : 'none',
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
          ...(subtask.trim() ? [{ id: uid(), title: subtask.trim(), done: false }] : []),
        ],
      });
      await store.transact((state) => {
        if (!state.lists.some((item) => item.id === list))
          throw new Error('清单已变化，请重新选择。');
        if (task) {
          const latest = state.tasks.find((item) => item.id === task.id);
          if (!latest || latest.deletedAt || latest.updatedAt !== revision)
            throw new Error('任务已在其他位置修改，请重新打开后编辑。');
          return {
            ...state,
            tasks: state.tasks.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    title: created.title,
                    notes: created.notes,
                    estimatedMinutes: created.estimatedMinutes,
                    actualMinutes: created.actualMinutes,
                    listId: list,
                    due: date || null,
                    priority,
                    repeat: created.repeat,
                    repeatDay: date && date !== item.due ? Number(date.slice(-2)) : item.repeatDay,
                    tags: created.tags,
                    subtasks: created.subtasks,
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
        }
        return { ...state, tasks: [...state.tasks, created] };
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
        <div className="date-chips" aria-label="安排日期">
          {[
            { value: today, label: '今天' },
            { value: shiftDate(today, 1), label: '明天' },
            { value: '', label: '无日期' },
          ].map((item) => (
            <button
              type="button"
              key={item.label}
              aria-pressed={date === item.value}
              onClick={() => setDate(item.value)}
            >
              {item.label}
            </button>
          ))}
          <label className="custom-date">
            <CalendarDays size={16} />
            <span>
              {date && ![today, shiftDate(today, 1)].includes(date)
                ? date.slice(5).replace('-', '/')
                : '选日期'}
            </span>
            <input
              type="date"
              aria-label={task ? '计划日期' : '新任务日期'}
              min="2000-01-01"
              max="2200-12-31"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <div
          className="phone-subtasks"
          style={
            { '--task-color': data.lists.find((item) => item.id === list)?.color } as CSSProperties
          }
        >
          {subtasks.map((item, index) => (
            <div key={item.id} className={`task-subtask ${item.done ? 'subtask-done' : ''}`}>
              <TaskCheck
                label={`子任务 ${item.title}`}
                checked={item.done}
                onChange={() =>
                  setSubtasks(
                    subtasks.map((row) => (row.id === item.id ? { ...row, done: !row.done } : row)),
                  )
                }
              />
              <span>{item.title}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除子任务 ${item.title}`}
                onClick={() => setSubtasks(subtasks.filter((_, i) => i !== index))}
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
                    setSubtasks([...subtasks, { id: uid(), title: subtask.trim(), done: false }]);
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
                setSubtasks([...subtasks, { id: uid(), title: subtask.trim(), done: false }]);
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
        <div className="phone-form-options">
          <label>
            <Flag size={17} />
            <select
              aria-label={task ? '任务优先级' : '新任务优先级'}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) as Task['priority'])}
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Repeat2 size={17} />
            <select
              aria-label={task ? '重复频率' : '新任务重复'}
              disabled={!date}
              value={date ? repeat : 'none'}
              onChange={(e) => setRepeat(e.target.value as Task['repeat'])}
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </label>
        </div>
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
        {task && (
          <div className="phone-task-edit-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (await submit()) onTrack?.(task.id);
              }}
            >
              开始记录时间
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={() => onDelete?.(task)}
            >
              删除当前任务
            </button>
          </div>
        )}
        <footer className="phone-sheet-actions">
          <button type="submit" className="button primary" disabled={busy || !title.trim()}>
            {busy ? '正在保存…' : task ? '保存任务' : '添加任务'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
