import { useState, type FormEvent, type ReactNode } from 'react';
import { FolderOpen, Hash, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { ColorPicker } from '../components/ColorPicker';
import { Modal } from '../components/Modal';
import { ListModal } from '../components/Settings';
import { now, type TaskList, type View } from '../model';
import { store, useStore } from '../store';
import { activeActivity, deleteActivity, timestamp } from '../timelog/domain';
import { Editor, type EditTarget } from '../timelog/components/Editor';
import { ActivityIcon } from './ActivityIcon';
import './Sidebar.css';
import { usePhone } from './usePhone';

export type RecordFilter = { activityId?: string; tag?: string };
export type PhoneSidebarProps = {
  kind: 'tasks' | 'records' | 'other';
  close: () => void;
  onSettings: () => void;
  onList: (id: string) => void;
  onTaskTag: (tag: string) => void;
  onRecordFilter: (filter: RecordFilter) => void;
  persistent?: boolean;
  open?: boolean;
  view?: View;
  recordFilter?: RecordFilter;
};
type TagAction = { kind: 'tasks' | 'records'; remove?: string; edit?: string };

/** Contextual navigation only; all saved changes use the existing unified store. */
export function PhoneSidebar({
  kind,
  close,
  onSettings,
  onList,
  onTaskTag,
  onRecordFilter,
  persistent = false,
  open = true,
  view,
  recordFilter = {},
}: PhoneSidebarProps) {
  const { data } = useStore();
  const [list, setList] = useState<TaskList | 'new' | null>(null);
  const [editor, setEditor] = useState<EditTarget | null>(null);
  const [tagAction, setTagAction] = useState<TagAction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tasks = data.tasks.filter((task) => !task.deletedAt);
  const records = data.timelog.records.filter((record) => !record.deletedAt);
  const taskTags = [
    ...new Set([...Object.keys(data.tagColors.tasks), ...tasks.flatMap((task) => task.tags)]),
  ].sort();
  const recordTags = [
    ...new Set([
      ...Object.keys(data.tagColors.records),
      ...records.flatMap((record) => record.tags),
      ...(data.timelog.timer?.tags ?? []),
    ]),
  ].sort();
  const activity = data.timelog.activities.find((item) => item.id === deleteId);
  const navigate = (action: () => void) => {
    close();
    action();
  };
  async function removeActivity() {
    if (!deleteId) return;
    setBusy(true);
    setError('');
    try {
      await store.transact((state) => ({
        ...state,
        timelog: deleteActivity(state.timelog, deleteId),
      }));
      setDeleteId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SidebarPanel
        persistent={persistent}
        open={open}
        title={kind === 'tasks' ? '待办' : kind === 'records' ? '记录' : '时织'}
        label={kind === 'tasks' ? '待办分类' : kind === 'records' ? '记录分类' : '设置与同步'}
        close={close}
      >
        <div className="phone-sidebar-body">
          {kind === 'tasks' && (
            <>
              <SidebarGroup title="所属清单" onAdd={() => setList('new')}>
                {[...data.lists]
                  .filter((item) => item.id !== 'inbox')
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <div className="phone-sidebar-row" key={item.id}>
                      <button
                        className="phone-sidebar-link"
                        aria-current={view === `list:${item.id}` ? 'page' : undefined}
                        onClick={() => navigate(() => onList(item.id))}
                      >
                        <FolderOpen size={18} style={{ color: item.color }} />
                        <span>{item.name}</span>
                        <small>
                          {
                            tasks.filter((task) => !task.completedAt && task.listId === item.id)
                              .length
                          }
                        </small>
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`编辑清单 ${item.name}`}
                        onClick={() => setList(item)}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  ))}
              </SidebarGroup>
              <SidebarGroup title="待办标签" onAdd={() => setTagAction({ kind: 'tasks' })}>
                {taskTags.map((tag) => (
                  <div className="phone-sidebar-row" key={tag}>
                    <button
                      className="phone-sidebar-link"
                      aria-current={view === `tag:${tag}` ? 'page' : undefined}
                      onClick={() => navigate(() => onTaskTag(tag))}
                    >
                      <Hash size={17} style={{ color: data.tagColors.tasks[tag] }} />
                      <span>{tag}</span>
                      <small>{tasks.filter((task) => task.tags.includes(tag)).length}</small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`编辑待办标签 ${tag}`}
                      onClick={() => setTagAction({ kind: 'tasks', edit: tag })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除待办标签 ${tag}`}
                      onClick={() => setTagAction({ kind: 'tasks', remove: tag })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!taskTags.length && <p className="phone-sidebar-empty">还没有待办标签</p>}
              </SidebarGroup>
            </>
          )}
          {kind === 'records' && (
            <>
              <SidebarGroup title="活动" onAdd={() => setEditor({ kind: 'activity' })}>
                {data.timelog.activities.filter(activeActivity).map((item) => (
                  <div className="phone-sidebar-row" key={item.id}>
                    <button
                      className="phone-sidebar-link"
                      aria-current={recordFilter.activityId === item.id ? 'page' : undefined}
                      onClick={() => navigate(() => onRecordFilter({ activityId: item.id }))}
                    >
                      <span className="phone-sidebar-activity" style={{ color: item.color }}>
                        <ActivityIcon name={item.name} size={18} />
                      </span>
                      <span>{item.name}</span>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`编辑活动 ${item.name}`}
                      onClick={() => setEditor({ kind: 'activity', activity: item })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除活动 ${item.name}`}
                      onClick={() => {
                        setError('');
                        setDeleteId(item.id);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!data.timelog.activities.some(activeActivity) && (
                  <p className="phone-sidebar-empty">添加一个活动开始记录</p>
                )}
              </SidebarGroup>
              <SidebarGroup title="活动标签" onAdd={() => setTagAction({ kind: 'records' })}>
                {recordTags.map((tag) => (
                  <div className="phone-sidebar-row" key={tag}>
                    <button
                      className="phone-sidebar-link"
                      aria-current={recordFilter.tag === tag ? 'page' : undefined}
                      onClick={() => navigate(() => onRecordFilter({ tag }))}
                    >
                      <Hash size={17} style={{ color: data.tagColors.records[tag] }} />
                      <span>{tag}</span>
                      <small>
                        {records.filter((record) => record.tags.includes(tag)).length +
                          Number(data.timelog.timer?.tags.includes(tag) ?? false)}
                      </small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`编辑活动标签 ${tag}`}
                      onClick={() => setTagAction({ kind: 'records', edit: tag })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除活动标签 ${tag}`}
                      onClick={() => setTagAction({ kind: 'records', remove: tag })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!recordTags.length && <p className="phone-sidebar-empty">还没有活动标签</p>}
              </SidebarGroup>
            </>
          )}
          {kind === 'other' && (
            <p className="phone-sidebar-empty">管理外观、日程时区与设备同步。</p>
          )}
        </div>
        <footer className="phone-sidebar-footer">
          <button className="phone-sidebar-link" onClick={() => navigate(onSettings)}>
            <Settings size={19} />
            <span>设置与同步</span>
          </button>
        </footer>
      </SidebarPanel>
      {list && (
        <ListModal
          list={list === 'new' ? undefined : list}
          onClose={() => setList(null)}
          onSaved={() => setList(null)}
        />
      )}
      {editor && (
        <Editor
          target={editor}
          state={data.timelog}
          close={() => setEditor(null)}
          commit={async (transform) => {
            await store.transact((state) => ({ ...state, timelog: transform(state.timelog) }));
            return true;
          }}
        />
      )}
      {tagAction && <TagDialog action={tagAction} close={() => setTagAction(null)} />}
      {activity && (
        <Modal title="删除活动" close={() => setDeleteId(null)} sheet={!persistent}>
          <div className="phone-sidebar-form">
            <p>删除“{activity.name}”？该活动将从选择列表移除，关联目标会一并删除，历史记录保留。</p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <footer>
              <button className="secondary" onClick={() => setDeleteId(null)} disabled={busy}>
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void removeActivity()}
                disabled={busy}
              >
                删除活动
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}

function SidebarPanel({
  persistent,
  open,
  title,
  label,
  close,
  children,
}: {
  persistent: boolean;
  open: boolean;
  title: string;
  label: string;
  close: () => void;
  children: ReactNode;
}) {
  return persistent ? (
    <aside className="persistent-sidebar" aria-label={label}>
      {children}
    </aside>
  ) : open ? (
    <Modal title={title} drawer close={close}>
      {children}
    </Modal>
  ) : null;
}

function SidebarGroup({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="phone-sidebar-group">
      <header>
        <h3>{title}</h3>
        <button className="icon-button" aria-label={`新增${title}`} onClick={onAdd}>
          <Plus size={19} />
        </button>
      </header>
      {children}
    </section>
  );
}

function TagDialog({ action, close }: { action: TagAction; close: () => void }) {
  const { data } = useStore();
  const phone = usePhone();
  const isTask = action.kind === 'tasks';
  const kind = isTask ? 'tasks' : 'records';
  const [tag, setTag] = useState(action.remove ?? action.edit ?? '');
  const [color, setColor] = useState(data.tagColors[kind][action.edit ?? ''] ?? '#76b9ed');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const title = `${action.remove ? '删除' : action.edit ? '编辑' : '新增'}${isTask ? '待办' : '活动'}标签`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = tag.trim().replace(/^#+/, '');
    if (!value) return;
    setError('');
    setSaving(true);
    try {
      await store.transact((state) => {
        const tagColors = { ...state.tagColors, [kind]: { ...state.tagColors[kind] } };
        if (action.remove) delete tagColors[kind][value];
        else tagColors[kind][value] = color;
        if (!action.remove) return { ...state, tagColors };
        const change = (tags: string[]) => tags.filter((tag) => tag !== value);
        return {
          ...state,
          tagColors,
          tasks: isTask
            ? state.tasks.map((task) =>
                task.tags.includes(value)
                  ? { ...task, tags: change(task.tags), updatedAt: now() }
                  : task,
              )
            : state.tasks,
          timelog: isTask
            ? state.timelog
            : {
                ...state.timelog,
                records: state.timelog.records.map((record) =>
                  record.tags.includes(value)
                    ? {
                        ...record,
                        tags: change(record.tags),
                        updatedAt: timestamp(record.updatedAt),
                      }
                    : record,
                ),
                timer: state.timelog.timer
                  ? { ...state.timelog.timer, tags: change(state.timelog.timer.tags) }
                  : null,
                conflictedTimers: state.timelog.conflictedTimers?.map((timer) => ({
                  ...timer,
                  tags: change(timer.tags),
                })),
              },
        };
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={title} close={close} sheet={phone}>
      <form className="phone-sidebar-form" onSubmit={(event) => void save(event)}>
        {action.remove ? (
          <p>
            将从全部{isTask ? '待办' : '记录与计时'}中删除“#{action.remove}”，内容本身保留。
          </p>
        ) : (
          <>
            <label>
              标签名称
              <input
                autoFocus
                className="text-input"
                aria-label="标签名称"
                maxLength={40}
                required
                readOnly={!!action.edit}
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              />
            </label>
            <ColorPicker value={color} onChange={setColor} label="标签颜色" />
            <p className="muted">标签与颜色会随设备同步；可在任务或活动计时中使用。</p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="secondary" type="button" disabled={saving} onClick={close}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={saving || !tag.trim()}>
            {saving
              ? '保存中…'
              : action.remove
                ? '删除标签'
                : action.edit
                  ? '保存标签'
                  : '添加标签'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
