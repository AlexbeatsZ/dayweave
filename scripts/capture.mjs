import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.DAYWEAVE_BROWSER ?? (fs.existsSync(edge) ? edge : undefined),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5178');
  await page.getByRole('button', { name: '添加入门示例', exact: false }).click();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/today.png' });
  await page.getByRole('button', { name: '编辑 把最重要的一件事，留在今天', exact: true }).click();
  await page.screenshot({ path: 'docs/images/detail.png' });
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '四象限', exact: true }).click();
  await page.screenshot({ path: 'docs/images/quadrants.png' });
  await page.getByRole('button', { name: '日历', exact: true }).click();
  await page.screenshot({ path: 'docs/images/calendar.png' });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '专注', exact: true }).click();
  await page.screenshot({ path: 'docs/images/focus-dark.png' });
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.screenshot({ path: 'docs/images/today-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '手机今天', exact: true }).click();
  await page.screenshot({ path: 'docs/images/mobile-dark.png' });
  await page.getByRole('button', { name: '编辑 把最重要的一件事，留在今天', exact: true }).click();
  await page.screenshot({ path: 'docs/images/mobile-detail.png' });
  console.log(JSON.stringify({ screenshots: 8, errors }));
} finally {
  await browser.close();
}
