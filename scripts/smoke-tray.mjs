import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'dayweave-tray-'));
const env = { ...process.env, DAYWEAVE_DATA_DIR: profile, DAYWEAVE_API_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let instance;
try {
  instance = await electron.launch({
    ...(process.env.DAYWEAVE_EXECUTABLE
      ? { executablePath: path.resolve(process.env.DAYWEAVE_EXECUTABLE) }
      : {}),
    args: process.env.DAYWEAVE_EXECUTABLE ? ['--tray'] : ['.', '--tray'],
    env,
    cwd: process.cwd(),
  });
  const page = await instance.firstWindow();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeAttached();
  const visible = () =>
    instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  assert.equal(await visible(), false, 'Tray startup must never show a main window');
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(path.join(profile, 'api.json'), 'utf8')).enabled;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await instance.evaluate(({ app }) =>
    app.emit('second-instance', {}, ['Dayweave'], process.cwd()),
  );
  await expect.poll(visible).toBe(true);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('新任务标题').fill('Tray persistence');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(visible).toBe(false);
  const info = JSON.parse(await readFile(path.join(profile, 'api.json'), 'utf8'));
  const response = await fetch(info.url + '/tasks', {
    headers: { Authorization: 'Bearer ' + info.token },
  });
  assert.equal(response.status, 200);
  assert.match(JSON.stringify(await response.json()), /Tray persistence/);
  console.log(
    JSON.stringify({
      hiddenStartup: true,
      openFromSecondInstance: true,
      closeToTray: true,
      backgroundApi: true,
      persisted: true,
    }),
  );
} finally {
  if (instance) await instance.close();
  assert.ok(profile.startsWith(base + path.sep));
  await rm(profile, { recursive: true, force: true });
}
