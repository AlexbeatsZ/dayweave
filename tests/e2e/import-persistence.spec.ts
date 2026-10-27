import { test, expect } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, emptyState());
});

for (const source of ['native', 'file'] as const) {
  for (const succeeds of [true, false]) {
    test(`${source} import waits for persistence ${succeeds ? 'success' : 'failure'}`, async ({
      page,
    }) => {
      const backup = emptyState();
      backup.tasks = [newTask('Durable import')];
      await page.goto('/');
      await expect(page.getByRole('button', { name: '设置与同步', exact: true })).toBeVisible();
      await page.evaluate((data) => {
        Object.assign(window, {
          clearlist: {
            importData: async () => data,
            patch: () =>
              new Promise((resolve, reject) => {
                window.addEventListener(
                  'test:finish-import',
                  (event) => {
                    if ((event as CustomEvent<boolean>).detail) {
                      localStorage.setItem('dayweave.v1', JSON.stringify(data));
                      resolve({ state: data });
                    } else reject(new Error('disk full'));
                  },
                  { once: true },
                );
              }),
          },
        });
      }, backup);
      await page.getByRole('button', { name: '设置与同步', exact: true }).click();
      const importButton = page.getByRole('button', { name: '合并导入', exact: true });
      if (source === 'native') await importButton.click();
      else
        await page.getByLabel('选择备份文件').setInputFiles({
          name: 'backup.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(backup)),
        });
      await expect(importButton).toBeDisabled();
      await expect(page.getByRole('status').filter({ hasText: '导入完成' })).toHaveCount(0);
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks),
      ).toEqual([]);
      await page.evaluate((success) => {
        window.dispatchEvent(new CustomEvent('test:finish-import', { detail: success }));
      }, succeeds);
      await expect(importButton).toBeEnabled();
      if (succeeds) {
        await expect(page.getByRole('status')).toContainText('导入完成，新增 1 件任务');
      } else {
        await expect(page.locator('.settings-modal').getByRole('alert')).toContainText('disk full');
        await expect(page.locator('.settings-modal').getByRole('alert')).not.toContainText(
          '原有数据未改变',
        );
        await expect(page.getByRole('status').filter({ hasText: '导入完成' })).toHaveCount(0);
      }
      await page.reload();
      expect(
        await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks.length),
      ).toBe(succeeds ? 1 : 0);
    });
  }
}

test('invalid import leaves saved data unchanged and permits a later valid import', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  const picker = page.getByLabel('选择备份文件');
  for (const content of ['{"version":999}', '{', '{"format":"open-timelog","version":999}']) {
    await picker.setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
    const alert = page.locator('.settings-modal').getByRole('alert');
    await expect(alert).toContainText('导入失败');
    await expect(alert).toContainText('原有数据未改变');
    await expect(alert).not.toContainText('"code"');
  }
  await expect(page.getByRole('status').filter({ hasText: '导入完成' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks)).toEqual(
    [],
  );
  const backup = emptyState();
  backup.tasks = [newTask('Valid import')];
  await picker.setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole('status')).toContainText('导入完成，新增 1 件任务');
  await expect(page.locator('.settings-modal').getByRole('alert')).toHaveCount(0);
});
