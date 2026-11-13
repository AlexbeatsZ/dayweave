import { test, expect, type Page } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';
import { setTimeZone, zoneDateKey, shiftDay, weekday, wallTime } from '../../src/timezone';
import { mkdir } from 'node:fs/promises';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/New_York',
});

async function seed(page: Page, withEvent = false, futureWeekend = false) {
  setTimeZone('Asia/Shanghai');
  const state = emptyState(),
    today = zoneDateKey(Date.now());
  state.settings.theme = 'dark';
  state.schedule.semesterStart = shiftDay(today, 1 - weekday(today));
  state.schedule.totalWeeks = 12;
  state.schedule.courses = [
    {
      id: 'original-course',
      name: '量子化学',
      location: 'H4306',
      teacher: '徐老师',
      color: '#5274a3',
      weekday: 1,
      start: '08:00',
      end: '09:40',
      weeks: Array.from({ length: 12 }, (_, index) => index + 1),
      excludedDates: [],
      updatedAt: Date.now(),
    },
  ];
  if (futureWeekend)
    state.schedule.courses.push({
      ...state.schedule.courses[0],
      id: 'future-weekend-course',
      name: '周末实验',
      weekday: 7,
      weeks: [2],
    });
  if (withEvent) {
    const date = shiftDay(state.schedule.semesterStart, 2);
    state.schedule.events = [
      {
        id: 'imported-event',
        courseId: 'ical-chemistry',
        name: '一次实验安排',
        location: '实验楼',
        teacher: '',
        color: '#5274a3',
        start: wallTime(date, '13:30', 'Asia/Shanghai') + 1234,
        end: wallTime(date, '15:10', 'Asia/Shanghai') + 5678,
        timeZone: 'Asia/Shanghai',
        updatedAt: Date.now(),
      },
    ];
  }
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/#timetable');
  await expect(page.getByRole('region', { name: '日程安排' })).toBeVisible();
  return state;
}

async function courseMenu(page: Page) {
  await page.getByRole('button', { name: '日程操作', exact: true }).click();
  return page.getByRole('dialog', { name: '日程操作', exact: true });
}

test('canceling a course preview leaves saved courses unchanged and permits another import', async ({
  page,
}) => {
  await seed(page);
  const before = await page.evaluate(() => localStorage.getItem('dayweave.v1'));
  const content = '课程名称,星期,开始时间,结束时间,周次\n预览课程,3,13:30,15:10,1-12\n';
  for (let attempt = 0; attempt < 2; attempt++) {
    const menu = await courseMenu(page);
    const chooser = page.waitForEvent('filechooser');
    await menu.getByRole('button', { name: /文件导入/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'courses.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
    const preview = page.getByRole('dialog', { name: '预览导入课程', exact: true });
    await expect(preview).toContainText('预览课程');
    if (attempt === 0) await page.keyboard.press('Escape');
    else await preview.getByRole('button', { name: '取消', exact: true }).click();
    await expect(preview).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('dayweave.v1'))).toBe(before);
    await expect(page.getByRole('button', { name: '日程操作', exact: true })).toBeEnabled();
  }
});

