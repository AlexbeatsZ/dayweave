import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { store, useStore } from '../store';
import { usePhone } from '../phone/usePhone';
import { exportText } from '../files';
import { exportEventCalendar } from '../calendar-export';

export function CalendarExport({ close }: { close: () => void }) {
  const { data } = useStore();
  const phone = usePhone();
  const [base, setBase] = useState(data.settings.calendarFeed?.baseUrl ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const feed = data.settings.calendarFeed;
  useEffect(() => {
    if (feed?.baseUrl) return;
    void window.clearlist?.sync
      ?.status()
      .then((status) => {
        const addresses = [...(status.endpoints ?? []), ...(status.addresses ?? [])];
        setBase(addresses.find((address) => address.startsWith('https:')) ?? addresses[0] ?? '');
      })
      .catch((cause) => setError(String(cause)));
  }, []);
  const link = feed?.enabled && base ? `${base.replace(/\/$/, '')}/calendar/${feed.token}.ics` : '';
  const change = async (enabled: boolean, rotate = false) => {
    setBusy(true);
    setError('');
    try {
      await store.transact((state) => ({
        ...state,
        settings: {
          ...state.settings,
          calendarFeed: {
            ...state.settings.calendarFeed,
            enabled,
            token:
              !rotate && state.settings.calendarFeed
                ? state.settings.calendarFeed.token
                : (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', ''),
          },
        },
      }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const persistBase = async () => {
    if (!feed || !base || feed.baseUrl === base.replace(/\/$/, '')) return;
    await store.transact((state) =>
      state.settings.calendarFeed
        ? {
            ...state,
            settings: {
              ...state.settings,
              calendarFeed: { ...state.settings.calendarFeed, baseUrl: base.replace(/\/$/, '') },
            },
          }
        : state,
    );
  };
  return (
    <Modal title="导出到日历" close={() => !busy && close()} sheet={phone}>
      <div className="event-form">
        <p>
          将 Dayweave 日程订阅到 Google、Microsoft / Outlook 或 Apple
          日历，后续更改由日历服务按其刷新周期读取。
        </p>
        <label className="event-checkbox">
          <input
            type="checkbox"
            aria-label="开启日程订阅"
            disabled={busy}
            checked={feed?.enabled ?? false}
            onChange={(event) => void change(event.target.checked)}
          />
          开启日程订阅
        </label>
        {feed?.enabled && (
          <>
            <label>
              数据中心 HTTPS 地址
              <input
                aria-label="日历发布地址"
                value={base}
                onChange={(event) => setBase(event.target.value.trim())}
                placeholder="https://你的数据中心/dayweave"
              />
            </label>
            {link && (
              <label>
                日程订阅链接
                <input
                  aria-label="日程订阅链接"
                  value={link}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
            <button
              className="button"
              disabled={!link}
              onClick={async () => {
                try {
                  await persistBase();
                  await navigator.clipboard.writeText(link);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : '请选中订阅链接后复制');
                }
              }}
            >
              复制订阅链接
            </button>
            <p className="field-hint">
              链接包含此日历的访问密钥。持有链接即可读取日程，适合保存在你自己的日历账户中。关闭后中心停止提供内容，重置链接会使原链接失效。
            </p>
            <details>
              <summary>添加到日历</summary>
              <p>
                Google 日历使用“通过网址添加”。Outlook 使用“订阅 Web 日历”。Apple
                日历使用“新建日历订阅”。选择专用的 Dayweave 日历即可。
              </p>
              <p>
                多时间段合并为首段开始至末段结束，完整时间段写入描述。已生成的单次调整、全天日程和取消状态随同更新。
              </p>
            </details>
            <button className="button" disabled={busy} onClick={() => void change(true, true)}>
              重置订阅链接
            </button>
          </>
        )}
        <button
          className="button"
          onClick={() =>
            void exportText(
              'Dayweave-events.ics',
              exportEventCalendar(data.calendarEvents),
              'text/calendar',
            ).catch((cause) => setError(String(cause)))
          }
        >
          下载 ICS 日程文件
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            className="button"
            onClick={async () => {
              try {
                await persistBase();
                close();
              } catch (cause) {
                setError(String(cause));
              }
            }}
          >
            完成
          </button>
        </footer>
      </div>
    </Modal>
  );
}
