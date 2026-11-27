import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { materialPreviewState, previewNow } from '../tests/fixtures/material-preview';

const output = new URL('../.local/preview/material-expressive/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
try {
  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.setFixedTime(previewNow);
    await page.addInitScript((state) => {
      if (!localStorage.getItem('dayweave.v1'))
        localStorage.setItem('dayweave.v1', JSON.stringify(state));
      localStorage.setItem('dayweave.appearance', state.settings.theme);
    }, materialPreviewState(theme));
    await page.goto('http://127.0.0.1:5178');
    await page.getByRole('button', { name: '新建任务', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const capture = async (name: string) => {
      await page.mouse.move(0, 0);
      await page.locator('.phone-content').evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({
        path: new URL(`${name}-${theme}.png`, output).pathname,
        animations: 'disabled',
      });
    };
    await capture('desktop-tasks');
    await page.getByRole('button', { name: '记录', exact: true }).click();
    await page.getByRole('tab', { name: '计时', exact: true }).click();
    await capture('desktop-activities');
    await page.getByRole('tab', { name: '目标', exact: true }).click();
    await capture('desktop-goals');
    await page.getByRole('button', { name: '统计', exact: true }).click();
    await capture('desktop-statistics');
    await page.getByRole('button', { name: '待办', exact: true }).click();
    await page.getByRole('button', { name: '新建任务', exact: true }).click();
    await capture('desktop-editor');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '设置与同步', exact: true }).click();
    await capture('desktop-settings');
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('phone-tasks');
    await page.getByRole('button', { name: '手机记录', exact: true }).click();
    await page.getByRole('tab', { name: '计时', exact: true }).click();
    await capture('phone-activities');
    await context.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(
    new URL('result.json', output),
    JSON.stringify(
      { date: '2026-11-26', source: 'synthetic isolated browser profile', screenshots: 16, errors },
      null,
      2,
    ),
  );
  console.log(`Saved 16 isolated previews to ${output.pathname}`);
} finally {
  await browser.close();
}
