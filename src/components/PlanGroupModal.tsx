import { useState } from 'react';
import { deletePlanGroup, newPlanGroup, now, type PlanGroup } from '../model';
import { store } from '../store';
import { Modal } from './Modal';

/** Create or edit one section of a day's plan, such as "午饭前" or "开会前". */
export function PlanGroupModal({
  date,
  group,
  onClose,
  onSaved,
}: {
  date: string;
  group?: PlanGroup;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(group?.title ?? '');
  const [minutes, setMinutes] = useState(group?.minutes?.toString() ?? '');
  const [until, setUntil] = useState(group?.until ?? '');
  const [note, setNote] = useState(group?.note ?? '');
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
  const fields = () => ({
    title: title.trim(),
    minutes: minutes.trim() ? Math.round(Number(minutes)) : null,
    until: until || null,
    note: note.trim(),
  });
  return (
    <Modal title={group ? '编辑分组' : '新的分组'} close={onClose}>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await save(
            () =>
              store.transact((s) => {
                if (!group)
                  return { ...s, planGroups: [...s.planGroups, newPlanGroup(date, fields())] };
                const latest = s.planGroups.find((row) => row.id === group.id);
                if (!latest || latest.deletedAt || latest.updatedAt !== group.updatedAt)
                  throw new Error('分组已在其他位置修改，请重新打开。');
                return {
                  ...s,
                  planGroups: s.planGroups.map((row) =>
                    row.id === group.id ? { ...row, ...fields(), updatedAt: now() } : row,
                  ),
                };
              }),
            group ? '分组已更新' : '分组已创建',
          );
        }}
      >
        <label className="form-label">
          分组名称
          <input
            autoFocus
            aria-label="分组名称"
            className="text-input"
            placeholder="例如：午饭前、开会前、睡前"
            maxLength={60}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="task-effort-fields">
          <label className="form-label">
            持续时间（分钟）
            <input
              aria-label="分组持续时间"
              className="text-input"
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label className="form-label">
            截止时刻
            <input
              aria-label="分组截止时刻"
              className="text-input"
              type="time"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </div>
        <label className="form-label">
          备注
          <input
            aria-label="分组备注"
            className="text-input"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {deleting && <p className="form-error">删除分组后，其中的任务仍留在这一天。</p>}
        <footer className="list-modal-footer">
          {group && (
            <button
              className="text-button danger"
              type="button"
              onClick={async () => {
                if (!deleting) {
                  setDeleting(true);
                  return;
                }
                await save(() => store.transact((s) => deletePlanGroup(s, group.id)), '分组已删除');
              }}
            >
              {deleting ? '确认删除分组' : '删除分组'}
            </button>
          )}
          <button className="button primary" disabled={busy || !title.trim()} type="submit">
            {group ? '保存分组' : '创建分组'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
