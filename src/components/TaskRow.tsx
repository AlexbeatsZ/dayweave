import { RotateCcw, Pin, Trash2, Repeat2, ListChecks, GripVertical, Timer } from 'lucide-react';
import {
  dateKey,
  formatDate,
  formatTaskMinutes,
  now,
  priorityLabels,
  toggleTask,
  type Task,
} from '../model';
import { store, useStore } from '../store';
import { useTaskDrag } from '../phone/useTaskDrag';
import { TaskCheck } from './TaskCheck';
import '../phone/drag.css';

type Props = {
  task: Task;
  index?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (task: Task) => void;
  onMove?: (source: string, target: string) => void;
  onTrack?: (id: string) => void;
};
export function TaskRow({ task, index, selected, onSelect, onDelete, onMove, onTrack }: Props) {
  const { data } = useStore();
  const drag = useTaskDrag(task.id, onMove, !!task.deletedAt || !!task.completedAt);
  const list = data.lists.find((l) => l.id === task.listId);
  const completed = task.subtasks.filter((s) => s.done).length;
  return (
    <article
      ref={drag.ref}
      className={`task-row ${selected ? 'selected' : ''} ${task.completedAt ? 'done' : ''} ${drag.dragging ? 'task-sort-source' : ''}`}
      data-testid="task-row"
      data-task-id={task.id}
      data-task-sortable={!!onMove && !task.deletedAt && !task.completedAt}
      data-priority={task.priority}
      style={{ '--task-color': list?.color ?? '#7e8b8b' } as React.CSSProperties}
      onClickCapture={drag.onClickCapture}
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
        <TaskCheck
          checked={!!task.completedAt}
          label={`完成 ${task.title}`}
          ordinal={index ?? 1}
          onChange={() => store.update((s) => toggleTask(s, task.id))}
        />
      )}
      <div className="task-content">
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
              {list?.id === 'inbox' ? '未分组' : list?.name}
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
            {task.estimatedMinutes != null && (
              <span className="task-effort-meta">
                预计 {formatTaskMinutes(task.estimatedMinutes)}
              </span>
            )}
            {task.actualMinutes != null && (
              <span className="task-effort-meta">实际 {formatTaskMinutes(task.actualMinutes)}</span>
            )}
            {!!task.subtasks.length && (
              <span>
                <ListChecks size={12} />
                {completed}/{task.subtasks.length}
              </span>
            )}
            {task.tags.slice(0, 2).map((tag) => (
              <span className="tag-label" key={tag} style={{ color: data.tagColors.tasks[tag] }}>
                #{tag}
              </span>
            ))}
          </span>
        </button>
        {!!task.subtasks.length && (
          <ul className="task-subtasks" aria-label={`${task.title}的子任务`}>
            {task.subtasks.map((item) => (
              <li className={`task-subtask ${item.done ? 'subtask-done' : ''}`} key={item.id}>
                <TaskCheck
                  checked={item.done}
                  label={`子任务 ${item.title}`}
                  onChange={() =>
                    store.update((state) => ({
                      ...state,
                      tasks: state.tasks.map((latest) =>
                        latest.id === task.id && !latest.deletedAt
                          ? {
                              ...latest,
                              updatedAt: now(),
                              subtasks: latest.subtasks.map((subtask) =>
                                subtask.id === item.id
                                  ? { ...subtask, done: !subtask.done }
                                  : subtask,
                              ),
                            }
                          : latest,
                      ),
                    }))
                  }
                />
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
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
          title="删除任务"
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
