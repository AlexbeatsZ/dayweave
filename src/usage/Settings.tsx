import { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { usageBridge, usageChanged, useUsage } from './client';
import { ApplicationPicker } from './ApplicationPicker';
import type { UsageSettings } from './domain';
import './usage.css';

function PrivacyRules({
  title,
  values,
  onChange,
}: {
  title: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState('');
  function add() {
    const value = input.trim();
    if (
      !value ||
      values.length >= 200 ||
      values.some((item) => item.toLowerCase() === value.toLowerCase())
    )
      return;
    onChange([...values, value]);
    setInput('');
  }
  return (
    <div className="usage-privacy-rules">
      <span>{title}</span>
      <div className="usage-rule-tags">
        {values.map((value) => (
          <span key={value}>
            {value}
            <button
              type="button"
              aria-label={`移除${title} ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="usage-rule-input">
        <input
          aria-label={`添加${title}`}
          value={input}
          maxLength={512}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" disabled={!input.trim() || values.length >= 200} onClick={add}>
          添加
        </button>
      </div>
    </div>
  );
}

export function UsageSettingsPanel() {
  const result = useUsage();
  const status = result.status;
  const [draft, setDraft] = useState<UsageSettings>();
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (status) setDraft((previous) => previous ?? status.settings);
  }, [status]);
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await usageBridge().configure(draft);
      setDraft(next.settings);
      setNotice('已保存');
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
      {draft && (
        <>
          <label className="usage-setting-row">
            <span>
              <strong>本机记录</strong>
              <small>{status?.capture}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="本机记录"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
          </label>
          {window.clearlist?.platform !== 'android' && (
            <div className="usage-setting-grid">
              <label>
                采样间隔（秒）
                <input
                  type="number"
                  min={2}
                  max={300}
                  value={draft.sampleSeconds}
                  onChange={(event) =>
                    setDraft({ ...draft, sampleSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                闲置阈值（分钟）
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={draft.idleMinutes}
                  onChange={(event) =>
                    setDraft({ ...draft, idleMinutes: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          )}
          <label className="usage-setting-row">
            <strong>浏览器网址</strong>
            <input
              type="checkbox"
              role="switch"
              aria-label="浏览器网址"
              checked={draft.browser}
              onChange={(event) => setDraft({ ...draft, browser: event.target.checked })}
            />
          </label>
          <button
            type="button"
            className="usage-setting-row usage-apps-button"
            onClick={() => setPicker(true)}
          >
            <span>
              <strong>忽略应用</strong>
              <small>
                {draft.excludedApps.length
                  ? `已忽略 ${draft.excludedApps.length} 项`
                  : '未忽略应用'}
              </small>
            </span>
            <ChevronRight size={18} />
          </button>
          <PrivacyRules
            title="忽略域名"
            values={draft.excludedDomains}
            onChange={(values) => setDraft({ ...draft, excludedDomains: values })}
          />
          <PrivacyRules
            title="敏感词"
            values={draft.excludedKeywords}
            onChange={(values) => setDraft({ ...draft, excludedKeywords: values })}
          />
          {usageBridge().permission && (
            <div className="usage-actions">
              {(window.clearlist?.platform === 'android'
                ? (['usage', 'browser', 'battery'] as const)
                : (['usage'] as const)
              ).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  onClick={() =>
                    void usageBridge().permission!(kind).catch((error) => setError(String(error)))
                  }
                >
                  {
                    {
                      usage:
                        window.clearlist?.platform === 'darwin'
                          ? '辅助功能权限'
                          : status?.permissionRequired
                            ? '授权使用情况'
                            : '使用情况权限',
                      browser: '无障碍权限',
                      battery: '电池与后台',
                    }[kind]
                  }
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? '正在保存…' : '保存'}
          </button>
          {picker && (
            <ApplicationPicker
              selected={draft.excludedApps}
              close={() => setPicker(false)}
              onSave={(values) => {
                setDraft({ ...draft, excludedApps: values });
                setPicker(false);
              }}
            />
          )}
        </>
      )}
      {(error || result.error || status?.error) && (
        <p role="alert">{error || result.error || status?.error}</p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
