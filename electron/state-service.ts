import { setTimeZone } from '../src/timezone.js';
import { randomUUID } from 'node:crypto';
import { stateSchema, type AppState } from '../src/model.js';
import { applyDelta, type StateDelta } from '../src/state-delta.js';
import { FileStore } from './storage.js';

export type StateSnapshot = { state: AppState; revision: string; path: string; recovered: boolean };
export class StateService {
  private current?: StateSnapshot;
  private loaded?: Promise<StateSnapshot>;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(value: StateSnapshot) => void>();
  private counter = 0;
  private session = randomUUID();
  constructor(readonly storage: FileStore) {}
  private revision() {
    return `${this.session}:${++this.counter}`;
  }
  async snapshot() {
    this.loaded ??= this.storage
      .load()
      .then((data) => (this.current = { ...data, revision: this.revision() }));
    await this.loaded;
    setTimeZone(this.current!.state.settings.timeZone);
    return structuredClone(this.current!);
  }
  subscribe(callback: (value: StateSnapshot) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  mutate(transform: (state: AppState) => AppState, expected?: string): Promise<StateSnapshot> {
    const operation = this.queue.then(async () => {
      const snapshot = await this.snapshot();
      if (expected && expected !== snapshot.revision)
        throw Object.assign(new Error('Revision does not match; reload before retrying'), {
          status: 409,
        });
      const next = stateSchema.parse(transform(structuredClone(snapshot.state)));
      if (JSON.stringify(next) === JSON.stringify(snapshot.state)) return snapshot;
      await this.storage.save(next);
      this.current = { ...snapshot, state: next, revision: this.revision() };
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
  async restore(value: unknown) {
    const restored = await this.storage.restore(value);
    this.current = { ...restored, revision: this.revision() };
    this.loaded = Promise.resolve(this.current);
    return structuredClone(this.current);
  }
  async flush() {
    await this.queue;
    await this.storage.flush();
  }
}
