import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic } from '../electron/files.js';

async function fixture(
  platform: string,
  run: (file: string, rename: typeof fs.rename) => Promise<void>,
) {
  const base = path.join(os.tmpdir(), '.agents');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'dayweave-atomic-'));
  const file = path.join(directory, 'data.json');
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const original = fs.rename;
  try {
    await writeFile(file, 'old');
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    await run(file, original);
  } finally {
    fs.rename = original;
    Object.defineProperty(process, 'platform', descriptor);
    await rm(directory, { recursive: true, force: true });
  }
}

test('atomic replacement retries temporary Windows locks while readers retain the old bytes', async () => {
  await fixture('win32', async (file, rename) => {
    const errors = ['EACCES', 'EPERM', 'EBUSY'];
    let calls = 0;
    fs.rename = async (from, to) => {
      const code = errors[calls++];
      if (code) {
        assert.equal(await readFile(file, 'utf8'), 'old');
        throw Object.assign(new Error('Temporarily locked'), { code });
      }
      return rename(from, to);
    };
    await writeAtomic(file, 'new');
    assert.equal(calls, 4);
    assert.equal(await readFile(file, 'utf8'), 'new');
  });
});

test('exhausted Windows replacement preserves the destination and synced temporary file', async () => {
  await fixture('win32', async (file) => {
    const failure = Object.assign(new Error('Still locked'), { code: 'EPERM' });
    let calls = 0;
    fs.rename = async () => {
      calls++;
      throw failure;
    };
    await assert.rejects(writeAtomic(file, 'new'), (error) => error === failure);
    assert.equal(calls, 10);
    assert.equal(await readFile(file, 'utf8'), 'old');
    assert.equal(await readFile(file + '.tmp', 'utf8'), 'new');
  });
});

test('unrelated Windows replacement failures preserve their original error', async () => {
  await fixture('win32', async (file) => {
    const failure = Object.assign(new Error('Disk failure'), { code: 'EIO' });
    let calls = 0;
    fs.rename = async () => {
      calls++;
      throw failure;
    };
    await assert.rejects(writeAtomic(file, 'new'), (error) => error === failure);
    assert.equal(calls, 1);
    assert.equal(await readFile(file, 'utf8'), 'old');
  });
});

test('POSIX replacement reports permission failures immediately', async () => {
  await fixture('darwin', async (file) => {
    const failure = Object.assign(new Error('Permission denied'), { code: 'EPERM' });
    let calls = 0;
    fs.rename = async () => {
      calls++;
      throw failure;
    };
    await assert.rejects(writeAtomic(file, 'new'), (error) => error === failure);
    assert.equal(calls, 1);
  });
});
