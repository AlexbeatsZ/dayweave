import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'dayweave-headless-'));
const env = { ...process.env, DAYWEAVE_DATA_DIR: directory, DAYWEAVE_API_PORT: '0' };
const child = spawn(process.execPath, ['release/Dayweave-AI-tools/headless.mjs'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
try {
  let info;
  for (let i = 0; i < 50; i++) {
    try {
      info = JSON.parse(await readFile(path.join(directory, 'api.json'), 'utf8'));
      break;
    } catch {}
    if (child.exitCode !== null) throw new Error(stderr);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(info, 'Headless API did not start');
  const request = async (method, endpoint, body) => {
    const response = await fetch(info.url + endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${info.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const { data: task } = await request('POST', '/tasks', { title: 'Headless integration' });
  assert.equal((await request('GET', `/tasks/${task.id}`)).data.title, 'Headless integration');
  assert.equal((await request('GET', '/context')).data.timeZone, 'Asia/Shanghai');
  const duplicate = spawn(process.execPath, ['release/Dayweave-AI-tools/headless.mjs'], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  assert.notEqual(
    await new Promise((r) => duplicate.once('exit', r)),
    0,
    'Second process must not write the same profile',
  );
  await new Promise((resolve, reject) => {
    const cli = spawn(
      process.execPath,
      ['release/Dayweave-AI-tools/api.mjs', '--profile', directory, 'GET', '/context'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let output = '';
    cli.stdout.on('data', (c) => (output += c));
    cli.once('exit', (code) => {
      try {
        assert.equal(code, 0);
        assert.equal(JSON.parse(output).data.timeZone, 'Asia/Shanghai');
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
  console.log(
    JSON.stringify({
      headless: true,
      cli: true,
      authenticated: true,
      sharedState: true,
      profileExclusivity: true,
    }),
  );
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  }
  assert.ok(directory.startsWith(base + path.sep));
  await rm(directory, { recursive: true, force: true });
}
