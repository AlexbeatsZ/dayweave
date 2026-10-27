export class SyncScheduler {
  private active = false;
  private running = false;
  private pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;

  constructor(private readonly sync: () => Promise<unknown>) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.poll = setInterval(() => this.request(), 2000);
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
        .catch(() => {})
        .finally(() => {
          this.running = false;
          if (this.pending) this.request();
        });
    }, 100);
  }
}
