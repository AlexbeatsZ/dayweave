import { useEffect, useState } from 'react';
import { usageBridge, usageChanged } from './client';
import { defaultUsageSettings, type UsageSettings, type UsageStatus } from './domain';
import './usage.css';

export function UsageSettingsPanel() {
  const [status, setStatus] = useState<UsageStatus>();
  const [draft, setDraft] = useState<UsageSettings>(defaultUsageSettings);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    void usageBridge()
      .status()
      .then((status) => {
        setStatus(status);
        setDraft(status.settings);
      })
      .catch((error) => setError(String(error)));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await usageBridge().configure(draft);
      setStatus(next);
      setNotice('本机采集设置已保存');
      usageChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section usage-settings">
      <h3>自动记录</h3>
      <p>
        手动记录保留活动与积分；设备采集只保存使用事实，不自动增加积分。权限与采集开关仅作用于本机。
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        启用本机后台采集
      </label>
      <div className="usage-setting-grid">
        <label>
          采样间隔（秒）
          <input
            type="number"
            min="2"
            max="300"
            value={draft.sampleSeconds}
            onChange={(event) => setDraft({ ...draft, sampleSeconds: Number(event.target.value) })}
          />
        </label>
        <label>
          闲置阈值（分钟）
          <input
            type="number"
            min="1"
            max="120"
            value={draft.idleMinutes}
            onChange={(event) => setDraft({ ...draft, idleMinutes: Number(event.target.value) })}
          />
        </label>
      </div>
      <p className="usage-empty">
        采样间隔与闲置阈值用于桌面。Android 根据系统应用切换事件回填，后台由系统约每 15
        分钟调度；浏览器访问需另外启用无障碍。
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.browser}
          onChange={(event) => setDraft({ ...draft, browser: event.target.checked })}
        />
        采集浏览器网址（Android 需单独授权无障碍）
      </label>
      {(['excludedApps', 'excludedDomains', 'excludedKeywords'] as const).map((key) => (
        <label key={key}>
          {
            {
              excludedApps: '忽略应用',
              excludedDomains: '忽略域名',
              excludedKeywords: '敏感词（匹配标题或网址时隐藏两者）',
            }[key]
          }
          <textarea
            rows={2}
            value={draft[key].join('\n')}
            onChange={(event) =>
              setDraft({ ...draft, [key]: event.target.value.split('\n').filter(Boolean) })
            }
            placeholder="每行一项"
          />
        </label>
      ))}
      {usageBridge().permission && (
        <div className="usage-actions">
          {(['usage', 'browser', 'battery'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              onClick={() => {
                void usageBridge().permission!(kind).catch((error) => setError(String(error)));
              }}
            >
              {{ usage: '使用情况权限', browser: '浏览器权限', battery: '电池与后台' }[kind]}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>
        {busy ? '正在保存…' : '保存自动记录设置'}
      </button>
      {status && (
        <p aria-live="polite">
          {status.capture} · {status.count} 条 · 待上传 {status.pending} 条
          {status.lastSync ? ` · 最近同步 ${new Date(status.lastSync).toLocaleString()}` : ''}
        </p>
      )}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p>
        所有设备的记录通过现有中心配对同步。截图/OCR
        默认关闭；未授权、未上传与真实闲置不混为一谈。历史载入与导出在时间线中操作。
      </p>
    </section>
  );
}