test('a late file selection after leaving the timetable cannot reopen a preview or write data', async ({
  page,
}) => {
  await seed(page);
  const before = await page.evaluate(() => localStorage.getItem('dayweave.v1'));
  const menu = await courseMenu(page);
  const pendingChooser = page.waitForEvent('filechooser');
  await menu.getByRole('button', { name: /文件导入/ }).click();
  const chooser = await pendingChooser;
  await page.getByRole('button', { name: '手机待办', exact: true }).click();
  await chooser.setFiles({
    name: 'courses.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('课程名称,星期,开始时间,结束时间,周次\n迟到课程,3,13:30,15:10,1-12\n'),
  });
  await page.getByRole('button', { name: '手机安排', exact: true }).click();
  await expect(page.getByRole('region', { name: '日程安排' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '预览导入课程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '日程操作', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('dayweave.v1'))).toBe(before);
});

test('event week uses independent cards and seven fitting columns at every phone width', async ({
  page,
}) => {
  await seed(page, true, true);
  await mkdir('.local/preview/arrangements', { recursive: true });
  for (const width of [360, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.arrangement-day-heading')).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const grid = page.locator('.arrangement-week');
    expect(await grid.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `.local/preview/arrangements/events-week-${width}.png` });
  }
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(page.locator('.arrangement-event').filter({ hasText: '周末实验' })).toBeVisible();
});

test('one Event keeps multiple periods and supports independent edits, cancellation and reload', async ({
  page,
}) => {
  const initial = await seed(page);
  await page.getByRole('button', { name: '新增日程', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新建日程', exact: true });
  await editor.getByLabel('日程标题').fill('实验展示');
  await editor.getByLabel('日程类型').selectOption('presentation');
  await editor.getByLabel('日程日期').fill(shiftDay(initial.schedule.semesterStart, 1));
  await editor.getByLabel('开始时间 1', { exact: true }).fill('08:00');
  await editor.getByLabel('结束时间 1', { exact: true }).fill('08:45');
  await editor.getByRole('button', { name: '添加时间段', exact: true }).click();
  await editor.getByLabel('开始时间 2', { exact: true }).fill('08:55');
  await editor.getByLabel('结束时间 2', { exact: true }).fill('09:40');
  await page.screenshot({ path: '.local/preview/arrangements/event-editor-390.png' });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  const card = page.locator('.arrangement-event').filter({ hasText: '实验展示' });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('08:00–08:45');
  await expect(card).toContainText('08:55–09:40');
  await card.click();
  await page.getByLabel('日程类型').selectOption('exam');
  await page.getByLabel('日程地点').fill('实验楼 302');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await expect(card).toContainText('考试');
  await expect(card).toContainText('实验楼 302');
  await card.click();
  await page.getByRole('button', { name: '删除本次', exact: true }).click();
  await expect(card).toHaveCount(0);
});

test('imported occurrences retain exact original epoch precision after a location edit', async ({
  page,
}) => {
  const original = await seed(page, true);
  await page.locator('.arrangement-event').filter({ hasText: '一次实验安排' }).click();
  await page.getByLabel('日程地点').fill('实验楼 302');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const bounds = await page.evaluate(async () => {
    const storePath = '/src/store.ts',
      domainPath = '/src/event-domain.ts';
    const { store } = await import(storePath);
    const { eventBounds } = await import(domainPath);
    return eventBounds(
      store.get().calendarEvents.find((row: { title: string }) => row.title === '一次实验安排')!,
    );
  });
  expect(bounds).toEqual({
    start: original.schedule.events[0].start,
    end: original.schedule.events[0].end,
  });
});

test('task and event month/week modes stay independent and calendar publishing contains only Events', async ({
  page,
}) => {
  const initial = await seed(page);
  await page.getByRole('tab', { name: '月视图', exact: true }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await page.getByRole('tab', { name: '待办', exact: true }).click();
  await page.getByRole('tab', { name: '周视图', exact: true }).click();
  await page.locator('.arrangement-day-add').first().click();
  await page.getByLabel('新任务标题').fill('独立待办');
  await page.getByLabel('任务优先级').selectOption('3');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.locator('.week-task')).toContainText('独立待办');
  await page.screenshot({ path: '.local/preview/arrangements/tasks-week-390.png' });
  await expect(page.locator('.arrangement-event')).toHaveCount(0);
  await page.getByRole('tab', { name: '日程', exact: true }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await page.screenshot({ path: '.local/preview/arrangements/events-month-390.png' });
  await expect(page.locator('.week-task')).toHaveCount(0);
  const actions = await courseMenu(page);
  await actions
    .getByRole('button', { name: '导出到 Google / Microsoft / Apple 日历', exact: true })
    .click();
  await page.getByLabel('开启日程订阅').check();
  await page.getByLabel('日历发布地址').fill('https://calendar.example/dayweave');
  const link = page.getByLabel('日程订阅链接');
  const first = await link.inputValue();
  expect(first).toMatch(/^https:\/\/calendar.example\/dayweave\/calendar\/[a-f0-9]{64}\.ics$/);
  await page.getByRole('button', { name: '重置订阅链接', exact: true }).click();
  await expect(link).not.toHaveValue(first);
});

test('mouse week sorting moves task priority through the shared drag implementation', async ({
  page,
}) => {
  const state = await seed(page);
  const first = newTask('高优先级项目', {
    dates: { [state.schedule.semesterStart]: null },
    priority: 3,
    order: 0,
  });
  const second = newTask('移动到前面', {
    dates: { [state.schedule.semesterStart]: null },
    priority: 1,
    order: 1,
  });
  await page.evaluate(
    async (tasks) => {
      const modulePath = '/src/store.ts';
      const { store } = await import(modulePath);
      await store.transact((current: import('../../src/model').AppState) => ({
        ...current,
        tasks,
      }));
    },
    [first, second],
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('tab', { name: '待办', exact: true }).click();
  await page.getByRole('tab', { name: '周视图', exact: true }).click();
  const source = (await page
    .locator('.week-task')
    .filter({ hasText: '移动到前面' })
    .locator('.week-task-title')
    .boundingBox())!;
  const target = (await page
    .locator('.week-task')
    .filter({ hasText: '高优先级项目' })
    .boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.week-task').first()).toContainText('移动到前面');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks);
  expect(saved.find((row: { id: string }) => row.id === second.id).priority).toBe(3);
});
