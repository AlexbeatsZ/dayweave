import { useState } from 'react';
import { Modal } from './Modal';
import { store, useStore } from '../store';
import { usePhone } from '../phone/usePhone';
import { calendarSubscriptionSchema, type CalendarSubscription } from '../event-model';
import {
  previewCalendar,
  applyCalendarImport,
  type CalendarImportPreview,
} from '../calendar-import';
import { pickText } from '../files';
import { shiftDay, zoneDateKey } from '../timezone';

export function CalendarSources({ close }: { close: () => void }) {
  const { data } = useStore();
  const phone = usePhone();
  const [provider, setProvider] = useState<CalendarSubscription['provider']>('google');
  const [name, setName] = useState(''),
    [url, setUrl] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CalendarImportPreview>();
  const [message, setMessage] = useState('');
  const update = async (action: () => Promise<unknown>) => {
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
    <Modal title="日历导入与订阅" close={() => !busy && close()} sheet={phone}>
      <div className="event-form">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void update(async () => {
              const source = calendarSubscriptionSchema.parse({
                id: crypto.randomUUID(),
                provider,
                name:
                  name ||
                  {
                    google: 'Google 日历',
                    microsoft: 'Microsoft 日历',
                    apple: 'Apple 日历',
                    ics: '日历订阅',
                  }[provider],
                url: url.trim(),
                timeZone: data.schedule.timeZone,
                enabled: true,
                updatedAt: new Date().toISOString(),
              });
              await store.transact((state) => ({
                ...state,
                calendarSubscriptions: [...state.calendarSubscriptions, source],
              }));
              setUrl('');
              setName('');
              setMessage('订阅已保存，连接数据中心后自动读取日程');
            });
          }}
        >
          <label>
            来源
            <select
              aria-label="日历来源"
              value={provider}
              onChange={(event) => setProvider(event.target.value as typeof provider)}
            >
              <option value="google">Google 日历</option>
              <option value="microsoft">Microsoft / Outlook 日历</option>
              <option value="apple">Apple / iCloud 日历</option>
              <option value="ics">其他 iCalendar 日历</option>
            </select>
          </label>
          <label>
            名称
            <input
              aria-label="订阅名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            日历订阅地址
            <input
              aria-label="日历订阅地址"
              type="text"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoComplete="off"
              placeholder="https://… 或 webcal://…"
            />
          </label>
          <p className="field-hint">
            数据中心每 15
            分钟将订阅内容导入日程。订阅地址随加密业务同步和备份保存，请按私密信息管理。
          </p>
          <details>
            <summary>获取订阅地址</summary>
            <p>
              Google 日历可在日历设置的“整合日历”中获取 iCal 地址。Outlook
              可在日历设置中发布日历并复制 ICS 地址。iCloud 可从共享日历获取公开订阅链接。
            </p>
            <p>此入口读取订阅内容。关闭订阅后，已导入的日程继续保留。</p>
          </details>
          <button className="button primary" disabled={busy}>
            添加订阅
          </button>
        </form>
        {data.calendarSubscriptions.map((source) => (
          <article className="calendar-source" key={source.id}>
            <strong>{source.name}</strong>
            <p>
              {source.checkedAt
                ? `上次读取 ${new Date(source.checkedAt).toLocaleString()}`
                : '等待数据中心首次读取'}
            </p>
            {source.error && <p role="alert">{source.error}</p>}
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void update(async () => {
                  await store.transact((state) => ({
                    ...state,
                    calendarSubscriptions: state.calendarSubscriptions.map((row) =>
                      row.id === source.id
                        ? {
                            ...row,
                            enabled: !row.enabled,
                            checkedAt: 0,
                            updatedAt: new Date().toISOString(),
                          }
                        : row,
                    ),
                  }));
                })
              }
            >
              {source.enabled ? '暂停订阅' : '恢复订阅'}
            </button>
          </article>
        ))}
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void update(async () => {
              const text = await pickText();
              if (text === null) return;
              const today = zoneDateKey(Date.now(), data.schedule.timeZone);
              setPreview(
                previewCalendar(
                  text,
                  { id: 'manual-ics', timeZone: data.schedule.timeZone },
                  shiftDay(today, -366),
                  shiftDay(today, 366),
                ),
              );
            })
          }
        >
          从 ICS 文件导入日程
        </button>
        {preview && (
          <section>
            <h3>预览导入</h3>
            <p>
              {preview.items.filter((item) => item.event).length} 条日程 · {preview.from} 至{' '}
              {preview.through}
            </p>
            <ul>
              {preview.items
                .filter((item) => item.event)
                .slice(0, 8)
                .map((item) => (
                  <li key={`${item.uid}:${item.original}`}>
                    {item.event!.date} · {item.event!.title}
                  </li>
                ))}
            </ul>
            {preview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <button className="button" disabled={busy} onClick={() => setPreview(undefined)}>
              取消导入
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void update(async () => {
                  await store.transact((state) => applyCalendarImport(state, preview));
                  setPreview(undefined);
                  setMessage('日程已导入');
                })
              }
            >
              确认导入日程
            </button>
          </section>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="form-error">
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
