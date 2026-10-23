import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'clearlist-ui-api-'));
const env = { ...process.env, DAYWEAVE_DATA_DIR: profile, DAYWEAVE_API_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DAYWEAVE_DEV_URL;
let app;
try {
  app = await electron.launch({
    ...(process.env.DAYWEAVE_EXECUTABLE
      ? { executablePath: path.resolve(process.env.DAYWEAVE_EXECUTABLE) }
      : {}),
    args: process.env.DAYWEAVE_EXECUTABLE ? [] : ['.'],
    cwd: process.cwd(),
    env,
  });
  let page = await app.firstWindow();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => (await window.clearlist.apiInfo()).enabled))
    .toBe(true);
  const info = await page.evaluate(() => window.clearlist.apiInfo());
  const health = JSON.parse(
    execFileSync(process.execPath, ['scripts/api.mjs', '--profile', profile, 'GET', '/health'], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  assert.ok(health.revision);
  const request = async (method, route, value) => {
    const response = await fetch(info.url + route, {
      method,
      headers: {
        Authorization: `Bearer ${info.token}`,
        ...(value ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const {
    data: { today },
  } = await request('GET', '/context');
  const { data: task } = await request('POST', '/tasks', { title: 'AI 创建的任务', due: today });
  await page.getByRole('button', { name: '编辑 AI 创建的任务', exact: true }).click();
  await page.getByLabel('任务备注').fill('界面补充的备注');
  await request('PATCH', `/tasks/${task.id}`, { priority: 1 });
  await request('PATCH', `/tasks/${task.id}`, { title: 'AI 更新的标题' });
  // A shared draft is explicit: concurrent AI writes cannot overwrite it, and
  // saving a stale revision must not overwrite the newer AI fields either.
  await expect(page.getByLabel('任务备注')).toHaveValue('界面补充的备注');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('任务已在其他位置修改');
  assert.equal((await request('GET', `/tasks/${task.id}`)).data.notes, '');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '编辑 AI 更新的标题', exact: true }).click();
  await expect(page.getByLabel('任务优先级', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('任务标题', { exact: true })).toHaveValue('AI 更新的标题');
  await page.getByLabel('任务备注').fill('界面补充的备注');
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect
    .poll(async () => (await request('GET', `/tasks/${task.id}`)).data.notes)
    .toBe('界面补充的备注');
  await request('POST', `/tasks/${task.id}/complete`);
  await expect(
    page.getByRole('checkbox', { name: '完成 AI 更新的标题', exact: true }),
  ).toBeChecked();
  await request('PATCH', '/settings', { theme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const disk = JSON.parse(await readFile(path.join(profile, 'data.json'), 'utf8'));
  assert.equal(disk.tasks[0].notes, '界面补充的备注');
  assert.ok(disk.tasks[0].completedAt);
  if (process.platform === 'darwin') {
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    await request('GET', '/health');
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app }) => app.emit('activate'));
    page = await reopened;
    await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
  console.log(
    JSON.stringify({ apiToUi: true, uiToApi: true, concurrentFields: true, persisted: true }),
  );
} finally {
  await app?.close();
  assert.ok(profile.startsWith(base + path.sep));
  await rm(profile, { recursive: true, force: true });
}
