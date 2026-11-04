import { useState } from 'react';
import { deletePlanGroup, newPlanGroup, now, type PlanGroup } from '../model';
import { store } from '../store';
import { Modal } from './Modal';

/** Create or edit one time slot (section) of a day's plan, such as "午饭前" or "开会前". */
export function PlanGroupModal({
  date,
  group,
  onClose,
  onSaved,
}: {
  date: string;
  group?: PlanGroup;
  onClose: () => void;
  /** `created` is the new slot when one was created, so a caller can select it. */
  onSaved: (message: string, created?: PlanGroup) => void;
}) {
  const [title, setTitle] = useState(group?.title ?? '');
  const [minutes, setMinutes] = useState(group?.minutes?.toString() ?? '');
  const [until, setUntil] = useState(group?.until ?? '');
  const [note, setNote] = useState(group?.note ?? '');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(action: () => Promise<unknown>, message: string, created?: PlanGroup) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onSaved(message, created);
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
    <Modal title={group ? '编辑时段' : '新的时段'} close={onClose}>
      <form
        className="modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          let created: PlanGroup | undefined;
          try {
            created = group ? undefined : newPlanGroup(date, fields());
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            return;
          }
          await save(
            () =>
              store.transact((s) => {
                if (!group) return { ...s, planGroups: [...s.planGroups, created!] };
                const latest = s.planGroups.find((row) => row.id === group.id);
                if (!latest || latest.deletedAt || latest.updatedAt !== group.updatedAt)
                  throw new Error('时段已在其他位置修改，请重新打开。');
                return {
                  ...s,
                  planGroups: s.planGroups.map((row) =>
                    row.id === group.id ? { ...row, ...fields(), updatedAt: now() } : row,
                  ),
                };
              }),
            group ? '时段已更新' : '时段已创建',
            created,
          );
        }}
      >
        <label className="form-label">
          时段名称
          <input
            autoFocus
            aria-label="时段名称"
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
              aria-label="时段持续时间"
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
              aria-label="时段截止时刻"
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
            aria-label="时段备注"
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
        {deleting && <p className="form-error">删除时段后，其中的任务仍留在这一天。</p>}
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
                await save(() => store.transact((s) => deletePlanGroup(s, group.id)), '时段已删除');
              }}
            >
              {deleting ? '确认删除时段' : '删除时段'}
            </button>
          )}
          <button className="button primary" disabled={busy || !title.trim()} type="submit">
            {group ? '保存时段' : '创建时段'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
