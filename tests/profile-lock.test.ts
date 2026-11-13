import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lockProfile } from '../electron/profile-lock.js';

async function profile(run: (directory: string, lock: string) => Promise<void>) {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-lock-'));
  try {
    await run(directory, path.join(directory, 'owner.lock'));
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
}
const preserved = async (directory: string) =>
  (await readdir(directory)).filter((name) => name.startsWith('owner.lock.stale-'));

test('a lock written before this boot is stale even when its PID is alive again', () =>
  profile(async (directory, lock) => {
    const old = JSON.stringify({ pid: process.pid, nonce: 'before-reboot' });
    await writeFile(lock, old);
    const beforeBoot = (Date.now() - os.uptime() * 1000 - 3600_000) / 1000;
    await utimes(lock, beforeBoot, beforeBoot);
    const unlock = await lockProfile(directory);
    const [stale] = await preserved(directory);
    assert.equal(await readFile(path.join(directory, stale), 'utf8'), old);
    await unlock();
  }));

test('an empty lock left by a crash is preserved and replaced after the writing grace', () =>
  profile(async (directory, lock) => {
    await writeFile(lock, '');
    const earlier = (Date.now() - 60_000) / 1000;
    await utimes(lock, earlier, earlier);
    const unlock = await lockProfile(directory);
    assert.equal((await preserved(directory)).length, 1);
    assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, process.pid);
    await unlock();
    assert.equal((await readdir(directory)).includes('owner.lock'), false);
  }));

test('a live owner from this boot keeps the profile', () =>
  profile(async (directory, lock) => {
    const live = JSON.stringify({ pid: process.pid, nonce: 'running-desktop' });
    await writeFile(lock, live);
    await assert.rejects(lockProfile(directory), /已由运行中的 Dayweave 使用/);
    assert.equal(await readFile(lock, 'utf8'), live);
    assert.deepEqual(await preserved(directory), []);
  }));
