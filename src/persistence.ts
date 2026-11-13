import { emptyState, stateSchema, type AppState } from './model.js';

export interface JsonFiles {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
}

export class JsonRepository {
  private loaded = false;
  private current: AppState | null = null;
  constructor(private files: JsonFiles) {}
  async load() {
    const raw = await this.files.read('data.json');
    let state: AppState;
    try {
      if (raw === null) throw new Error('Missing primary');
      state = stateSchema.parse(JSON.parse(raw));
      if (
        !('calendarEvents' in JSON.parse(raw)) &&
        (await this.files.read('data.before-arrangements.json')) === null
      )
        await this.files.write('data.before-arrangements.json', raw);
      if (
        JSON.parse(raw).version === 1 &&
        (await this.files.read('data.before-task-v2.json')) === null
      )
        await this.files.write('data.before-task-v2.json', raw);
      this.loaded = true;
      this.current = state;
      return { state, recovered: false };
    } catch {
      const backup = await this.files.read('data.backup.json');
      if (raw === null && backup === null) {
        state = emptyState();
        this.loaded = true;
        this.current = state;
        return { state, recovered: false };
      }
      try {
        state = stateSchema.parse(JSON.parse(backup ?? 'null'));
      } catch {
        throw new Error('数据和备份无法读取，请选择有效的 JSON 备份恢复。');
      }
      if (raw !== null) await this.files.write(`data.corrupt-${Date.now()}.json`, raw);
      await this.files.write('data.json', JSON.stringify(state));
      this.loaded = true;
      this.current = state;
      return { state, recovered: true };
    }
  }
  async save(value: unknown) {
    if (!this.loaded) throw new Error('尚未成功读取数据，拒绝覆盖');
    const next = stateSchema.parse(value);
    if (this.current) await this.files.write('data.backup.json', JSON.stringify(this.current));
    await this.files.write('data.json', JSON.stringify(next));
    this.current = next;
  }
  async restore(value: unknown) {
    if (this.loaded) throw new Error('请使用合并导入');
    const state = stateSchema.parse(value);
    for (const name of ['data.json', 'data.backup.json']) {
      const raw = await this.files.read(name);
      if (raw !== null) await this.files.write(`${name}.before-restore-${Date.now()}`, raw);
    }
    await this.files.write('data.json', JSON.stringify(state));
    this.current = state;
    this.loaded = true;
    return { state, recovered: true };
  }
}
