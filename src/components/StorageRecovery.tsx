import { useRef, useState } from 'react';
import { store } from '../store';
import { Modal } from './Modal';

export function StorageRecovery({
  loaded,
  conflict = false,
}: {
  loaded: boolean;
  conflict?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="data-actions storage-recovery-actions">
        {loaded ? (
          <>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => store.exportData())}
            >
              导出未保存内容
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => store.retry())}
            >
              {conflict ? '重新检查冲突' : '重试保存'}
            </button>
            <button className="button" disabled={busy} onClick={() => setConfirm(true)}>
              重新读取已保存数据
            </button>
          </>
        ) : (
          <>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => store.initialize())}
            >
              重新读取
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                window.clearlist ? void run(() => store.restore()) : picker.current?.click()
              }
            >
              选择备份恢复
            </button>
            <input
              className="visually-hidden"
              ref={picker}
              type="file"
              accept="application/json,.json"
              aria-label="选择恢复备份"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file)
                  void run(async () => {
                    if (file.size > 50 * 1024 * 1024) throw new Error('文件过大');
                    await store.restore(JSON.parse(await file.text()));
                  });
              }}
            />
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {confirm && (
        <Modal
          sheet
          title="重新读取已保存数据"
          close={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            这会移除本机队列中的未保存修改，读取最新已保存数据；不会覆盖其他设备的修改。建议先导出未保存内容，之后可核对备份。
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="data-actions storage-recovery-actions">
            <button className="button" disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (await store.exportData()) {
                    await store.reload();
                    setConfirm(false);
                  }
                })
              }
            >
              导出备份后重新读取
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await store.reload();
                  setConfirm(false);
                })
              }
            >
              放弃未保存修改并重新读取
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
