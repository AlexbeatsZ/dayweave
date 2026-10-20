import { useEffect, useRef, useState } from 'react';
import {
  X,
  Pin,
  Trash2,
  Check,
  Plus,
  Repeat2,
  CalendarDays,
  Flag,
  Folder,
  Tag,
  Play,
  RotateCcw,
} from 'lucide-react';
import { dateKey, now, priorityLabels, toggleTask, uid, type Task } from '../model';
import { store, useStore } from '../store';

export function TaskEditor({
  id,
  onClose,
  onDelete,
  onFocus,
  onTrack,
}: {
  id: string;
  onClose: () => void;
  onDelete: (task: Task) => void;
  onFocus: (id: string) => void;
  onTrack: (id: string) => void;
}) {
  const { data } = useStore();
  const task = data.tasks.find((t) => t.id === id);
  const [title, setTitle] = useState(task?.title ?? '');
  const [tag, setTag] = useState('');
  const [subtask, setSubtask] = useState('');
  const titleInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (document.activeElement !== titleInput.current) setTitle(task?.title ?? '');
  }, [task?.title]);
  useEffect(() => {
    setTitle(task?.title ?? '');
    setTag('');
    setSubtask('');
  }, [id]);
  if (!task) return null;
  const patch = (value: Partial<Task>) => store.patchTask(id, value);
  return (
    <aside className="detail-panel" aria-label="任务详情">
      <header className="detail-toolbar">
        <span>任务详情</span>
        <div>
          <button
            className={`icon-button ${task.pinned ? 'is-pinned' : ''}`}
            title="置顶"
            aria-label="切换任务置顶"
            onClick={() => patch({ pinned: !task.pinned })}
          >
            <Pin size={17} />
          </button>
          {!task.deletedAt && (
            <button
              className="icon-button danger-hover"
              title="移入回收站"
              aria-label="删除当前任务"
              onClick={() => onDelete(task)}
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            className="icon-button"
            title="关闭详情 (Esc)"
            aria-label="关闭详情"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
      </header>
      <div className="detail-scroll">
        <div className="detail-title-row">
          <button
            className={`task-check priority-${task.priority} ${task.completedAt ? 'checked' : ''}`}
            aria-label="切换当前任务完成状态"
            aria-pressed={!!task.completedAt}
            disabled={!!task.deletedAt}
            onClick={() => store.update((s) => toggleTask(s, id))}
          >
            {task.completedAt && <Check size={13} />}
          </button>
          <textarea
            ref={titleInput}
            className={`detail-title ${task.completedAt ? 'completed-title' : ''}`}
            aria-label="任务标题"
            maxLength={500}
            rows={3}
            value={title}
            disabled={!!task.deletedAt}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) patch({ title: e.target.value });
            }}
            onBlur={() => {
              setTitle(task.title);
            }}
          />
        </div>
        {task.deletedAt && (
          <div className="restore-box">
            <span>此任务在回收站中</span>
            <button className="button small" onClick={() => patch({ deletedAt: null })}>
              <RotateCcw size={14} />
              恢复任务
            </button>
          </div>
        )}
        <fieldset className="detail-fields" disabled={!!task.deletedAt}>
          <label>
            <span>
              <CalendarDays size={16} />
              计划日期
            </span>
            <input
              aria-label="计划日期"
              type="date"
              min="2000-01-01"
              max="2200-12-31"
              value={task.due ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value && (value < '2000-01-01' || value > '2200-12-31')) return;
                patch({
                  due: value || null,
                  ...(value ? { repeatDay: Number(value.slice(-2)) } : { repeat: 'none' as const }),
                });
              }}
            />
          </label>
          <label>
            <span>
              <Flag size={16} />
              优先级
            </span>
            <select
              aria-label="任务优先级"
              value={task.priority}
              onChange={(e) => patch({ priority: Number(e.target.value) as Task['priority'] })}
            >
              {Object.entries(priorityLabels).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              <Folder size={16} />
              所属清单
            </span>
            <select
              aria-label="所属清单"
              value={task.listId}
              onChange={(e) => patch({ listId: e.target.value })}
            >
              {data.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              <Repeat2 size={16} />
              重复
            </span>
            <select
              aria-label="重复频率"
              value={task.repeat}
              onChange={(e) =>
                patch({ repeat: e.target.value as Task['repeat'], due: task.due ?? dateKey() })
              }
            >
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </label>
        </fieldset>
        {task.repeat !== 'none' && (
          <p className="field-hint">完成后生成下一次任务，历史记录会保留。</p>
        )}
        <section className="detail-section">
          <h3>
            <Tag size={15} />
            标签
          </h3>
          <div className="tag-cloud">
            {task.tags.map((value) => (
              <button
                key={value}
                className="tag-chip"
                aria-label={`移除标签 ${value}`}
                disabled={!!task.deletedAt}
                onClick={() => patch({ tags: task.tags.filter((t) => t !== value) })}
              >
                #{value}
                <X size={11} />
              </button>
            ))}
          </div>
          {!task.deletedAt && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = tag.replace(/^#/, '').trim();
                if (value && !task.tags.includes(value) && task.tags.length < 30)
                  patch({ tags: [...task.tags, value] });
                setTag('');
              }}
            >
              <input
                className="line-input"
                aria-label="添加标签"
                placeholder="# 添加标签，回车确认"
                maxLength={40}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
            </form>
          )}
        </section>
        <section className="detail-section">
          <h3>
            子任务
            <span>
              {task.subtasks.filter((s) => s.done).length} / {task.subtasks.length}
            </span>
          </h3>
          <div className="subtask-list">
            {task.subtasks.map((item) => (
              <div className="subtask" key={item.id}>
                <button
                  className={`task-check ${item.done ? 'checked' : ''}`}
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={`子任务 ${item.title}`}
                  disabled={!!task.deletedAt}
                  onClick={() =>
                    patch({
                      subtasks: task.subtasks.map((s) =>
                        s.id === item.id ? { ...s, done: !s.done } : s,
                      ),
                    })
                  }
                >
                  {item.done && <Check size={12} />}
                </button>
                <span className={item.done ? 'subtask-done' : ''}>{item.title}</span>
                <button
                  className="icon-button"
                  aria-label={`删除子任务 ${item.title}`}
                  disabled={!!task.deletedAt}
                  onClick={() => patch({ subtasks: task.subtasks.filter((s) => s.id !== item.id) })}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          {!task.deletedAt && (
            <form
              className="subtask-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (subtask.trim() && task.subtasks.length < 200) {
                  patch({
                    subtasks: [...task.subtasks, { id: uid(), title: subtask.trim(), done: false }],
                  });
                  setSubtask('');
                }
              }}
            >
              <Plus size={16} />
              <input
                className="line-input"
                aria-label="添加子任务"
                placeholder="添加子任务"
                maxLength={500}
                value={subtask}
                onChange={(e) => setSubtask(e.target.value)}
              />
            </form>
          )}
        </section>
        <section className="detail-section">
          <h3>备注</h3>
          <textarea
            className="notes-input"
            aria-label="任务备注"
            placeholder="记下想法、链接或下一步…"
            rows={6}
            maxLength={50000}
            disabled={!!task.deletedAt}
            value={task.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </section>
        {!task.deletedAt && !task.completedAt && (
          <div className="task-timer-actions">
            <button className="button primary" onClick={() => onTrack(id)}>
              <Play size={15} />
              开始记录时间
            </button>
            <button className="button focus-task-button" onClick={() => onFocus(id)}>
              番茄专注
            </button>
          </div>
        )}
      </div>
      <footer className="detail-footer">
        创建于{' '}
        {new Date(task.createdAt || now()).toLocaleString('zh-CN', {
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </footer>
    </aside>
  );
}
