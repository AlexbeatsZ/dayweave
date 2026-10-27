import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Wifi, Link, Unlink, Server } from 'lucide-react';
import type { Peer, SyncStatus } from '../sync/types';
import { pairingLink, pendingPairingKey } from '../sync/invitation';

export function SyncSettings() {
  const bridge = window.clearlist?.sync;
  const [status, setStatus] = useState<SyncStatus>();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [invitation, setInvitation] = useState(
      () => sessionStorage.getItem(pendingPairingKey) ?? '',
    ),
    [generated, setGenerated] = useState(''),
    [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setStatus(await bridge!.status());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const receive = () => {
      const text = sessionStorage.getItem(pendingPairingKey);
      if (text) {
        setInvitation(text);
        setError('');
        sessionStorage.removeItem(pendingPairingKey);
      }
    };
    receive();
    document.addEventListener('dayweave:pairing', receive);
    return () => document.removeEventListener('dayweave:pairing', receive);
  }, []);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const update = () =>
      void bridge
        .status()
        .then((value) => {
          if (live) setStatus(value);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    update();
    const timer = setInterval(update, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [bridge]);
  return (
    <section className="settings-section sync-settings">
      <h3>
        <Wifi size={17} /> 设备同步
      </h3>
      {!bridge ? (
        <p>设备同步在 Windows、macOS 和 Android 应用中可用。</p>
      ) : (
        <>
          <p>
            ROG
            作为同步中心。配对后打开或回到前台自动同步，前台持续交换；后台可暂停，离线修改重连后合并。公网连接使用
            HTTPS 地址。
          </p>
          {status && (
            <div className="sync-status">
              <i className={status.connected ? 'online' : ''} />
              <strong>
                {status.mode === 'off'
                  ? '尚未连接'
                  : status.mode === 'hub'
                    ? '本机是同步中心'
                    : status.delivery === 'local-error'
                      ? '本地保存失败 · 暂停同步'
                      : status.connected
                        ? '已连接同步中心'
                        : '离线 · 修改保存在本机'}
              </strong>
              {status.lastSync && (
                <small>最近同步 {new Date(status.lastSync).toLocaleTimeString()}</small>
              )}
              {status.delivery && (
                <small>
                  {
                    {
                      off: '未启用同步',
                      saved: '本地已保存 · 同步中心',
                      pending: '本地已保存 · 待上传',
                      syncing: '正在同步',
                      synced: '已同步',
                      offline: status.pendingChanges
                        ? '离线 · 本地已保存，待上传'
                        : '离线 · 下次打开或联网后重试',
                      conflict: '存在冲突 · 请处理保留的候选',
                      'local-error': '本地尚未保存 · 暂停上传',
                    }[status.delivery]
                  }
                </small>
              )}
            </div>
          )}
          {status?.mode === 'hub' ? (
            <>
              <p className="field-hint">{status.addresses?.join(' · ')}</p>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setGenerated(pairingLink(await bridge.invite!()));
                    setCopied(false);
                  })
                }
              >
                <Link size={15} />
                生成 5 分钟配对邀请
              </button>
              {generated && (
                <div className="pairing-invitation">
                  <label>
                    在其他设备粘贴此邀请
                    <textarea readOnly value={generated} />
                  </label>
                  <button
                    className="button"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(generated);
                        setCopied(true);
                      })
                    }
                  >
                    <Copy size={15} />
                    {copied ? '已复制' : '复制邀请'}
                  </button>
                  <p className="field-hint">
                    邀请包含配对密钥，仅发给自己的设备。每个邀请只能使用一次。
                  </p>
                </div>
              )}
              {status.peers?.map((peer) => (
                <div className="sync-peer" key={peer.id}>
                  <span>{peer.name}</span>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(() => bridge.revoke!(peer.id))}
                  >
                    取消配对
                  </button>
                </div>
              ))}
            </>
          ) : status?.mode === 'client' ? (
            <>
              <p className="field-hint">{status.endpoint}</p>
              {bridge.setEndpoint && (
                <details>
                  <summary>更换同步地址（保留配对）</summary>
                  <label>
                    同步中心 HTTPS 或局域网地址
                    <input
                      aria-label="新的同步中心地址"
                      placeholder="https://sync.example.com/dayweave"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                    />
                  </label>
                  <button
                    className="button"
                    disabled={busy || !endpoint.trim()}
                    onClick={() =>
                      void run(async () => {
                        await bridge.setEndpoint!(endpoint);
                        setEndpoint('');
                      })
                    }
                  >
                    保存地址并同步
                  </button>
                  <p className="field-hint">
                    仅更换同一中心的网络入口，不改变设备身份、密钥或待同步数据。不要填入订阅链接。
                  </p>
                </details>
              )}
              <button
                className="button"
                disabled={busy}
                onClick={() => void run(() => bridge.now())}
              >
                <RefreshCw size={15} />
                立即同步
              </button>
              <p className="field-hint">
                手机和平板在应用打开时自动同步。系统在后台冻结应用时，会在下次打开后补齐；计时时长照常由开始时间恢复。
              </p>
            </>
          ) : (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => void run(async () => setPeers(await bridge.discover()))}
              >
                <RefreshCw size={15} />
                查找局域网同步中心
              </button>
              {peers.map((peer) => (
                <button
                  className={`sync-found ${endpoint === peer.endpoint ? 'selected' : ''}`}
                  key={peer.endpoint}
                  onClick={() => setEndpoint(peer.endpoint)}
                >
                  <Server size={16} />
                  <span>
                    {peer.name}
                    <small>{peer.endpoint}</small>
                  </span>
                </button>
              ))}
              <label>
                同步中心地址（可选）
                <input
                  aria-label="同步中心地址"
                  placeholder="自动使用邀请内地址"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
              <label>
                ROG 配对邀请
                <textarea
                  aria-label="配对邀请"
                  placeholder="粘贴在 ROG 生成的配对邀请"
                  value={invitation}
                  onChange={(e) => setInvitation(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || !invitation.trim()}
                onClick={() =>
                  void run(async () => {
                    await bridge.pair(invitation, endpoint);
                    setInvitation('');
                  })
                }
              >
                <Link size={15} />
                配对并同步
              </button>
              {bridge.enableHub && (
                <details>
                  <summary>将本机作为同步中心</summary>
                  <p className="field-hint">
                    只需在常在线的 ROG 开启一次。其他电脑使用上方配对入口。
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(() => bridge.enableHub!())}
                  >
                    <Server size={15} />
                    开启同步中心
                  </button>
                </details>
              )}
            </>
          )}
          {status && status.mode !== 'off' && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => bridge.disconnect())}
            >
              <Unlink size={15} />
              {status.mode === 'hub' ? '关闭同步中心' : '断开同步（保留本机数据）'}
            </button>
          )}
          {!!status?.conflicts.length && (
            <div className="sync-conflicts">
              <h4>需要处理 {status.conflicts.length} 项冲突</h4>
              <p>同一内容在离线期间分别修改，当前保留中心版本。你的修改也已保存在这里。</p>
              {status.conflicts.map((conflict, index) => (
                <div key={index}>
                  <strong>
                    {conflict.key} · {conflict.field}
                  </strong>
                  <pre>{JSON.stringify(conflict.local, null, 2)}</pre>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(() => bridge.resolve(index, true))}
                  >
                    应用这份修改
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void run(() => bridge.resolve(index, false))}
                  >
                    保留中心版本
                  </button>
                </div>
              ))}
            </div>
          )}
          {(error || status?.error) && (
            <p role="alert" className="error">
              {error || status?.error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
