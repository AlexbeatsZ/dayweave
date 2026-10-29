import { timeZones, deviceZone, zoneLabel } from '../timezone';
import { useEffect, useState } from 'react';
import {
  Monitor,
  Sun,
  Moon,
  Check,
  ShieldCheck,
  SlidersHorizontal,
  Activity,
  Wifi,
  Info,
} from 'lucide-react';
import { type AppState } from '../model';
import { store, useStore } from '../store';
import { Modal } from './Modal';
import { SyncSettings } from './SyncSettings';
import { ApiSettings } from './ApiSettings';
import { UsageSettingsPanel } from '../usage/Settings';
import { version } from '../../package.json';
import { pendingPairingKey } from '../sync/invitation';
import './Settings.css';

const categories = [
  { id: 'general', label: '通用', Icon: SlidersHorizontal },
  { id: 'capture', label: '自动记录', Icon: Activity },
  { id: 'sync', label: '设备同步', Icon: Wifi },
  { id: 'about', label: '接口与关于', Icon: Info },
] as const;

export function Settings({
  onClose,
  onMessage,
}: {
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const snapshot = useStore();
  const [category, setCategory] = useState<string>(() =>
    sessionStorage.getItem(pendingPairingKey) ? 'sync' : 'general',
  );
  const { settings } = snapshot.data;
  const [error, setError] = useState('');
  useEffect(() => {
    const receive = () => setCategory('sync');
    document.addEventListener('dayweave:pairing', receive);
    return () => document.removeEventListener('dayweave:pairing', receive);
  }, []);
  const update = (patch: Partial<AppState['settings']>) =>
    store.update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  return (
    <Modal title="设置" close={onClose} closeLabel="关闭设置" className="settings-modal">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {categories.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={category === id ? 'page' : undefined}
              aria-controls={`settings-${id}`}
              onClick={() => setCategory(id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div id="settings-general" hidden={category !== 'general'}>
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
              <h3>日程</h3>
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
                      setError('');
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
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div id="settings-capture" hidden={category !== 'capture'}>
            <UsageSettingsPanel />
          </div>
          <div id="settings-sync" hidden={category !== 'sync'}>
            <SyncSettings />
          </div>
          <div id="settings-about" hidden={category !== 'about'}>
            <ApiSettings onMessage={onMessage} />
            <div className="about-block">
              <span className="brand-mark small-brand">
                <Check size={18} strokeWidth={3} />
              </span>
              <div>
                <strong>
                  时织 <span>Dayweave {version}</span>
                </strong>
                <p>
                  <ShieldCheck size={12} />
                  MIT 开源 · 离线优先 · 由你掌握数据
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
