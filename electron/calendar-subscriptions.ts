import type { StateService } from './state-service.js';
import { previewCalendar, applyCalendarImport } from '../src/calendar-import.js';
import { shiftDay, zoneDateKey } from '../src/timezone.js';

/** The elected hub owns network polling. Requests run outside the state write queue. */
export class CalendarSubscriptions {
  private pending?: Promise<void>;
  private controller?: AbortController;
  private closed = false;
  private attempted = new Map<string, number>();
  constructor(
    private service: StateService,
    private request: typeof fetch = fetch,
  ) {}
  refresh() {
    this.pending ??= this.run().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async run() {
    const snapshot = await this.service.snapshot();
    for (const source of snapshot.state.calendarSubscriptions) {
      if (
        this.closed ||
        !source.enabled ||
        Date.now() - Math.max(source.checkedAt, this.attempted.get(source.id) ?? 0) < 15 * 60000
      )
        continue;
      this.attempted.set(source.id, Date.now());
      const controller = new AbortController();
      this.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        let target = source.url.replace(/^webcal:/i, 'https:');
        let response: Response | undefined;
        for (let redirect = 0; redirect <= 5; redirect++) {
          response = await this.request(target, {
            signal: controller.signal,
            headers: { Accept: 'text/calendar' },
            redirect: 'manual',
          });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          if (!location) break;
          const next = new URL(location, target);
          if (next.protocol !== 'https:' || next.username || next.password)
            throw new Error('日历订阅重定向地址必须使用 HTTPS');
          await response.body?.cancel();
          target = next.toString();
        }
        if (!response?.ok) throw new Error(`日历订阅返回 HTTP ${response?.status ?? 502}`);
        if (Number(response.headers.get('content-length') ?? 0) > 10 * 1024 * 1024)
          throw new Error('日历超过 10 MB');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('日历响应为空');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('日历超过 10 MB');
          }
          chunks.push(value);
        }
        const today = zoneDateKey(Date.now(), source.timeZone);
        const preview = previewCalendar(
          Buffer.concat(chunks).toString('utf8'),
          source,
          shiftDay(today, -366),
          shiftDay(today, 366),
        );
        if (this.closed) return;
        await this.service.mutate((state) => {
          const current = state.calendarSubscriptions.find((row) => row.id === source.id);
          return current?.enabled && current.updatedAt === source.updatedAt
            ? applyCalendarImport(state, preview)
            : state;
        });
      } catch (error) {
        if (this.closed) return;
        // Transport errors must never persist a secret subscription URL in a status message.
        const message =
          error instanceof Error && /^(日历|此日历)/.test(error.message)
            ? error.message.slice(0, 1000)
            : '日历订阅读取失败，请检查订阅地址、共享权限或网络连接';
        await this.service.mutate((state) => ({
          ...state,
          calendarSubscriptions: state.calendarSubscriptions.map((row) =>
            row.id === source.id && row.updatedAt === source.updatedAt
              ? { ...row, error: message }
              : row,
          ),
        }));
      } finally {
        clearTimeout(timeout);
        this.controller = undefined;
      }
    }
  }
  async close() {
    this.closed = true;
    this.controller?.abort();
    await this.pending;
  }
}
