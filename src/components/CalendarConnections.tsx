import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { usePhone } from '../phone/usePhone';
import {
  calendarAuthorizationUrl,
  calendarExternalUrl,
  calendarSetupUrls,
  calendarProviderNames,
  oauthProviders,
  type OAuthProvider,
  type CalendarAccountCommand,
  type CalendarAccountsStatus,
  type CalendarAccountStatus,
} from '../calendar-accounts';

export function CalendarConnections({ close }: { close: () => void }) {
  const phone = usePhone();
  const [status, setStatus] = useState<CalendarAccountsStatus>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [setup, setSetup] = useState<OAuthProvider>();
  const [apple, setApple] = useState(false),
    [waiting, setWaiting] = useState(false);
  const [clientId, setClientId] = useState(''),
    [clientSecret, setClientSecret] = useState(''),
    [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const send = async (command: CalendarAccountCommand) => {
    const call = window.clearlist?.sync?.calendarAccounts;
    if (!call) throw new Error('请先升级此设备与同步中心，再连接日历账号。');
    const reply = await call(command);
    setStatus(reply.status);
    return reply;
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '日历连接失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const reply = await window.clearlist?.sync?.calendarAccounts?.({ action: 'status' });
        if (!active) return;
        if (!reply) throw new Error('请先升级此设备与同步中心，再连接日历账号。');
        setStatus(reply.status);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取日历连接。');
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const refreshing = status?.accounts.some((account) => account.refreshing);
  useEffect(() => {
    if (!waiting && !refreshing) return;
    const timer = setInterval(() => {
      if (!document.hidden && !busy) void send({ action: 'status' }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [waiting, refreshing, busy]);
  const authorize = async (provider: OAuthProvider) => {
    const reply = await send({ action: 'authorize', provider });
    if (!reply.authorizationUrl) throw new Error('未取得日历登录地址，请重试。');
    const url = calendarAuthorizationUrl(reply.authorizationUrl);
    if (window.clearlist?.openCalendarLink) await window.clearlist.openCalendarLink(url);
    else if (!window.open(url, '_blank', 'noopener,noreferrer'))
      throw new Error('请允许打开登录窗口后重试。');
    setSetup(undefined);
    setWaiting(true);
  };
  const openSetup = (url: string) =>
    run(async () => {
      const allowed = calendarExternalUrl(url);
      if (window.clearlist?.openCalendarLink) await window.clearlist.openCalendarLink(allowed);
      else window.open(allowed, '_blank', 'noopener,noreferrer');
    });
  const configure = async (provider: OAuthProvider) => {
    setApple(false);
    setSetup(provider);
    setClientId(status?.providers[provider].clientId ?? '');
    setClientSecret('');
    let base = status?.providers[provider].baseUrl ?? '';
    if (!base) {
      const sync = await window.clearlist?.sync?.status();
      base =
        [...(sync?.endpoints ?? []), ...(sync?.addresses ?? [])].find((url) =>
          url.startsWith('https://'),
        ) ?? '';
    }
    setBaseUrl(base);
  };
  const select = (account: CalendarAccountStatus, importIds: string[], publishId: string | null) =>
    run(async () => {
      await send({ action: 'select', accountId: account.id, importIds, publishId });
    });
  return (
    <Modal
      title="连接日历账号"
      close={() => {
        if (!busy) close();
      }}
      sheet={phone}
    >
      <div className="event-form calendar-connections">
        <div className="calendar-provider-actions">
          {oauthProviders.map((provider) => (
            <button
              key={provider}
              className="button"
              disabled={busy || !status}
              onClick={() =>
                void run(() =>
                  status?.providers[provider].configured
                    ? authorize(provider)
                    : configure(provider),
                )
              }
            >
              登录 {calendarProviderNames[provider]}
            </button>
          ))}
          <button
            className="button"
            disabled={busy || !status}
            onClick={() => {
              setApple(!apple);
              setSetup(undefined);
              setPassword('');
            }}
          >
            连接 Apple / iCloud
          </button>
        </div>
        {waiting && <p role="status">在浏览器完成授权后返回这里，账号会自动显示。</p>}
        {setup && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await send({
                  action: 'configure',
                  provider: setup,
                  clientId,
                  clientSecret: clientSecret || undefined,
                  baseUrl,
                });
                setClientSecret('');
                await authorize(setup);
              });
            }}
          >
            <h3>{calendarProviderNames[setup]}登录设置</h3>
            <p>首次连接需要注册登录应用，配置保存在你的数据中心，所有已配对设备共用。</p>
            <details>
              <summary>注册登录应用</summary>
              <div className="calendar-account-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void openSetup(calendarSetupUrls[setup])}
                >
                  打开{setup === 'google' ? ' Google Cloud' : ' Microsoft Entra'}
                </button>
                {setup === 'google' && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => void openSetup(calendarSetupUrls.googleApi)}
                  >
                    启用 Google Calendar API
                  </button>
                )}
              </div>
              {setup === 'google' ? (
                <p>
                  在 Google Cloud 启用 Google Calendar API，配置 OAuth 同意屏幕，并创建“Web
                  应用”OAuth 客户端。将下面的回调地址加入“已获授权的重定向
                  URI”。测试模式需要将自己的邮箱加入测试用户。
                </p>
              ) : (
                <p>
                  在 Microsoft Entra 注册应用，支持组织目录和个人 Microsoft 账号。添加 Web
                  平台与下面的回调地址，创建客户端密钥，并使用密钥“值”。日历权限会在登录时申请。
                </p>
              )}
              {setup === 'google' && (
                <p>Google 测试模式的持续访问授权通常在 7 天后过期，届时需要重新登录。</p>
              )}
            </details>
            <label>
              数据中心 HTTPS 地址
              <input
                required
                aria-label="登录数据中心地址"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value.trim())}
                placeholder="https://你的数据中心/dayweave"
              />
            </label>
            <label>
              授权回调地址
              <input
                aria-label="日历授权回调地址"
                readOnly
                value={baseUrl ? `${baseUrl.replace(/\/$/, '')}/calendar-oauth/callback` : ''}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <label>
              客户端 ID
              <input
                required
                aria-label="日历客户端 ID"
                value={clientId}
                onChange={(event) => setClientId(event.target.value.trim())}
                autoComplete="off"
              />
            </label>
            <label>
              客户端密钥
              <input
                type="password"
                required={!status?.providers[setup].configured}
                aria-label="日历客户端密钥"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="off"
                placeholder={status?.providers[setup].configured ? '留空沿用已保存的密钥' : ''}
              />
            </label>
            <button className="button primary" disabled={busy}>
              保存并登录
            </button>
          </form>
        )}
        {apple && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await send({ action: 'apple', username, password });
                setPassword('');
                setApple(false);
              });
            }}
          >
            <h3>连接 iCloud 日历</h3>
            <p>
              在已开启双重认证的 Apple 账户中，进入“登录和安全 →
              应用专用密码”生成密码，填入后即可选择私人日历。
            </p>
            <button
              type="button"
              className="button"
              onClick={() => void openSetup(calendarSetupUrls.apple)}
            >
              打开 Apple 账户
            </button>
            <label>
              Apple 账户邮箱
              <input
                type="email"
                required
                aria-label="Apple 账户邮箱"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              应用专用密码
              <input
                type="password"
                required
                aria-label="Apple 应用专用密码"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              连接 iCloud 日历
            </button>
          </form>
        )}
        {status?.accounts.map((account) => (
          <section
            className="calendar-source calendar-connected-account"
            key={account.id}
            aria-label={`${calendarProviderNames[account.provider]}账号 ${account.name}`}
          >
            <div>
              <strong>{account.name}</strong>
              <p>{calendarProviderNames[account.provider]}</p>
            </div>
            <fieldset disabled={busy}>
              <legend>导入到时织</legend>
              {account.calendars.map((calendar) => (
                <label className="event-checkbox" key={calendar.id}>
                  <input
                    type="checkbox"
                    aria-label={`导入 ${calendar.name}`}
                    checked={account.importIds.includes(calendar.id)}
                    onChange={(event) =>
                      void select(
                        account,
                        event.target.checked
                          ? [...account.importIds, calendar.id]
                          : account.importIds.filter((id) => id !== calendar.id),
                        account.publishId,
                      )
                    }
                  />
                  {calendar.name}
                </label>
              ))}
              {!account.calendars.length && <p>此账号还没有可访问的日历。</p>}
            </fieldset>
            <label>
              发布时织日程到
              <select
                aria-label={`${account.name}的发布日历`}
                disabled={busy}
                value={account.publishId ?? ''}
                onChange={(event) =>
                  void select(account, account.importIds, event.target.value || null)
                }
              >
                <option value="">暂停发布</option>
                {account.calendars
                  .filter((calendar) => calendar.writable)
                  .map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
              </select>
            </label>
            {account.publishId && (
              <p className="field-hint">发布时织创建的日程及课程。已发布项目继续由时织更新。</p>
            )}
            <p role="status">
              {account.refreshing
                ? '正在同步日历…'
                : account.checkedAt
                  ? `上次读取 ${new Date(account.checkedAt).toLocaleString()}`
                  : '等待首次读取'}
            </p>
            {account.error && (
              <p className="form-error" role="alert">
                {account.error}
              </p>
            )}
            <div className="calendar-account-actions">
              <button
                className="button"
                disabled={busy || account.refreshing}
                onClick={() =>
                  void run(async () => {
                    await send({ action: 'refresh', accountId: account.id });
                  })
                }
              >
                立即同步
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (window.confirm('断开此账号并停止日历同步？已导入和已发布的日程会保留。'))
                      await send({ action: 'disconnect', accountId: account.id });
                  })
                }
              >
                断开连接
              </button>
            </div>
          </section>
        ))}
        <details>
          <summary>登录应用设置</summary>
          <div className="calendar-account-actions">
            {oauthProviders.map((provider) => (
              <button
                key={provider}
                className="button"
                disabled={busy || !status}
                onClick={() => void run(() => configure(provider))}
              >
                {calendarProviderNames[provider]}
              </button>
            ))}
          </div>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="button" disabled={busy} onClick={close}>
            完成
          </button>
        </footer>
      </div>
    </Modal>
  );
}
