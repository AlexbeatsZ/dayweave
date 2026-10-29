import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { emptyState, newTask, type AppState } from '../../src/model';
import { dayKey, dayStart } from '../../src/timelog/domain';
import { setTimeZone, shiftDay, weekday } from '../../src/timezone';

test.use({ timezoneId: 'America/New_York' });

async function seed(page: Page) {
  setTimeZone('Asia/Shanghai');
  const state = emptyState(),
    today = dayKey(Date.now()),
    start = dayStart(today);
  state.settings.theme = 'dark';
  state.lists.push(
    { id: 'study-list', name: '学习', color: '#769fed', order: 1 },
    { id: 'work-list', name: '工作', color: '#b991ce', order: 2 },
    { id: 'life-list', name: '生活', color: '#d7b66c', order: 3 },
  );
  state.tagColors = { tasks: { 课程: '#78b6ba', 阅读: '#b991ce' }, records: { 专注: '#78b6ba' } };
  state.tasks = [
    newTask('整理量子化学课堂笔记', {
      id: 'notes',
      listId: 'study-list',
      due: today,
      tags: ['课程'],
      order: 10,
      priority: 2,
      estimatedMinutes: 45,
    }),
    newTask('完成分析化学习题', {
      id: 'exercises',
      listId: 'study-list',
      due: today,
      order: 20,
      priority: 1,
    }),
    newTask('整理今天的工作记录', { id: 'work', listId: 'work-list', due: today, order: 30 }),
    newTask('读完本周的推荐论文', {
      id: 'reading',
      listId: 'study-list',
      due: shiftDay(today, 1),
      tags: ['阅读'],
      order: 40,
    }),
    newTask('准备下次实验材料', {
      id: 'materials',
      listId: 'work-list',
      due: shiftDay(today, 2),
      order: 50,
    }),
    newTask('整理新的研究想法', { id: 'idea', listId: 'study-list', order: 60 }),
  ];
  state.timelog.records = [
    {
      id: 'study-record',
      activityId: 'study',
      note: '阅读讲义，整理波函数归一化的推导',
      tags: ['专注'],
      spans: [{ start: start + 3600000, end: start + 6300000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 6300000,
    },
    {
      id: 'work-record',
      activityId: 'work',
      note: '整理实验记录与观察结果',
      tags: [],
      spans: [{ start: start + 7200000, end: start + 9000000 }],
      pointsPerHour: 15,
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 9000000,
    },
  ];
  state.timelog.goals = [
    {
      id: 'study-day',
      activityId: 'study',
      name: '每日学习一小时',
      period: 'day',
      minutes: 60,
      archived: false,
      updatedAt: start,
    },
    {
      id: 'exercise-day',
      activityId: 'exercise',
      name: '每天运动三十分钟',
      period: 'day',
      minutes: 30,
      archived: false,
      updatedAt: start,
    },
    {
      id: 'study-week',
      activityId: 'study',
      name: '本周学习九小时',
      period: 'week',
      minutes: 540,
      archived: false,
      updatedAt: start,
    },
  ];
  state.schedule.semesterStart = shiftDay(today, 1 - weekday(today));
  state.schedule.totalWeeks = 18;
  state.schedule.courses = [
    ['量子化学', 'H4306', '#5274a3', 1, '08:00', '09:40'],
    ['应用化学专题', 'H2105A', '#b2776d', 2, '08:00', '09:40'],
    ['物理化学实验', '化学楼三楼', '#9f6e88', 3, '09:55', '12:30'],
    ['无机化学', 'H4104', '#7e72b0', 4, '13:30', '15:10'],
    ['生物化学', 'H2113B', '#5f9697', 5, '13:30', '15:10'],
  ].map(([name, location, color, day, startTime, endTime], index) => ({
    id: `course-${index}`,
    name: String(name),
    location: String(location),
    teacher: '任课教师',
    color: String(color),
    weekday: Number(day),
    start: String(startTime),
    end: String(endTime),
    weeks: Array.from({ length: 18 }, (_, week) => week + 1),
    excludedDates: [],
    updatedAt: Date.now(),
  }));
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await expect(page.locator('[data-layout="desktop"]')).toBeVisible();
}

const state = (page: Page): Promise<AppState> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));
const mainNav = (page: Page) => page.getByRole('navigation', { name: '主导航', exact: true });
const navigate = (page: Page, name: string) =>
  mainNav(page).getByRole('button', { name, exact: true }).click();

