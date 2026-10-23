import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const executable = path.resolve(`release/Dayweave-${version}-Windows-x64.exe`);
const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const temporary = await mkdtemp(path.join(base, 'clearlist-portable-'));
const profile = path.join(temporary, 'profile');
const extraction = path.join(temporary, 'launcher');
await mkdir(extraction);
const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const env = { ...process.env, DAYWEAVE_DATA_DIR: profile, TEMP: extraction, TMP: extraction };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DAYWEAVE_DEV_URL;
const child = spawn(executable, [`--remote-debugging-port=${port}`], {
  env,
  stdio: 'ignore',
  windowsHide: true,
});
let childExit;
const exited = new Promise((resolve) =>
  child.on('exit', (code) => {
    childExit = code;
    resolve(code);
  }),
);
let browser;
async function readSavedState() {
  try {
    return JSON.parse(await readFile(path.join(profile, 'data.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
try {
  await expect
    .poll(
      async () => {
        if (childExit !== undefined)
          throw new Error(`Portable launcher exited early: ${childExit}`);
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 60000, intervals: [300, 500, 1000] },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await expect(page.getByRole('heading', { name: '待办', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('新任务标题').fill('单文件便携启动检查');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect
    .poll(async () => (await readSavedState())?.tasks[0]?.title)
    .toBe('单文件便携启动检查');
  await page.evaluate(() => window.close()).catch(() => {});
  let timeout;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Portable launcher did not exit')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(childExit, 0);
  console.log(
    JSON.stringify({ portable: 'passed', startup: true, taskWrite: true, windowClose: true }),
  );
} finally {
  await browser?.close().catch(() => {});
  if (childExit === undefined) child.kill();
  assert.ok(path.resolve(temporary).startsWith(path.resolve(base) + path.sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
