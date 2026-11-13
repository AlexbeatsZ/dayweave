import { emptyState, stateSchema, type AppState } from './model.js';

/**
 * Named-file storage behind the repository. Each platform provides only the transport:
 * desktop files, Android app-private files or browser localStorage.
 */
export interface JsonFiles {
  /** `null` means absent; any other read failure must throw. */
  read(name: string): Promise<string | null>;
  /** Replace one file atomically. */
  write(name: string, content: string): Promise<void>;
  /** Write only when absent. Defaults to read followed by write. */
  preserve?(name: string, content: string): Promise<void>;
  /** Save data.json after keeping its current bytes as data.backup.json, without returning them. */
  replace?(content: string, state: AppState): Promise<void>;
}

const MAX_BYTES = 50 * 1024 * 1024;
const PRIMARY = 'data.json';
const BACKUP = 'data.backup.json';

/**
 * The single load/backup/recovery/restore policy for saved state on every platform.
 * Storage corruption is recoverable from the previous snapshot and never becomes empty state.
 */
export class JsonRepository {
  private loaded = false;
  /** Bytes currently in data.json, once known valid: the next backup without rereading disk. */
  private current: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly files: JsonFiles,
    private readonly indent?: number,
  ) {}
  private serialize(state: AppState) {
    return JSON.stringify(state, null, this.indent);
  }
  private parse(raw: string) {
    if (raw.length > MAX_BYTES) throw new Error('数据文件超过 50 MB 限制');
    const input = JSON.parse(raw);
    return { input, state: stateSchema.parse(input) };
  }
  private async preserve(name: string, content: string) {
    if (this.files.preserve) await this.files.preserve(name, content);
    else if ((await this.files.read(name)) === null) await this.files.write(name, content);
  }
  async load(): Promise<{ state: AppState; recovered: boolean }> {
    const raw = await this.files.read(PRIMARY);
    let parsed: ReturnType<JsonRepository['parse']> | undefined, failure: unknown;
    try {
      if (raw !== null) parsed = this.parse(raw);
    } catch (error) {
      failure = error;
    }
    if (parsed && raw !== null) {
      // Migration sources are kept once, before any later save rewrites the primary file.
      if (!('calendarEvents' in parsed.input))
        await this.preserve('data.before-arrangements.json', raw);
      if (parsed.input.version === 1) await this.preserve('data.before-task-v2.json', raw);
      this.current = raw;
      this.loaded = true;
      return { state: parsed.state, recovered: false };
    }
    const backup = await this.files.read(BACKUP);
    if (raw === null && backup === null) {
      this.current = null;
      this.loaded = true;
      return { state: emptyState(), recovered: false };
    }
    let state: AppState;
    try {
      state = this.parse(backup ?? 'null').state;
    } catch {
      throw new Error('数据文件无法读取，且没有有效备份。请保留原文件并从导出的备份恢复。', {
        cause: failure,
      });
    }
    if (raw !== null) await this.files.write(`data.corrupt-${Date.now()}.json`, raw);
    const text = this.serialize(state);
    await this.files.write(PRIMARY, text);
    this.current = text;
    this.loaded = true;
    return { state, recovered: true };
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(run);
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  save(value: unknown): Promise<void> {
    const state = stateSchema.parse(value);
    if (!this.loaded) return Promise.reject(new Error('尚未成功加载数据，拒绝覆盖文件'));
    return this.enqueue(async () => {
      const text = this.serialize(state);
      if (this.files.replace) await this.files.replace(text, state);
      else {
        if (this.current !== null) await this.files.write(BACKUP, this.current);
        await this.files.write(PRIMARY, text);
      }
      this.current = text;
    });
  }
  restore(value: unknown) {
    if (this.loaded) return Promise.reject(new Error('数据已加载，请使用合并导入'));
    const state = stateSchema.parse(value);
    return this.enqueue(async () => {
      for (const name of [PRIMARY, BACKUP]) {
        const raw = await this.files.read(name);
        if (raw !== null) await this.files.write(`${name}.before-restore-${Date.now()}`, raw);
      }
      const text = this.serialize(state);
      await this.files.write(PRIMARY, text);
      this.current = text;
      this.loaded = true;
      return { state, recovered: true };
    });
  }
  async flush() {
    await this.queue;
  }
}

/** Browser preview storage: the same file names mapped onto the original localStorage keys. */
export function localStorageFiles(key: string): JsonFiles {
  const name = (file: string) =>
    key +
    file
      .slice('data'.length)
      .replaceAll('.json', '')
      .replace(/-(\d+)$/, '.$1');
  return {
    read: async (file) => localStorage.getItem(name(file)),
    write: async (file, content) => localStorage.setItem(name(file), content),
  };
}
