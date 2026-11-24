import { useEffect, useState } from 'react';
import { CalendarDays, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { store, useStore } from '../store';
import {
  eventTypes,
  feedLink,
  feedReminderMinutes,
  legacyFeedName,
  type CalendarFeed,
  type EventType,
} from '../event-model';

const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replaceAll('-', '');

/** Read-only ICS feeds that Google, Outlook and Apple calendars subscribe to. */
export function CalendarFeedSettings() {
  const feeds = useStore().data.settings.calendarFeeds ?? [];
  const [fallbackBase, setFallbackBase] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void window.clearlist?.sync
      ?.status()
      .then((status) => {
        const addresses = [...(status.endpoints ?? []), ...(status.addresses ?? [])];
        setFallbackBase(addresses.find((address) => address.startsWith('https:')) ?? '');
      })
      .catch(() => undefined);
  }, []);
  const save = async (change: (rows: CalendarFeed[]) => CalendarFeed[]) => {
    setError('');
    try {
      await store.transact((state) => {
        const rows = change(state.settings.calendarFeeds ?? []);
        const { calendarFeeds: _previous, ...settings } = state.settings;
        return {
          ...state,
          settings: rows.length ? { ...settings, calendarFeeds: rows } : settings,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const patch = (id: string, value: Partial<CalendarFeed>) =>
    save((rows) => rows.map((row) => (row.id === id ? { ...row, ...value } : row)));
  return (
    <section className="settings-section calendar-feeds">
      <h3>日历订阅</h3>
      {feeds.map((feed) => (
        <FeedRow
          key={feed.id}
          feed={feed}
          fallbackBase={fallbackBase}
          patch={(value) => patch(feed.id, value)}
          remove={() => save((rows) => rows.filter((row) => row.id !== feed.id))}
          onError={setError}
        />
      ))}
      <button
        type="button"
        className="button"
        onClick={() =>
          void save((rows) => [
            ...rows,
            {
              id: crypto.randomUUID(),
              name: rows.length ? `日历订阅 ${rows.length + 1}` : legacyFeedName,
              enabled: true,
              token: newToken(),
              types: [],
              ...(fallbackBase ? { baseUrl: fallbackBase.replace(/\/$/, '') } : {}),
            },
          ])
        }
      >
        <Plus size={15} /> 新建订阅
      </button>
      <p className="field-hint">
        在 Google「通过网址添加」、Outlook「从 Web 订阅」或
        Apple「新建日历订阅」粘贴链接。每条日程在开始前 {feedReminderMinutes.join(' 分钟和 ')}{' '}
        分钟提醒；学习休息参考时段到点提醒。外部日历可能使用自己的通知设置。
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function FeedRow({
  feed,
  fallbackBase,
  patch,
  remove,
  onError,
}: {
  feed: CalendarFeed;
  fallbackBase: string;
  patch: (value: Partial<CalendarFeed>) => Promise<void>;
  remove: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(feed.name);
  const [base, setBase] = useState(feed.baseUrl ?? fallbackBase);
  const [copied, setCopied] = useState(false);
  useEffect(() => setName(feed.name), [feed.name]);
  useEffect(() => setBase(feed.baseUrl ?? fallbackBase), [feed.baseUrl, fallbackBase]);
  const link = base ? feedLink(feed, base) : '';
  const toggleType = (type: EventType) =>
    patch({
      types: feed.types.includes(type)
        ? feed.types.filter((value) => value !== type)
        : [...feed.types, type],
    });
  return (
    <div className={`calendar-feed ${feed.enabled ? '' : 'disabled'}`}>
      <div className="calendar-feed-head">
        <CalendarDays size={17} aria-hidden="true" />
        <input
          aria-label="订阅名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== feed.name) void patch({ name: name.trim() });
            else setName(feed.name);
          }}
        />
        <label className="calendar-feed-switch">
          <input
            type="checkbox"
            aria-label={`启用 ${feed.name}`}
            checked={feed.enabled}
            onChange={(event) => void patch({ enabled: event.target.checked })}
          />
          启用
        </label>
      </div>
      <label>
        订阅内容
        <select
          aria-label="订阅内容"
          value={feed.content ?? 'events'}
          onChange={(event) =>
            void patch({ content: event.target.value as 'events' | 'reference' | 'combined' })
          }
        >
          <option value="events">实际日程</option>
          <option value="reference">学习休息参考（只补空白）</option>
          <option value="combined">实际日程与参考背景</option>
        </select>
      </label>
      <div className="calendar-feed-types" role="group" aria-label="包含的日程类型">
        <button
          type="button"
          aria-pressed={!feed.types.length}
          onClick={() => void patch({ types: [] })}
        >
          全部
        </button>
        {(Object.keys(eventTypes) as EventType[]).map((type) => (
          <button
            type="button"
            key={type}
            aria-pressed={feed.types.includes(type)}
            onClick={() => void toggleType(type)}
          >
            {eventTypes[type]}
          </button>
        ))}
      </div>
      <input
        aria-label="中心地址"
        value={base}
        placeholder="https://你的数据中心/dayweave"
        onChange={(event) => setBase(event.target.value.trim())}
        onBlur={() => {
          const value = base.replace(/\/$/, '');
          if (value && value !== feed.baseUrl) void patch({ baseUrl: value });
        }}
      />
      <div className="calendar-feed-link">
        <input
          aria-label="订阅链接"
          value={link}
          readOnly
          placeholder="填写中心地址后生成链接"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="button"
          disabled={!link || !feed.enabled}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              onError('无法写入剪贴板，请选中链接后复制');
            }
          }}
        >
          <Copy size={14} /> {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="calendar-feed-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            if (window.confirm(`重置后「${feed.name}」原链接失效，需要在外部日历中重新订阅。`))
              void patch({ token: newToken() });
          }}
        >
          <RefreshCw size={14} /> 重置链接
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            if (window.confirm(`删除「${feed.name}」后外部日历将无法再读取它。`)) void remove();
          }}
        >
          <Trash2 size={14} /> 删除
        </button>
      </div>
    </div>
  );
}
