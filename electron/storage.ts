import { open, readFile, rename, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { stateSchema, emptyState, type AppState } from '../src/model.js';

export class FileStore {
  private queue: Promise<void> = Promise.resolve();
  private canWrite = false;
  constructor(readonly directory: string) {}
  get file() {
    return path.join(this.directory, 'data.json');
  }
  get backup() {
    return path.join(this.directory, 'data.backup.json');
  }
  private async read(file: string): Promise<AppState> {
    const info = await stat(file);
    if (info.size > 50 * 1024 * 1024) throw new Error('数据文件超过 50 MB 限制');
    const raw = await readFile(file, 'utf8');
    const input = JSON.parse(raw);
    const state = stateSchema.parse(input);
    if (input.version === 1) {
      try {
        const handle = await open(
          path.join(this.directory, 'data.before-task-v2.json'),
          'wx',
          0o600,
        );
        try {
          await handle.writeFile(raw, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return state;
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const state = await this.read(this.file);
      this.canWrite = true;
      return { state, recovered: false, path: this.file };
    } catch (error) {
      const absent = (error as NodeJS.ErrnoException).code === 'ENOENT';
      try {
        const state = await this.read(this.backup);
        if (!absent)
          await copyFile(this.file, path.join(this.directory, `data.corrupt-${Date.now()}.json`));
        await this.atomic(this.file, state);
        this.canWrite = true;
        return { state, recovered: true, path: this.file };
      } catch (backupError) {
        if (absent && (backupError as NodeJS.ErrnoException).code === 'ENOENT') {
          this.canWrite = true;
          return { state: emptyState(), recovered: false, path: this.file };
        }
        throw new Error('数据文件无法读取，且没有有效备份。请保留原文件并从导出的备份恢复。', {
          cause: error,
        });
      }
    }
  }
  private async atomic(file: string, data: AppState) {
    const temp = `${file}.tmp`;
    const handle = await open(temp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  }
  save(value: unknown): Promise<void> {
    const data = stateSchema.parse(value);
    if (!this.canWrite) return Promise.reject(new Error('尚未成功加载数据，拒绝覆盖文件'));
    const operation = this.queue.then(async () => {
      try {
        const previous = await this.read(this.file);
        await this.atomic(this.backup, previous);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await this.atomic(this.file, data);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async flush() {
    await this.queue;
  }
  async restore(value: unknown) {
    if (this.canWrite) throw new Error('数据已加载，请使用合并导入');
    const state = stateSchema.parse(value);
    await mkdir(this.directory, { recursive: true });
    for (const file of [this.file, this.backup]) {
      try {
        await copyFile(file, `${file}.before-restore-${Date.now()}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await this.atomic(this.file, state);
    this.canWrite = true;
    return { state, recovered: true, path: this.file };
  }
}
