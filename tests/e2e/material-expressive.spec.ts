import { test, expect } from '@playwright/test';
import { materialPreviewState, previewNow } from '../fixtures/material-preview';

test('Material surfaces, icons and task editing fit 360–1440px without loading remote assets', async ({
  page,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5178')) remote.push(request.url());
  });
  await page.clock.setFixedTime(previewNow);
  await page.addInitScript(
    (state) => localStorage.setItem('dayweave.v1', JSON.stringify(state)),
    materialPreviewState(),
  );
  await page.goto('/');
  await expect(page.locator('.material-expressive')).toBeVisible();
  for (const width of [360, 390, 700, 701, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const nav = page.getByRole('navigation', {
      name: width <= 700 ? '手机底部导航' : '主导航',
      exact: true,
    });
    await expect(nav.locator('.material-symbol svg')).toHaveCount(4);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    const button = await page.getByRole('button', { name: '新建任务', exact: true }).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(48);
    expect(button!.x + button!.width).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    const save = page.getByRole('button', { name: '添加任务', exact: true });
    await expect(save).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(remote).toEqual([]);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`the actual loading state morphs and stops its spatial motion with preference ${reducedMotion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript((state) => {
      Object.assign(window, {
        clearlist: {
          onBeforeClose: () => {},
          readyToClose: () => {},
          load: () =>
            new Promise((resolve) =>
              Object.assign(window, {
                finishMaterialLoad: () =>
                  resolve({ state, recovered: false, path: 'isolated-preview' }),
              }),
            ),
        },
      });
    }, materialPreviewState());
    await page.goto('/');
    const indicator = page.getByRole('progressbar', { name: '正在打开你的安排' });
    await expect(indicator).toBeVisible();
    const first = await indicator.locator('path').getAttribute('d');
    expect(first!.length).toBeGreaterThan(30);
    const size = await indicator.boundingBox();
    expect(size!.width).toBe(48);
    expect(size!.height).toBe(48);
    if (reducedMotion === 'reduce') {
      await page.waitForTimeout(700); // Observe the absence of RAF motion over a complete morph interval.
      expect(await indicator.locator('path').getAttribute('d')).toBe(first);
    } else {
      await expect.poll(() => indicator.locator('path').getAttribute('d')).not.toBe(first);
    }
    await page.evaluate(() =>
      (window as unknown as { finishMaterialLoad: () => void }).finishMaterialLoad(),
    );
    await expect(indicator).toHaveCount(0);
    await expect(page.locator('.material-expressive')).toBeVisible();
  });
}
