import { RotateCcw, Pin, Trash2, Repeat2, ListChecks, GripVertical, Timer } from 'lucide-react';
import {
  dateKey,
  difficultyLabels,
  taskDateLabel,
  changeSubtask,
  taskDaySubtasks,
  subtaskDay,
  taskPrefix,
  taskDoneOn,
  taskCompletedOnDay,
  formatDate,
  formatTaskMinutes,
  taskCompleted,
  now,
  toggleTask,
  type Task,
} from '../model';
import { businessDayStart, shiftDay, zoneClock } from '../timezone';
import { store, useStore } from '../store';
import { useSortDrag } from '../phone/useSortDrag';
import { TaskCheck } from './TaskCheck';
import '../phone/sort.css';

type Props = {
  task: Task;
  day?: string;
  index?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (task: Task) => void;
  onMove?: (source: string, target: string) => void;
  onTrack?: (id: string) => void;
};
export function TaskRow({
  task,
  day,
  index,
  selected,
  onSelect,
  onDelete,
  onMove,
  onTrack,
}: Props) {
  const { data } = useStore();
  const sortable = !!onMove && !task.deletedAt && !taskCompleted(task);
  const drag = useSortDrag(task.id, 'task', onMove, !sortable);
  const list = data.lists.find((l) => l.id === task.listId);
  const allSubtasks = task.subtasks.filter((row) => !row.deletedAt);
  const subtasks = day ? taskDaySubtasks(task, day, dateKey()) : allSubtasks;
  const completed = allSubtasks.filter((row) => row.done).length;
  const historical = !!day && day < dateKey();
  const range = historical
    ? { start: businessDayStart(day!), end: businessDayStart(shiftDay(day!, 1)) }
    : null;
  const records = range
    ? data.timelog.records
        .filter((row) => row.taskId === task.id && !row.deletedAt)
        .map((row) => ({
          ...row,
          spans: row.spans
            .map((span) => ({
              start: Math.max(range.start, span.start),
              end: Math.min(range.end, span.end),
            }))
            .filter((span) => span.end > span.start),
        }))
        .filter((row) => row.spans.length)
    : [];
  const shownDone = historical ? taskDoneOn(task, day!) : taskCompleted(task);
  const rule = data.repeatRules.find((row) => row.prefix === taskPrefix(task.id));
  return (
    <article
      ref={drag.ref}
      className={`task-row ${selected ? 'selected' : ''} ${shownDone ? 'done' : ''} difficulty-${task.difficulty} ${drag.dragging ? 'sort-source' : ''}`}
      data-testid="task-row"
      data-task-id={task.id}
      data-sort-id={sortable ? task.id : undefined}
      data-sort-group={sortable ? 'task' : undefined}
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
          checked={shownDone}
          label={`完成 ${task.title}`}
          ordinal={index ?? 1}
          disabled={historical}
          onChange={() => store.update((s) => toggleTask(s, task.id))}
        />
      )}
      <div className="task-content">
        <button
          className="task-body"
          data-sort-handle
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
            <span>{taskDateLabel(task, formatDate)}</span>
            {rule && <Repeat2 size={12} aria-label="重复任务" />}
            {task.difficulty !== 'easy' && (
              <b className="difficulty-tier">{difficultyLabels[task.difficulty]}</b>
            )}
            {task.estimatedMinutes != null && (
              <span className="task-effort-meta">
                预计 {formatTaskMinutes(task.estimatedMinutes)}
              </span>
            )}
            {task.actualMinutes != null && (
              <span className="task-effort-meta">实际 {formatTaskMinutes(task.actualMinutes)}</span>
            )}
            {!!allSubtasks.length && (
              <span>
                <ListChecks size={12} />
                {completed}/{allSubtasks.length}
              </span>
            )}
            {task.tags.slice(0, 2).map((tag) => (
              <span className="tag-label" key={tag} style={{ color: data.tagColors.tasks[tag] }}>
                #{tag}
              </span>
            ))}
          </span>
        </button>
        {!!subtasks.length && (
          <ul className="task-subtasks" aria-label={`${task.title}的子任务`}>
            {subtasks.map((item) => (
              <li
                className={`task-subtask ${(historical ? subtaskDay(item, day!) : item.done) ? 'subtask-done' : ''}`}
                key={item.id}
              >
                <TaskCheck
                  checked={historical ? subtaskDay(item, day!) === true : item.done}
                  disabled={historical}
                  label={`子任务 ${item.title}`}
                  onChange={() =>
                    store.update((state) => ({
                      ...state,
                      tasks: state.tasks.map((latest) =>
                        latest.id === task.id && !latest.deletedAt
                          ? changeSubtask(latest, item.id, {
                              done: !latest.subtasks.find((row) => row.id === item.id)!.done,
                            })
                          : latest,
                      ),
                    }))
                  }
                />
                <span>
                  {item.title}
                  {day === dateKey() && item.done && !item.completedAt && !item.history.length && (
                    <small className="task-history-note">完成日期未知</small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {historical && (
          <small className="task-history-note">
            {taskCompletedOnDay(task, day!) ? '当日完成' : '当日安排'}
            {!subtasks.length && !shownDone ? ' · 无已知完成记录' : ''}
            {records.length ? ` · ${records.length} 条执行记录` : ''}
          </small>
        )}
        {records.map((record) => (
          <small className="task-history-note" key={record.id}>
            {record.spans
              .map((span) => `${zoneClock(span.start)}–${zoneClock(span.end)}`)
              .join('、')}{' '}
            ·{' '}
            {formatTaskMinutes(
              record.spans.reduce((sum, span) => sum + span.end - span.start, 0) / 60000,
            )}{' '}
            {record.note}
          </small>
        ))}
      </div>
      {onTrack && !task.deletedAt && !taskCompleted(task) && (
        <button
          className="icon-button phone-task-track"
          aria-label={`计时 ${task.title}`}
          onClick={() => onTrack(task.id)}
        >
          <Timer size={19} />
        </button>
      )}
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
