import { timeZones, deviceZone, zoneLabel } from '../timezone';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  Download,
  Upload,
  Monitor,
  Sun,
  Moon,
  Check,
  FolderOpen,
  ShieldCheck,
} from 'lucide-react';
import { colors, uid, type AppState, type TaskList } from '../model';
import { store, useStore } from '../store';
import { useDialogFocus } from './useDialogFocus';
import { SyncSettings } from './SyncSettings';

export function Settings({
  onClose,
  onMessage,
}: {
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const snapshot = useStore();
  const dialogRef = useDialogFocus();
  const { settings } = snapshot.data;
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [api, setApi] = useState<{ url: string; enabled: boolean } | null>(null);
  useEffect(() => {
    void window.clearlist
      ?.apiInfo?.()
      .then((info) => setApi({ url: info.url, enabled: info.enabled }))
      .catch(() => setApi({ url: '', enabled: false }));
  }, []);
  const update = (patch: Partial<AppState['settings']>) =>
    store.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const receive = (value: unknown) => {
    const before = store.get().tasks.length;
    store.importData(value);
    onMessage(
      `导入完成，新增 ${store.get().tasks.length - before} 件任务，同 ID 任务按更新时间合并`,
    );
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">DAYWEAVE</span>
            <h2 id="settings-title">让时织适合你</h2>
          </div>
          <button className="icon-button" aria-label="关闭设置" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">
          <SyncSettings />
          <section className="settings-section">
            <h3>外观</h3>
            <div className="theme-choices">
              {(
                [
                  { value: 'light', title: '浅色', Icon: Sun },
                  { value: 'dark', title: '深色', Icon: Moon },
                  { value: 'system', title: '跟随系统', Icon: Monitor },
                ] as const
              ).map(({ value, title, Icon }) => (
                <button
                  className={`theme-choice ${settings.theme === value ? 'active' : ''}`}
                  key={value}
                  onClick={() => update({ theme: value })}
                  aria-pressed={settings.theme === value}
                >
                  <Icon size={22} />
                  <span>{title}</span>
                  {settings.theme === value && <Check size={13} className="theme-check" />}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>专注节奏</h3>
            <div className="duration-settings">
              <label>
                专注时长
                <div>
                  <input
                    key={`focus-${settings.focusMinutes}`}
                    aria-label="专注时长"
                    type="number"
                    min={1}
                    max={180}
                    defaultValue={settings.focusMinutes}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n <= 180) update({ focusMinutes: n });
                      else e.target.value = String(settings.focusMinutes);
                    }}
                  />
                  分钟
                </div>
              </label>
              <label>
                休息时长
                <div>
                  <input
                    key={`break-${settings.breakMinutes}`}
                    aria-label="休息时长"
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={settings.breakMinutes}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 1 && n <= 60) update({ breakMinutes: n });
                      else e.target.value = String(settings.breakMinutes);
                    }}
                  />
                  分钟
                </div>
              </label>
            </div>
            <p className="field-hint">新时长会用于下一次计时。</p>
          </section>
          <section className="settings-section">
            <h3>日程时区</h3>
            <p>任务的今天、日历和时间统计按此时区计算。课程表可在学期设置中独立指定课程时区。</p>
            <label className="timezone-setting">
              日程时区
              <input
                key={settings.timeZone}
                aria-label="日程时区"
                list="app-timezones"
                defaultValue={settings.timeZone}
                onBlur={(e) => {
                  try {
                    update({ timeZone: e.target.value });
                  } catch (error) {
                    setError(String(error));
                  }
                }}
              />
              <datalist id="app-timezones">
                {timeZones.map(([zone, label]) => (
                  <option key={zone} value={zone}>
                    {label}
                  </option>
                ))}
              </datalist>
            </label>
            <p className="field-hint">
              设备：{zoneLabel(deviceZone())} · 日程：{zoneLabel(settings.timeZone)}
            </p>
          </section>
          <section className="settings-section">
            <h3>数据与备份</h3>
            <p className="setting-description">
              待办、时间记录、课程和时区设置共用一个备份。支持导入 Clearlist 和 Open Timelog 的 JSON
              备份。
            </p>
            <div className="data-actions">
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    if (await store.exportData()) onMessage('备份已导出');
                  } catch (error) {
                    setError(`导出失败：${String(error)}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download size={16} />
                导出 JSON
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setError('');
                  if (!window.clearlist) {
                    fileInput.current?.click();
                    return;
                  }
                  setBusy(true);
                  try {
                    const value = await window.clearlist.importData();
                    if (value) receive(value);
                  } catch {
                    setError('导入失败：请使用有效的时织 JSON 备份，版本需为 1。原有数据未改变。');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Upload size={16} />
                合并导入
              </button>
            </div>
            <input
              className="visually-hidden"
              ref={fileInput}
              aria-label="选择备份文件"
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  if (file.size > 50 * 1024 * 1024) throw new Error('文件过大');
                  receive(JSON.parse(await file.text()));
                } catch {
                  setError('导入失败：请使用有效的时织 JSON 备份，版本需为 1。原有数据未改变。');
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="field-hint">
              导入会保留现有任务；同 ID 任务保留更新时间较新的版本。偏好和进行中的计时保持当前设置。
            </p>
            <div className="storage-location">
              <FolderOpen size={16} />
              <span>{snapshot.path}</span>
            </div>
            {!window.clearlist && (
              <p className="browser-notice">
                当前为浏览器版。数据仅保存在此浏览器，与桌面版分开；清理网站数据前请先导出。
              </p>
            )}
          </section>
          {api && (
            <section className="settings-section api-settings">
              <h3>AI 接口</h3>
              <p className="setting-description">
                让本机的 AI 工具读取与整理任务。每次修改都会同步显示在清单里。
              </p>
              {api.enabled ? (
                <>
                  <code>{api.url}</code>
                  <div className="data-actions">
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(api.url);
                          onMessage('接口地址已复制');
                        } catch {
                          setError('复制失败，请从地址栏手动复制');
                        }
                      }}
                    >
                      复制地址
                    </button>
                    <button
                      className="button"
                      onClick={async () => {
                        try {
                          const info = await window.clearlist!.apiInfo!();
                          await navigator.clipboard.writeText(info.token);
                          onMessage('访问令牌已复制');
                        } catch {
                          setError('复制令牌失败，请查看用户数据目录的 api.json');
                        }
                      }}
                    >
                      复制访问令牌
                    </button>
                  </div>
                  <p className="field-hint">
                    使用 Bearer 令牌，只允许本机访问。接口文档位于项目
                    docs/api/，支持任务、清单、专注与统计。
                  </p>
                </>
              ) : (
                <p className="field-hint">
                  接口未启用。若未主动关闭，请重新打开时织并检查数据目录。
                </p>
              )}
            </section>
          )}
          <div className="about-block">
            <span className="brand-mark small-brand">
              <Check size={18} strokeWidth={3} />
            </span>
            <div>
              <strong>
                时织 <span>Dayweave 0.3.0</span>
              </strong>
              <p>
                <ShieldCheck size={12} />
                MIT 开源 · 离线优先 · 由你掌握数据
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

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
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useDialogFocus();
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal list-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-modal-title"
      >
        <header className="modal-header">
          <h2 id="list-modal-title">{list ? '编辑清单' : '新的清单'}</h2>
          <button className="icon-button" aria-label="关闭清单编辑" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            store.update((s) => ({
              ...s,
              lists: list
                ? s.lists.map((l) => (l.id === list.id ? { ...l, name: name.trim(), color } : l))
                : [...s.lists, { id: uid(), name: name.trim(), color, order: Date.now() }],
            }));
            onSaved(list ? '清单已更新' : '清单已创建');
            onClose();
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
          <div className="color-choices">
            {colors.map((value) => (
              <button
                className={color === value ? 'selected-color' : ''}
                style={{ background: value }}
                type="button"
                key={value}
                aria-label={`颜色 ${value}`}
                onClick={() => setColor(value)}
              >
                {color === value && <Check size={15} />}
              </button>
            ))}
          </div>
          {deleting && <p className="form-error">删除清单后，其中的任务将移到收集箱。</p>}
          <footer className="list-modal-footer">
            {list && (
              <button
                className="text-button danger"
                type="button"
                onClick={() => {
                  if (!deleting) {
                    setDeleting(true);
                    return;
                  }
                  store.update((s) => ({
                    ...s,
                    lists: s.lists.filter((l) => l.id !== list.id),
                    tasks: s.tasks.map((t) =>
                      t.listId === list.id
                        ? { ...t, listId: 'inbox', updatedAt: new Date().toISOString() }
                        : t,
                    ),
                  }));
                  onSaved('清单已删除，任务已移到收集箱');
                  onClose();
                }}
              >
                {deleting ? '确认删除清单' : '删除清单'}
              </button>
            )}
            <button className="button primary" disabled={!name.trim()} type="submit">
              {list ? '保存清单' : '创建清单'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
