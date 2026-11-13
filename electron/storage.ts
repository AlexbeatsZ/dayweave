import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { JsonRepository } from '../src/persistence.js';
import { directoryFiles } from './files.js';

/** Desktop and server profile storage: the shared repository over atomic profile files. */
export class FileStore {
  private readonly repository: JsonRepository;
  constructor(readonly directory: string) {
    this.repository = new JsonRepository(directoryFiles(directory), 2);
  }
  get file() {
    return path.join(this.directory, 'data.json');
  }
  get backup() {
    return path.join(this.directory, 'data.backup.json');
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    return { ...(await this.repository.load()), path: this.file };
  }
  save(value: unknown) {
    return this.repository.save(value);
  }
  flush() {
    return this.repository.flush();
  }
  async restore(value: unknown) {
    await mkdir(this.directory, { recursive: true });
    return { ...(await this.repository.restore(value)), path: this.file };
  }
}
