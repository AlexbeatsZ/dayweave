import path from 'node:path';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { BackupRepository, lifecyclePolicy, pruneUpgrades } from '@alexbeatsz/file-sync-core';
import { writeAtomic } from './files.js';
import type { StateService } from './state-service.js';
import type { DesktopSync } from './sync.js';
import type { DesktopUsage } from './usage.js';

export class ServerLifecycle {
  readonly policy;
  readonly repository: BackupRepository;
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private last: { at: number; ok: boolean; error?: string } | null = null;
  private lastDay = '';
  constructor(
    readonly profile: string,
    configuration: unknown,
    readonly service: StateService,
    readonly sync: DesktopSync,
    readonly usage: DesktopUsage,
  ) {
    this.policy = lifecyclePolicy(configuration);
    this.directory = path.resolve(
      (configuration as any)?.backup?.directory ?? profile + '-backups',
    );
    const relatives = [
      path.relative(profile, this.directory),
      path.relative(this.directory, profile),
    ];
    if (
      relatives.some(
        (r) => !r || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r)),
      )
    )
      throw new Error('Recovery backups must be separate from the live profile');
    this.repository = new BackupRepository(this.directory, this.policy.backup);
  }
  async start() {
    try {
      const state = JSON.parse(await readFile(path.join(this.profile, 'lifecycle.json'), 'utf8'));
      this.last = state.last;
      this.lastDay = state.lastDay ?? '';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    this.timer = setInterval(() => {
      const now = new Date(),
        day = now.toLocaleDateString('en-CA');
      if (
        this.closing ||
        !this.policy.backup.enabled ||
        day === this.lastDay ||
        now.toTimeString().slice(0, 5) < this.policy.backup.schedule
      )
        return;
      // Set before enqueueing so a slow first backup cannot accumulate scheduled jobs.
      this.lastDay = day;
      void this.run('backup', false).catch(() => {
        console.error('Dayweave backup failed; inspect /server/storage');
      });
    }, 60000);
    this.timer.unref();
  }
  async status() {
    let currentBytes = 0;
    for (const name of ['data.json', 'sync.json', 'usage.db', 'usage.db-wal']) {
      try {
        currentBytes += (await stat(path.join(this.profile, name))).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    return {
      policy: this.policy,
      currentBytes,
      historyBytes: 0,
      backup: await this.repository.status(),
      upgrades: await pruneUpgrades(
        this.policy.backup.upgrade.directory ?? this.profile + '-upgrades',
        this.policy.backup.upgrade,
      ),
      last: this.last,
    };
  }
  private async createBackup() {
    const staging = path.join(this.directory, 'staging');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      await this.sync.client.exclusive(() =>
        this.service.withSnapshot(async (snapshot) => {
          await writeFile(path.join(staging, 'data.json'), JSON.stringify(snapshot.state), {
            mode: 0o600,
          });
          await writeFile(
            path.join(staging, 'sync.json'),
            JSON.stringify(this.sync.client.config),
            { mode: 0o600 },
          );
        }),
      );
      // SQLite Online Backup API includes committed WAL contents, never copy a live DB/WAL pair.
      const database = path.join(staging, 'usage.db');
      await backup(this.usage.store.database, database);
      const check = new DatabaseSync(database, { readOnly: true });
      try {
        const result = check.prepare('PRAGMA integrity_check').all();
        if (result.length !== 1 || Object.values(result[0])[0] !== 'ok')
          throw new Error('SQLite backup integrity check failed');
      } finally {
        check.close();
      }
      const sources = {
        'data.json': path.join(staging, 'data.json'),
        'sync.json': path.join(staging, 'sync.json'),
        'api.json': path.join(this.profile, 'api.json'),
        'usage.db': database,
      };
      const result = await this.repository.snapshot(sources);
      const rotation = await this.repository.prune({ dryRun: false });
      if (rotation.overCapacity) throw new Error('backup_capacity_exceeded');
      return { ...result, rotation };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  run(action: string, dryRun = true): Promise<unknown> {
    if (!['backup', 'cleanup', 'status'].includes(action))
      return Promise.reject(new Error('Invalid storage action'));
    const operation = this.queue.then(async () => {
      if (this.closing) throw new Error('Server lifecycle is closing');
      try {
        const result =
          action === 'status'
            ? await this.status()
            : dryRun
              ? await this.repository.prune({ dryRun: true })
              : await this.createBackup();
        if (action !== 'status')
          await pruneUpgrades(
            this.policy.backup.upgrade.directory ?? this.profile + '-upgrades',
            this.policy.backup.upgrade,
            { dryRun },
          );
        if (action !== 'status' && !dryRun) {
          this.last = { at: Date.now(), ok: true };
          this.lastDay = new Date().toLocaleDateString('en-CA');
          await writeAtomic(
            path.join(this.profile, 'lifecycle.json'),
            JSON.stringify({ last: this.last, lastDay: this.lastDay }),
          );
        }
        return result;
      } catch (e) {
        this.last = {
          at: Date.now(),
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
        await writeAtomic(
          path.join(this.profile, 'lifecycle.json'),
          JSON.stringify({ last: this.last, lastDay: this.lastDay }),
        );
        throw e;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.queue;
  }
}
