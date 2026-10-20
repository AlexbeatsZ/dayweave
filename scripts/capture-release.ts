import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { emptyState, newTask } from '../src/model';
import { scheduleSchema } from '../src/schedule';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5191', '--strictPort'],
  { stdio: 'ignore', windowsHide: true },
);
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch('http://127.0.0.1:5191')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === 'win32'
      ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    timezoneId: 'America/New_York',
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-09-06T23:30:00Z') });
  const state = emptyState();
  state.settings.theme = 'light';
  state.tasks = [
    newTask('整理量子化学课堂笔记', { due: '2026-09-07', priority: 1 }),
    newTask('预习下一次实验', { due: '2026-09-07', priority: 2 }),
    newTask('读完本周论文', { due: '2026-09-07', priority: 3 }),
  ];
  state.schedule = scheduleSchema.parse({
    ...state.schedule,
    semesterStart: '2026-09-07',
    totalWeeks: 18,
    courses: [
      {
        id: 'sample-chem',
        name: '量子化学',
        weekday: 1,
        start: '08:00',
        end: '09:40',
        weeks: [1, 2, 3, 4],
        location: '教学楼 306',
        color: '#4264b2',
        updatedAt: 1,
      },
      {
        id: 'sample-physical',
        name: '物理化学',
        weekday: 1,
        start: '09:55',
        end: '11:35',
        weeks: [1, 2, 3, 4],
        location: '教学楼 304',
        color: '#3e8c84',
        updatedAt: 1,
      },
      {
        id: 'sample-writing',
        name: '学术写作',
        weekday: 2,
        start: '10:00',
        end: '11:40',
        weeks: [1, 2, 3, 4],
        location: '教学楼 205',
        color: '#a375b6',
        updatedAt: 1,
      },
      {
        id: 'sample-lab',
        name: '化学实验',
        weekday: 3,
        start: '09:00',
        end: '16:10',
        weeks: [1, 3],
        location: '实验楼 329',
        color: '#b68036',
        updatedAt: 1,
      },
      {
        id: 'sample-seminar',
        name: '课题讨论',
        weekday: 4,
        start: '13:30',
        end: '15:10',
        weeks: [1, 2, 3, 4],
        location: '研讨室 211',
        color: '#6289ad',
        updatedAt: 1,
      },
      {
        id: 'sample-english',
        name: '英语写作',
        weekday: 5,
        start: '08:00',
        end: '09:40',
        weeks: [1, 2, 3, 4],
        location: '线上课程',
        color: '#be778a',
        updatedAt: 1,
      },
    ],
  });
  await page.addInitScript((s) => localStorage.setItem('dayweave.v1', s), JSON.stringify(state));
  await page.goto('http://127.0.0.1:5191');
  await page.getByRole('button', { name: '课程表', exact: true }).click();
  await page.locator('.course-card').first().waitFor();
  await page.locator('.brand img').evaluate(async (image: HTMLImageElement) => {
    await image.decode();
  });
  await mkdir('.local/screenshots', { recursive: true });
  await page.screenshot({ path: '.local/screenshots/timetable-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.screenshot({ path: '.local/screenshots/today-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '手机课表', exact: true }).click();
  await page.getByRole('button', { name: /周一/ }).click();
  await page.screenshot({ path: '.local/screenshots/timetable-phone.png', fullPage: true });
  await page.getByRole('button', { name: '手机记录', exact: true }).click();
  await page.screenshot({ path: '.local/screenshots/timelog-phone.png', fullPage: true });
  console.log('Saved four release screenshots with synthetic courses and tasks.');
} finally {
  await browser?.close();
  server.kill();
}
