import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'dayweave-collector-'));
const executable = path.resolve(
  'native-bin',
  process.platform === 'win32' ? 'work-review-agent.exe' : 'work-review-agent',
);
let child;
try {
  execFileSync(
    executable,
    ['--data-dir', directory, 'init', '--name', 'Isolated paused collector'],
    { windowsHide: true },
  );
  execFileSync(executable, ['--data-dir', directory, 'config', '--set', 'enabled=false'], {
    windowsHide: true,
  });
  child = spawn(executable, ['--data-dir', directory, 'run', '--host-managed'], {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Collector exited ${code}: ${errors}`)),
    );
  });
  let paused = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      paused =
        JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8')).capture.state ===
        'paused';
    } catch {}
    if (paused) break;
    await delay(100);
  }
  assert.equal(paused, true, 'The isolated native collector must remain paused');
  child.stdin.end();
  let timer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Collector did not stop after host EOF')), 6000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const database = new DatabaseSync(path.join(directory, 'agent.db'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) total FROM events').get().total, 0);
  } finally {
    database.close();
  }
  console.log(
    JSON.stringify({
      collector: 'passed',
      paused: true,
      recordedEvents: 0,
      hostEofStopsChild: true,
    }),
  );
} finally {
  if (child?.exitCode === null) child.kill();
  assert.ok(path.resolve(directory).startsWith(path.resolve(base) + path.sep));
  await rm(directory, { recursive: true, force: true });
}
