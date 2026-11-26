const POLL_MS = 2000;
const MAX_BACKOFF_MS = 30000;

/**
 * One exchange at a time. Local changes, start/resume and explicit requests run at once; the
 * background poll backs off after failures so an offline device does not re-encrypt and resend
 * its whole pending state every two seconds.
 */
export class SyncScheduler {
  private active = false;
  private running = false;
  private pending = false;
  private failures = 0;
  private retryAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;

  /** `sync` resolves to false when the exchange failed. */
  constructor(private readonly sync: () => Promise<unknown>) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.failures = 0;
    this.retryAt = 0;
    this.poll = setInterval(() => {
      if (Date.now() >= this.retryAt) this.request();
    }, POLL_MS);
    this.request();
  }

  stop() {
    this.active = false;
    this.pending = false;
    clearTimeout(this.timer);
    clearInterval(this.poll);
    this.timer = undefined;
    this.poll = undefined;
  }

  request() {
    if (!this.active) return;
    this.pending = true;
    if (this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = false;
      this.running = true;
      void Promise.resolve()
        .then(() => this.sync())
        .then(
          (result) => result !== false,
          () => false,
        )
        .then((ok) => {
          this.failures = ok ? 0 : this.failures + 1;
          this.retryAt = ok
            ? 0
            : Date.now() + Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** this.failures);
        })
        .finally(() => {
          this.running = false;
          if (this.pending) this.request();
        });
    }, 100);
  }
}
