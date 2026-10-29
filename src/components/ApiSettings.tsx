import { useEffect, useState } from 'react';

export function ApiSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [error, setError] = useState('');
  const [api, setApi] = useState<{ url: string; enabled: boolean } | null>(null);
  useEffect(() => {
    void window.clearlist
      ?.apiInfo?.()
      .then((info) => setApi({ url: info.url, enabled: info.enabled }))
      .catch(() => setApi({ url: '', enabled: false }));
  }, []);
  return (
    <>
      {api && (
        <section className="settings-section api-settings">
          <h3>AI 接口</h3>
          {api.enabled ? (
            <>
              <code>{api.url}</code>
              <div className="data-actions">
                <button
                  className="button"
                  onClick={async () => {
                    setError('');
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
                    setError('');
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
            </>
          ) : (
            <p className="field-hint">接口未启用</p>
          )}
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
