import { useState } from 'react';
import { colors, uid, defaultTaskActivity, type TaskList } from '../model';
import { store, useStore } from '../store';
import { ColorPicker } from './ColorPicker';
import { activeActivity } from '../timelog/domain';
import { Modal } from './Modal';

export function ListModal({
  list,
  onClose,
  onSaved,
}: {
  list?: TaskList;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? colors[0]);
  const { data } = useStore();
  const [activityId, setActivityId] = useState(list?.activityId ?? '');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onSaved(message);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={list ? '编辑清单' : '新的清单'} close={onClose}>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await save(
            () =>
              store.transact((s) => ({
                ...s,
                lists: list
                  ? s.lists.map((l) =>
                      l.id === list.id
                        ? { ...l, name: name.trim(), color, activityId: activityId || null }
                        : l,
                    )
                  : [
                      ...s.lists,
                      {
                        id: uid(),
                        name: name.trim(),
                        color,
                        activityId: activityId || null,
                        order: Date.now(),
                      },
                    ],
              })),
            list ? '清单已更新' : '清单已创建',
          );
        }}
      >
        <label className="form-label">
          清单名称
          <input
            autoFocus
            aria-label="清单名称"
            className="text-input"
            placeholder="例如：工作、生活、想学的事"
            maxLength={60}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <span className="form-label">清单颜色</span>
        <ColorPicker value={color} onChange={setColor} label="清单颜色" />
        <label className="form-label">
          默认计时活动
          <select
            className="text-input"
            aria-label="清单计时活动"
            value={activityId}
            onChange={(event) => setActivityId(event.target.value)}
          >
            <option value="">
              自动匹配
              {defaultTaskActivity(name.trim())
                ? ` · ${defaultTaskActivity(name.trim())}`
                : ' · 学习'}
            </option>
            {data.timelog.activities.filter(activeActivity).map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.name}
              </option>
            ))}
          </select>
        </label>
        <p className="field-hint">学习→学习，工作→实操，生活→日常。也可以为任意清单指定活动。</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {deleting && (
          <p className="form-error">删除清单后，其中的任务将移到未分组，计划日期保持不变。</p>
        )}
        <footer className="list-modal-footer">
          {list && (
            <button
              className="text-button danger"
              type="button"
              onClick={async () => {
                if (!deleting) {
                  setDeleting(true);
                  return;
                }
                await save(
                  () =>
                    store.transact((s) => ({
                      ...s,
                      lists: s.lists.filter((l) => l.id !== list.id),
                      tasks: s.tasks.map((task) =>
                        task.listId === list.id
                          ? { ...task, listId: 'inbox', updatedAt: new Date().toISOString() }
                          : task,
                      ),
                    })),
                  '清单已删除，任务已移到未分组',
                );
              }}
            >
              {deleting ? '确认删除清单' : '删除清单'}
            </button>
          )}
          <button className="button primary" disabled={busy || !name.trim()} type="submit">
            {list ? '保存清单' : '创建清单'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
