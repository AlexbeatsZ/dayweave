import { setTimeZone } from '../src/timezone.js';
import { randomUUID } from 'node:crypto';
import { stateSchema, type AppState } from '../src/model.js';
import { applyDelta, type StateDelta } from '../src/state-delta.js';
import { finishDueTimer } from '../src/timelog/domain.js';
import { FileStore } from './storage.js';

export type StateSnapshot = { state: AppState; revision: string; path: string; recovered: boolean };
export class StateService {
  private current?: StateSnapshot;
  private loaded?: Promise<StateSnapshot>;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(value: StateSnapshot) => void>();
  private counter = 0;
  private session = randomUUID();
  private deadline?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(readonly storage: FileStore) {}
  private revision() {
    return `${this.session}:${++this.counter}`;
  }
  private async load() {
    this.loaded ??= this.storage
      .load()
      .then(async (data) => {
        const timelog = finishDueTimer(data.state.timelog);
        const state = timelog === data.state.timelog ? data.state : { ...data.state, timelog };
        if (state !== data.state) await this.storage.save(state);
        this.current = { ...data, state, revision: this.revision() };
        this.scheduleDeadline();
        return this.current;
      })
      .catch((error) => {
        this.loaded = undefined;
        throw error;
      });
    await this.loaded;
    setTimeZone(this.current!.state.settings.timeZone);
  }
  async snapshot() {
    await this.load();
    if (finishDueTimer(this.current!.state.timelog) !== this.current!.state.timelog)
      return this.mutate((state) => state);
    return structuredClone(this.current!);
  }
  private scheduleDeadline() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
    const timer = this.current?.state.timelog.timer;
    if (this.disposed || timer?.runningSince == null || timer.plannedEndAt == null) return;
    this.deadline = setTimeout(
      () => {
        this.deadline = undefined;
        void this.mutate((state) => state).catch(() => {
          // Preserve the open timer if persistence fails; the next read/write retries it.
        });
      },
      Math.min(2_147_483_647, Math.max(0, timer.plannedEndAt - Date.now())),
    );
    this.deadline.unref();
  }
  subscribe(callback: (value: StateSnapshot) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  mutate(transform: (state: AppState) => AppState, expected?: string): Promise<StateSnapshot> {
    const operation = this.queue.then(async () => {
      await this.load();
      const snapshot = structuredClone(this.current!);
      if (expected && expected !== snapshot.revision)
        throw Object.assign(new Error('Revision does not match; reload before retrying'), {
          status: 409,
        });
      const state = transform(structuredClone(snapshot.state));
      const next = stateSchema.parse({ ...state, timelog: finishDueTimer(state.timelog) });
      if (JSON.stringify(next) === JSON.stringify(snapshot.state)) {
        this.scheduleDeadline();
        return snapshot;
      }
      await this.storage.save(next);
      this.current = { ...snapshot, state: next, revision: this.revision() };
      this.scheduleDeadline();
      const result = structuredClone(this.current);
      for (const listener of this.listeners) listener(structuredClone(result));
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  patch(delta: StateDelta) {
    return this.mutate((state) => applyDelta(state, delta));
  }
  restore(value: unknown) {
    const state = stateSchema.parse(value);
    const operation = this.queue.then(async () => {
      await this.loaded?.catch(() => {});
      const restored = await this.storage.restore({
        ...state,
        timelog: finishDueTimer(state.timelog),
      });
      this.current = { ...restored, revision: this.revision() };
      this.loaded = Promise.resolve(this.current);
      setTimeZone(this.current.state.settings.timeZone);
      this.scheduleDeadline();
      const result = structuredClone(this.current);
      for (const listener of this.listeners) listener(structuredClone(result));
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async flush() {
    await this.queue;
    await this.storage.flush();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.listeners.clear();
  }
}
