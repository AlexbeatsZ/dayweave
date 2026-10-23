import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'clearlist-desktop-'));
const env = { ...process.env, DAYWEAVE_DATA_DIR: profile, DAYWEAVE_API_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DAYWEAVE_DEV_URL;
let app;
async function readSavedState() {
  try {
    return JSON.parse(await readFile(path.join(profile, 'data.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function launch() {
  app = await electron.launch({
    ...(process.env.DAYWEAVE_EXECUTABLE
      ? { executablePath: path.resolve(process.env.DAYWEAVE_EXECUTABLE) }
      : {}),
    args: process.env.DAYWEAVE_EXECUTABLE ? [] : ['.'],
    cwd: root,
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: '待办', level: 1 })).toBeVisible();
  return page;
}
try {
  let page = await launch();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return preferences.contextIsolation && preferences.sandbox && !preferences.nodeIntegration;
    }),
    true,
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('新任务标题').fill('桌面持久化检查');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect.poll(async () => (await readSavedState())?.tasks.length).toBe(1);
  await page.getByRole('button', { name: '编辑 桌面持久化检查', exact: true }).click();
  await page.getByLabel('任务备注').fill('关闭窗口前的最后一次编辑');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  // Exercise the real window close handshake rather than terminating the process.
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (process.platform === 'darwin') await app.evaluate(({ app }) => app.quit());
  await closed;
  app = undefined;
  let saved = JSON.parse(await readFile(path.join(profile, 'data.json'), 'utf8'));
  assert.equal(saved.tasks[0].notes, '关闭窗口前的最后一次编辑');
  page = await launch();
  await expect(
    page.getByRole('button', { name: '编辑 桌面持久化检查', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑 桌面持久化检查', exact: true }).click();
  await expect(page.getByLabel('任务备注')).toHaveValue('关闭窗口前的最后一次编辑');
  await page.getByLabel('任务备注').fill('生成新备份');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect.poll(async () => (await readSavedState())?.tasks[0]?.notes).toBe('生成新备份');
  await app.close();
  app = undefined;
  await writeFile(path.join(profile, 'data.json'), '{corrupt', 'utf8');
  page = await launch();
  await expect(page.locator('.recovery-banner')).toBeVisible();
  assert.ok((await readdir(profile)).some((name) => name.startsWith('data.corrupt-')));
  saved = JSON.parse(await readFile(path.join(profile, 'data.json'), 'utf8'));
  assert.equal(saved.tasks.length, 1);
  console.log(
    JSON.stringify({
      desktop: 'passed',
      storage: 'write, close-flush, reopen, backup recovery',
      isolation: true,
    }),
  );
} finally {
  if (app) await app.close();
  assert.ok(path.resolve(profile).startsWith(path.resolve(base) + path.sep));
  await rm(profile, { recursive: true, force: true });
}
