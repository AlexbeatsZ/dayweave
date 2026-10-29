import { test, expect } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';

for (const succeeds of [true, false]) {
  test(`internal backup recovery waits for persistence ${succeeds ? 'success' : 'failure'}`, async ({
    page,
  }) => {
    await page.addInitScript((state) => {
      if (!localStorage.getItem('dayweave.v1'))
        localStorage.setItem('dayweave.v1', JSON.stringify(state));
    }, emptyState());
    await page.goto('/');
    await expect(page.getByRole('button', { name: '设置与同步', exact: true })).toBeVisible();
    const backup = { ...emptyState(), tasks: [newTask('Durable recovery')] };
    await page.evaluate(async (data) => {
      Object.assign(window, {
        clearlist: {
          patch: () =>
            new Promise((resolve, reject) =>
              window.addEventListener(
                'test:finish-import',
                (event) => {
                  if ((event as CustomEvent<boolean>).detail) {
                    localStorage.setItem('dayweave.v1', JSON.stringify(data));
                    resolve({ state: data });
                  } else reject(new Error('disk full'));
                },
                { once: true },
              ),
            ),
        },
      });
      const modulePath = '/src/store.ts';
      const { store } = await import(modulePath);
      void store
        .importData(data)
        .then(() => localStorage.setItem('recovery-result', 'saved'))
        .catch((error: Error) => localStorage.setItem('recovery-result', error.message));
    }, backup);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks),
    ).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('recovery-result'))).toBeNull();
    await page.evaluate(
      (success) => window.dispatchEvent(new CustomEvent('test:finish-import', { detail: success })),
      succeeds,
    );
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('recovery-result')))
      .toContain(succeeds ? 'saved' : 'disk full');
    await page.reload();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks.length),
    ).toBe(succeeds ? 1 : 0);
  });
}

test('normal settings omit backup import and export controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选择备份文件')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '合并导入', exact: true })).toHaveCount(0);
});
