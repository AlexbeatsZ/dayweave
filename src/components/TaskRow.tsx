import {
  Check,
  RotateCcw,
  Pin,
  Trash2,
  Repeat2,
  ListChecks,
  GripVertical,
  Timer,
} from 'lucide-react';
import { dateKey, formatDate, now, priorityLabels, toggleTask, type Task } from '../model';
import { store, useStore } from '../store';

type Props = {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (task: Task) => void;
  onMove?: (source: string, target: string) => void;
  onTrack?: (id: string) => void;
};
export function TaskRow({ task, selected, onSelect, onDelete, onMove, onTrack }: Props) {
  const { data } = useStore();
  const list = data.lists.find((l) => l.id === task.listId);
  const completed = task.subtasks.filter((s) => s.done).length;
  return (
    <article
      className={`task-row ${selected ? 'selected' : ''} ${task.completedAt ? 'done' : ''}`}
      data-testid="task-row"
      draggable={!task.deletedAt && !onTrack}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/clearlist-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (onMove && event.dataTransfer.types.includes('application/clearlist-task'))
          event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData('application/clearlist-task');
        if (source && source !== task.id) onMove?.(source, task.id);
      }}
    >
      <GripVertical size={14} className="drag-handle" aria-hidden />
      {task.deletedAt ? (
        <button
          className="icon-button"
          aria-label={`恢复 ${task.title}`}
          title="恢复任务"
          onClick={() => store.patchTask(task.id, { deletedAt: null })}
        >
          <RotateCcw size={17} />
        </button>
      ) : (
        <button
          className={`task-check priority-${task.priority} ${task.completedAt ? 'checked' : ''}`}
          role="checkbox"
          aria-checked={!!task.completedAt}
          aria-label={`完成 ${task.title}`}
          onClick={() => store.update((s) => toggleTask(s, task.id))}
        >
          {task.completedAt && <Check size={13} strokeWidth={3} />}
        </button>
      )}
      <button
        className="task-body"
        aria-label={`编辑 ${task.title}`}
        onClick={() => onSelect(task.id)}
      >
        <span className="task-title">
          {task.pinned && <Pin size={12} className="inline-pin" />}
          {task.title}
        </span>
        {onTrack && task.notes && <span className="phone-task-preview">{task.notes}</span>}
        <span className="task-meta">
          <span className="list-meta">
            <i style={{ background: list?.color }} />
            {list?.name}
          </span>
          {task.due && (
            <span
              className={
                !task.completedAt && task.due < dateKey()
                  ? 'overdue'
                  : task.due === dateKey()
                    ? 'due-today'
                    : ''
              }
            >
              {formatDate(task.due)}
              {!task.completedAt && task.due < dateKey() && ' · 逾期'}
            </span>
          )}
          {task.repeat !== 'none' && <Repeat2 size={12} aria-label="重复任务" />}
          {!!task.subtasks.length && (
            <span>
              <ListChecks size={12} />
              {completed}/{task.subtasks.length}
            </span>
          )}
          {task.tags.slice(0, 2).map((tag) => (
            <span className="tag-label" key={tag}>
              #{tag}
            </span>
          ))}
        </span>
      </button>
      {onTrack && !task.deletedAt && !task.completedAt && (
        <button
          className="icon-button phone-task-track"
          aria-label={`计时 ${task.title}`}
          onClick={() => onTrack(task.id)}
        >
          <Timer size={19} />
        </button>
      )}
      <span
        className={`priority-dot priority-${task.priority}`}
        title={priorityLabels[task.priority]}
      />
      {!task.deletedAt && (
        <button
          className={`icon-button row-action ${task.pinned ? 'is-pinned' : ''}`}
          title={task.pinned ? '取消置顶' : '置顶'}
          aria-label={task.pinned ? `取消置顶 ${task.title}` : `置顶 ${task.title}`}
          onClick={() => store.patchTask(task.id, { pinned: !task.pinned })}
        >
          <Pin size={15} />
        </button>
      )}
      {!task.deletedAt && (
        <button
          className="icon-button row-action danger-hover"
          title="移入回收站"
          aria-label={`删除 ${task.title}`}
          onClick={() => onDelete(task)}
        >
          <Trash2 size={15} />
        </button>
      )}
      {task.deletedAt && (
        <span className="deleted-label">
          {new Date(task.deletedAt ?? now()).toLocaleDateString('zh-CN')}
        </span>
      )}
    </article>
  );
}