async function withinViewport(page: Page) {
  await page.locator('.phone-content').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const nav = (await mainNav(page).boundingBox())!,
    content = (await page.locator('.phone-content').boundingBox())!;
  expect(nav.x).toBe(0);
  expect(nav.width).toBeGreaterThanOrEqual(190);
  expect(content.x).toBeGreaterThanOrEqual(nav.width - 1);
  expect(content.width).toBeGreaterThan(400);
  const settings = (await page
    .getByRole('button', { name: '设置与同步', exact: true })
    .boundingBox())!;
  expect(settings.y + settings.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
}

test('permanent desktop navigation and shared pages fit widescreen, 16:10 and compact desktop sizes', async ({
  page,
}) => {
  test.setTimeout(90000);
  await seed(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const screenshots = path.resolve('release/desktop-preview-0.4.0');
  await mkdir(screenshots, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
    { width: 900, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(mainNav(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveCount(0);
    await expect(mainNav(page).locator(':scope > button')).toHaveCount(4);
    await navigate(page, '待办');
    await expect(page.getByRole('complementary', { name: '待办分类', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增所属清单', exact: true })).toBeVisible();
    await withinViewport(page);
    if (viewport.width === 1440 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `tasks-${viewport.width}x${viewport.height}.png`),
      });
    await page.getByRole('tab', { name: '周计划', exact: true }).click();
    await expect(page.locator('.phone-plan-day')).toHaveCount(7);
    await withinViewport(page);
    if (viewport.width === 1920 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `week-${viewport.width}x${viewport.height}.png`),
      });
    await navigate(page, '记录');
    await expect(page.getByRole('complementary', { name: '记录分类', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增活动', exact: true })).toBeVisible();
    await expect(page.locator('.timeline-summary')).toHaveCount(0);
    await withinViewport(page);
    if (viewport.width === 1440 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `timeline-${viewport.width}x${viewport.height}.png`),
      });
    await page.getByRole('tab', { name: '目标', exact: true }).click();
    await expect(page.locator('.goal-card')).toHaveCount(3);
    await expect(page.getByLabel('查看日期', { exact: true })).toHaveCount(0);
    if (viewport.width === 1440 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `goals-${viewport.width}x${viewport.height}.png`),
      });
    await navigate(page, '安排');
    await page.getByRole('tab', { name: '课程表', exact: true }).click();
    await expect(page.getByRole('region', { name: '每周课程表', exact: true })).toBeVisible();
    await expect(page.locator('.timetable-day-heading')).toHaveCount(5);
    await withinViewport(page);
    if (viewport.width === 1920 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `timetable-${viewport.width}x${viewport.height}.png`),
      });
    await navigate(page, '统计');
    await expect(page.getByRole('heading', { name: '每日待办', exact: true })).toBeVisible();
    await withinViewport(page);
    if (viewport.width === 1440 || viewport.width === 900)
      await page.screenshot({
        path: path.join(screenshots, `statistics-${viewport.width}x${viewport.height}.png`),
      });
  }
  expect(errors).toEqual([]);
});

test('crossing the desktop breakpoint preserves active timer, task draft and selected record page', async ({
  page,
}) => {
  await seed(page);
  await navigate(page, '记录');
  await page.getByRole('tab', { name: '计时', exact: true }).click();
  await page.locator('.activity-tile').filter({ hasText: '学习' }).click();
  await page.getByLabel('计时描述').fill('跨尺寸保留的计时');
  const timerId = (await state(page)).timelog.timer!.id;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-layout="phone"]')).toBeVisible();
  await expect(page.getByRole('tab', { name: '计时', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('计时描述')).toHaveValue('跨尺寸保留的计时');
  await page.getByRole('button', { name: '手机待办', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const draft = page.getByRole('dialog', { name: '新建任务', exact: true });
  await draft.getByLabel('新任务标题').fill('窗口缩放不丢失草稿');
  await draft.getByLabel('新任务描述').fill('先输入，再切换布局');
  await expect(draft).toHaveClass(/phone-sheet/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(draft).not.toHaveClass(/phone-sheet/);
  await expect(draft.getByLabel('新任务标题')).toHaveValue('窗口缩放不丢失草稿');
  await expect(draft.getByLabel('新任务描述')).toHaveValue('先输入，再切换布局');
  await draft.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '编辑 窗口缩放不丢失草稿', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.phone-timer-dock')).toBeVisible();
  expect((await state(page)).timelog.timer!.id).toBe(timerId);
  await navigate(page, '记录');
  await page.getByRole('tab', { name: '计时', exact: true }).click();
  await expect(page.getByLabel('计时描述')).toHaveValue('跨尺寸保留的计时');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await navigate(page, '待办');
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: '新建任务', exact: true })).toBeVisible();
  await page.getByLabel('新任务标题').fill('normal typing n');
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('mouse long press reorders visible task priority numbers and completion sinks in daily plans', async ({
  page,
}) => {
  await seed(page);
  const rows = page.locator('.phone-content .task-row');
  await expect(rows.locator('.task-check')).toHaveText(['1', '2', '3']);
  const first = (await rows.first().locator('.task-body').boundingBox())!,
    last = (await rows.nth(2).locator('.task-body').boundingBox())!;
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await expect(page.locator('.task-sort-ghost')).toBeVisible();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2 + 3, { steps: 8 });
  await page.mouse.up();
  await expect(rows.locator('.task-title')).toHaveText([
    '完成分析化学习题',
    '整理今天的工作记录',
    '整理量子化学课堂笔记',
  ]);
  await expect(rows.locator('.task-check')).toHaveText(['1', '2', '3']);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '完成 完成分析化学习题', exact: true }).click();
  await expect(rows.last()).toHaveClass(/\bdone\b/);
  await expect(rows.locator('.task-check:not(.checked)')).toHaveText(['1', '2']);
  await page.reload();
  await expect(rows.locator('.task-title')).toHaveText([
    '整理今天的工作记录',
    '整理量子化学课堂笔记',
    '完成分析化学习题',
  ]);
});

test('tab transitions animate shared content and honor reduced motion', async ({ page }) => {
  await seed(page);
  const animations = async (label: string) =>
    page.evaluate(async (name) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (item) => item.textContent?.trim().startsWith(name),
      )!;
      button.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return document
        .querySelector('.phone-content')!
        .getAnimations()
        .map((animation) => animation.effect?.getTiming().duration);
    }, label);
  expect(await animations('全部')).toContain(180);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animations('待办箱')).toEqual([]);
  await expect(page.getByRole('tab', { name: /^待办箱/ })).toHaveAttribute('aria-selected', 'true');
});
