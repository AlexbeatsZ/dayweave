import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { emptyState, newTask, dateKey } from '../dist-electron/src/model.js';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.DAYWEAVE_BROWSER ?? (fs.existsSync(edge) ? edge : undefined),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = emptyState();
  state.settings.theme = 'dark';
  state.lists.push({ id: 'study', name: '学习', color: '#76b9ed', order: 1 });
  state.tasks = [
    newTask('复习量子化学', { due: dateKey(), listId: 'study', priority: 1, estimatedMinutes: 45 }),
    newTask('整理实验笔记', {
      due: dateKey(),
      listId: 'study',
      priority: 2,
      notes: '补齐图表和计算过程',
    }),
    newTask('阅读一篇新论文', { listId: 'study', tags: ['阅读'] }),
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('http://127.0.0.1:5178');
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({ path: 'docs/images/today-dark.png' });
  await page.getByRole('button', { name: '编辑 复习量子化学', exact: true }).click();
  await page.screenshot({ path: 'docs/images/detail.png' });
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.getByRole('button', { name: '四象限', exact: true }).click();
  await page.screenshot({ path: 'docs/images/quadrants.png' });
  await page.getByRole('button', { name: '安排', exact: true }).click();
  await page.screenshot({ path: 'docs/images/calendar.png' });
  await page.getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({ path: 'docs/images/today.png' });
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '手机待办', exact: true }).click();
  await page.screenshot({ path: 'docs/images/mobile-dark.png' });
  await page.getByRole('button', { name: '编辑 复习量子化学', exact: true }).click();
  await page.screenshot({ path: 'docs/images/mobile-detail.png' });
  console.log(JSON.stringify({ screenshots: 7, errors }));
} finally {
  await browser.close();
}
