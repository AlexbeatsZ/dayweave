import { useState, type FormEvent } from 'react';
import { CalendarDays, Flag, ListChecks, Plus, Repeat2, X } from 'lucide-react';
import { newTask, priorityLabels, shiftDate, uid, type Task } from '../model';
import { store, useStore } from '../store';
import { Sheet } from './Sheet';

export function TaskComposer({
  due,
  listId,
  today,
  close,
  saved,
}: {
  due: string;
  listId: string;
  today: string;
  close: () => void;
  saved: () => void;
}) {
  const { data } = useStore();
  const [title, setTitle] = useState(''),
    [notes, setNotes] = useState('');
  const [date, setDate] = useState(due),
    [list, setList] = useState(listId);
  const [priority, setPriority] = useState<Task['priority']>(4);
  const [repeat, setRepeat] = useState<Task['repeat']>('none');
  const [subtasks, setSubtasks] = useState<string[]>([]),
    [subtask, setSubtask] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const tags = [...title.matchAll(/(?:^|\s)#([^\s#]+)/g)]
        .map((match) => match[1])
        .filter((tag) => tag.length <= 40);
      const task = newTask(title.replace(/(?:^|\s)#[^\s#]+/g, '').trim() || title.trim(), {
        due: date || null,
        listId: list,
        notes,
        priority,
        repeat: date ? repeat : 'none',
        tags: [...new Set(tags)].slice(0, 30),
        subtasks: [...subtasks, ...(subtask.trim() ? [subtask.trim()] : [])].map((text) => ({
          id: uid(),
          title: text,
          done: false,
        })),
      });
      await store.transact((state) => {
        if (!state.lists.some((item) => item.id === list))
          throw new Error('清单已变化，请重新选择。');
        return { ...state, tasks: [...state.tasks, task] };
      });
      saved();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="新建任务" close={close}>
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
              {item.name}
            </button>
          ))}
        </div>
        <input
          className="phone-task-title"
          aria-label="新任务标题"
          placeholder="准备做什么？"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={500}
          required
        />
        <textarea
          className="phone-task-notes"
          aria-label="新任务描述"
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
              aria-label="新任务日期"
              min="2000-01-01"
              max="2200-12-31"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <div className="phone-subtasks">
          {subtasks.map((text, index) => (
            <div key={index}>
              <span>{text}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除子任务 ${text}`}
                onClick={() => setSubtasks(subtasks.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div>
            <ListChecks size={18} />
            <input
              aria-label="新任务子任务"
              placeholder="添加子任务"
              maxLength={500}
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (subtask.trim()) {
                    setSubtasks([...subtasks, subtask.trim()]);
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
                setSubtasks([...subtasks, subtask.trim()]);
                setSubtask('');
              }}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="phone-form-options">
          <label>
            <Flag size={17} />
            <select
              aria-label="新任务优先级"
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
              aria-label="新任务重复"
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
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer className="phone-sheet-actions">
          <button type="submit" className="button primary" disabled={busy || !title.trim()}>
            {busy ? '正在保存…' : '添加任务'}
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
