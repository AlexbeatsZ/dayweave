import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { startHeadless, BackupRepository } from '../../electron/headless-runtime.js';

test('server storage API creates a consistent independent profile recovery and restores into a new directory', async () => {
  const parent = path.join(os.tmpdir(), '.agents');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'dayweave-recovery-'));
  const profile = path.join(root, 'profile');
  const runtime = await startHeadless({
    directory: profile,
    apiPort: 0,
    discovery: false,
    server: { version: 'test', appVersion: 'test', sourceCommit: 'test' },
    lifecycle: { backup: { schedule: '23:59' } },
  });
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(runtime.api.info.url + route, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${runtime.api.info.token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data;
  };
  try {
    await request('/tasks', { title: 'Recovery fixture' });
    runtime.usage.store.database.exec(
      "CREATE TABLE recovery_probe(value TEXT); INSERT INTO recovery_probe VALUES('committed WAL')",
    );
    const before = (await request('/server/storage')).backup.snapshots;
    await request('/server/storage', { action: 'backup', dryRun: true });
    assert.equal((await request('/server/storage')).backup.snapshots, before);
    const result = await request('/server/storage', { action: 'backup', dryRun: false });
    assert.equal(result.status, 'created');
    const repo = new BackupRepository(profile + '-backups');
    const restored = path.join(root, 'restored');
    await repo.restore(result.id, restored);
    const data = JSON.parse(await readFile(path.join(restored, 'data.json'), 'utf8'));
    assert(data.tasks.some((t: { title: string }) => t.title === 'Recovery fixture'));
    assert.equal(
      JSON.parse(await readFile(path.join(restored, 'sync.json'), 'utf8')).deviceId,
      runtime.sync.client.config.deviceId,
    );
    const db = new DatabaseSync(path.join(restored, 'usage.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT value FROM recovery_probe').get()!.value, 'committed WAL');
    } finally {
      db.close();
    }
    assert(!(await readdir(restored)).includes('backups'));
    await assert.rejects(repo.restore(result.id, restored), { code: 'EEXIST' });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
