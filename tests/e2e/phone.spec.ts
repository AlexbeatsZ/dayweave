import { test, expect, type Page } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';
import { dayKey, dayStart, shiftDay } from '../../src/timelog/domain';
import { setTimeZone } from '../../src/timezone';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/New_York',
});

async function seed(page: Page) {
  setTimeZone('Asia/Shanghai');
  const day = dayKey(Date.now()),
    start = dayStart(day),
    state = emptyState();
  state.settings.theme = 'dark';
  state.lists.push({ id: 'study-list', name: '学习', color: '#4264b2', order: 1 });
  state.tasks = [
    newTask('整理量子化学的课堂笔记', {
      due: day,
      listId: 'study-list',
      notes: '整理波函数归一化的推导，补上课后问题。',
      priority: 2,
    }),
    newTask('一个还没安排日期的想法'),
  ];
  state.timelog.records = [
    {
      id: 'saved-record',
      activityId: 'study',
      note: '阅读量子化学讲义，整理波函数归一化推导。',
      tags: ['量子化学'],
      spans: [{ start, end: start + 1800000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 1800000,
    },
  ];
  state.timelog.goals = [
    {
      id: 'goal',
      activityId: 'study',
      name: '每天读一点',
      period: 'day',
      minutes: 60,
      archived: false,
      updatedAt: start,
    },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  return day;
}

async function swipe(page: Page, direction: 'left' | 'right' | 'down') {
  const session = await page.context().newCDPSession(page);
  const from = { x: direction === 'right' ? 65 : 310, y: 410 };
  const to =
    direction === 'down'
      ? { x: from.x + 8, y: 620 }
      : { x: direction === 'left' ? 65 : 310, y: 415 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= 5; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * step) / 5, y: from.y + ((to.y - from.y) * step) / 5 },
      ],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('compact shared tabs swipe both ways, goals group densely, and all add buttons match', async ({
  page,
}, info) => {
  await seed(page);
  expect((await page.locator('.phone-header').boundingBox())!.height).toBeLessThanOrEqual(100);
  await expect(page.getByRole('button', { name: '搜索任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换深浅主题' })).toHaveCount(0);
  await expect(page.locator('.phone-nav > button')).toHaveCount(4);
  await swipe(page, 'left');
  await expect(page.getByRole('tab', { name: '周计划' })).toHaveAttribute('aria-selected', 'true');
  await swipe(page, 'left');
  await expect(page.getByRole('tab', { name: /^全部/ })).toHaveAttribute('aria-selected', 'true');
  await swipe(page, 'left');
  await expect(page.getByRole('tab', { name: /^待办箱/ })).toHaveAttribute('aria-selected', 'true');
  await swipe(page, 'right');
  await expect(page.getByRole('tab', { name: /^全部/ })).toHaveAttribute('aria-selected', 'true');
  const appearance = () =>
    page.locator('.phone-fab').evaluate((button) => {
      const css = getComputedStyle(button),
        icon = button.querySelector('svg')!;
      return [
        css.width,
        css.height,
        css.borderRadius,
        css.backgroundColor,
        css.color,
        icon.getAttribute('stroke-width'),
        icon.getAttribute('width'),
      ];
    });
  const taskAdd = await appearance();
  await page.getByRole('button', { name: '手机记录', exact: true }).click();
  await expect(page.getByRole('tab', { name: '时间线', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await appearance()).toEqual(taskAdd);
  await swipe(page, 'left');
  await expect(page.getByRole('tab', { name: '计时', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await swipe(page, 'left');
  await expect(page.getByRole('tab', { name: '目标', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await appearance()).toEqual(taskAdd);
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { store } = await import(path);
    await store.transact((state: ReturnType<typeof emptyState>) => ({
      ...state,
      timelog: {
        ...state.timelog,
        goals: [
          ...state.timelog.goals,
          {
            id: 'exercise-goal',
            name: '体育运动30分钟',
            activityId: 'exercise',
            minutes: 30,
            period: 'day',
            archived: false,
            updatedAt: Date.now(),
          },
          {
            id: 'weekly-goal',
            name: '一周学习9小时',
            activityId: 'study',
            minutes: 540,
            period: 'week',
            archived: false,
            updatedAt: Date.now(),
          },
          {
            id: 'weekly-read',
            name: '一周阅读2小时',
            activityId: 'reading',
            minutes: 120,
            period: 'week',
            archived: false,
            updatedAt: Date.now(),
          },
        ],
      },
    }));
  });
  await expect(page.locator('.goal-group')).toHaveCount(2);
  await expect(page.locator('.goal-card')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('phone-goals-grouped.png') });
  await swipe(page, 'down');
  await expect(page.getByRole('tab', { name: '目标', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await swipe(page, 'right');
  await expect(page.getByRole('tab', { name: '计时', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('timeline auto-loads beyond seven days, visible-day points follow scrolling, and date jumps reset only the scroll window', async ({
  page,
}, info) => {
  const today = await seed(page),
    yesterday = shiftDay(today, -1),
    older = shiftDay(today, -30);
  await page.evaluate(
    async ({ start }) => {
      const path = '/src/store.ts';
      const { store } = await import(path);
      await store.transact((state: ReturnType<typeof emptyState>) => ({
        ...state,
        timelog: {
          ...state.timelog,
          records: [
            ...state.timelog.records,
            {
              id: 'yesterday-record',
              activityId: 'work',
              note: '昨天的独立积分',
              tags: [],
              spans: [{ start, end: start + 3600000 }],
              pointsPerHour: 15,
              nature: 'positive',
              deletedAt: null,
              updatedAt: start + 3600000,
            },
          ],
        },
      }));
    },
    { start: dayStart(yesterday) + 3600000 },
  );
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await expect(page.locator('.timeline-summary')).toContainText('+10');
  const scroller = page.locator('.phone-content');
  for (let index = 0; index < 12; index++) {
    if ((await page.locator('.phone-timeline-day').count()) >= 9) break;
    const count = await page.locator('.phone-timeline-day').count();
    await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect.poll(() => page.locator('.phone-timeline-day').count()).toBeGreaterThan(count);
  }
  expect(await page.locator('.phone-timeline-day').count()).toBeGreaterThan(7);
  await page.locator(`[data-timeline-day="${yesterday}"]`).evaluate((section) => {
    const container = section.closest('.phone-content')!,
      toolbar = container.querySelector('.phone-record-toolbar')!;
    container.scrollTop +=
      section.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      toolbar.getBoundingClientRect().height;
  });
  await expect(page.getByLabel('查看日期')).toHaveValue(yesterday);
  await expect(page.locator('.timeline-summary')).toContainText('+15');
  await expect(page.locator('.timeline-summary')).toContainText('1 小时');
  await page.screenshot({ path: info.outputPath('phone-history-points.png') });
  await page.getByLabel('查看日期').fill(older);
  await expect(page.locator('.phone-timeline-day').first()).toHaveAttribute(
    'data-timeline-day',
    older,
  );
  await expect(page.locator('.timeline-summary > span').nth(2)).toHaveText('积分 0');
  await expect(page.locator(`[data-timeline-day="${today}"]`)).toHaveCount(0);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
});

test('week, task sheet, subtasks and no-date placement persist in the unified store', async ({
  page,
}, info) => {
  const day = await seed(page);
  await expect(page.getByRole('navigation', { name: '手机底部导航' })).toBeVisible();
  await expect(page.getByRole('button', { name: `查看 ${day} 的任务` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: info.outputPath('phone-tasks-dark.png') });
  await page.getByRole('button', { name: '新建任务', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: '新建任务' });
  await sheet.getByLabel('新任务标题').fill('手机上安排下一步 #学习');
  await sheet.getByLabel('新任务描述').fill('写下明确的行动');
  await sheet.getByLabel('新任务子任务').fill('读完第一节');
  await sheet.getByRole('button', { name: '加入子任务' }).tap();
  await sheet.getByRole('button', { name: '无日期', exact: true }).tap();
  await sheet.getByLabel('新任务优先级').selectOption('2');
  await page.screenshot({ path: info.outputPath('phone-task-sheet.png') });
  await sheet.getByRole('button', { name: '添加任务', exact: true }).tap();
  await expect(sheet).not.toBeVisible();
  await page.getByRole('tab', { name: /^待办箱/ }).tap();
  await page.getByRole('button', { name: '编辑 手机上安排下一步', exact: true }).tap();
  const detail = page.getByRole('dialog', { name: '编辑任务' });
  await expect(detail.getByLabel('任务备注')).toHaveValue('写下明确的行动');
  await expect(detail.getByRole('checkbox', { name: '子任务 读完第一节' })).toBeVisible();
  expect((await detail.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('clearlist:back', { cancelable: true })),
  );
  await expect(detail).not.toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /^全部/ }).tap();
  await expect(
    page.getByRole('button', { name: '编辑 手机上安排下一步', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('record sheet, native back and multi-day timeline retain time and historical points', async ({
  page,
}, info) => {
  await seed(page);
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await expect(page.locator('.record-card')).toContainText('波函数');
  await page.screenshot({ path: info.outputPath('phone-records-dark.png') });
  await page.getByRole('button', { name: '编辑学习记录', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '编辑记录' });
  await expect(dialog.getByText('30 分钟', { exact: true })).toBeVisible();
  await dialog.getByLabel('描述', { exact: true }).fill('手机修正备注，保留时间和积分');
  await dialog.getByRole('button', { name: '#量子化学', exact: true }).tap();
  await page.screenshot({ path: info.outputPath('phone-record-sheet.png') });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(page.locator('.record-card')).toContainText('保留时间和积分');
  const record = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.records[0],
  );
  expect(record.pointsPerHour).toBe(20);
  expect(record.spans[0].end - record.spans[0].start).toBe(1800000);
  await page.getByRole('button', { name: '添加记录', exact: true }).tap();
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('clearlist:back', { cancelable: true })),
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '手机记录' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const count = await page.locator('.phone-timeline-day').count();
  await page
    .locator('.phone-content')
    .evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => page.locator('.phone-timeline-day').count()).toBeGreaterThan(count);
  await expect(page.getByRole('button', { name: '查看更早一天' })).toHaveCount(0);
});

test('timer pause, cross-page dock, stop and analysis share one record identity', async ({
  page,
}, info) => {
  await seed(page);
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await page.getByRole('tab', { name: '计时', exact: true }).tap();
  await page.screenshot({ path: info.outputPath('phone-activity-picker.png') });
  await page.locator('.activity-tile').filter({ hasText: '工作' }).tap();
  await page.getByLabel('计时描述').fill('手机端计时验收');
  await page.getByRole('button', { name: '暂停', exact: true }).tap();
  const timerId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.timer.id,
  );
  await page.getByRole('button', { name: '手机待办', exact: true }).tap();
  await expect(page.locator('.phone-timer-dock')).toContainText('已暂停');
  await page.locator('.phone-timer-dock > button').first().tap();
  await page.getByRole('button', { name: '继续', exact: true }).tap();
  await page.screenshot({ path: info.outputPath('phone-timer.png') });
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));
  expect(stored.timelog.timer).toBeNull();
  expect(stored.timelog.records.filter((r: { id: string }) => r.id === timerId)).toHaveLength(1);
  const saved = stored.timelog.records.find((record: { id: string }) => record.id === timerId);
  await expect(page.locator('.record-card').filter({ hasText: '手机端计时验收' })).toHaveCount(
    saved.spans.length,
  );
  await page.getByRole('button', { name: '手机统计', exact: true }).tap();
  await page.getByRole('tab', { name: '记录', exact: true }).tap();
  await expect(page.getByRole('img', { name: '24小时活动分布' })).toHaveCount(0);
  await expect(page.locator('.phone-analysis')).toBeVisible();
  await expect(page.locator('.toast')).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('phone-analysis.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('rejected operations allow subsequent saves and analytics retain historical nature', async ({
  page,
}) => {
  await seed(page);
  const rejection = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { store } = await import(path);
    try {
      await store.transact(() => {
        throw new Error('模拟过短计时');
      });
    } catch (error) {
      return String(error);
    }
  });
  expect(rejection).toContain('模拟过短计时');
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { store } = await import(path);
    await store.transact((state: ReturnType<typeof emptyState>) => ({
      ...state,
      timelog: {
        ...state.timelog,
        activities: state.timelog.activities.map((activity) =>
          activity.id === 'study'
            ? { ...activity, nature: 'negative', pointsPerHour: -20 }
            : activity,
        ),
      },
    }));
  });
  await page.getByRole('button', { name: '新建任务', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: '新建任务' });
  await page.setViewportSize({ width: 390, height: 500 });
  await sheet.getByLabel('新任务标题').fill('正常保存不被上次错误阻止');
  const save = sheet.getByRole('button', { name: '添加任务', exact: true });
  const bounds = (await save.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
  await save.tap();
  await expect(sheet).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '手机统计', exact: true }).tap();
  await page.getByRole('tab', { name: '记录', exact: true }).tap();
  await expect(page.getByRole('img', { name: '积极活动占比 100%' })).toBeVisible();
});

test('light, system theme, 360px goals and desktop breakpoint remain usable', async ({
  page,
}, info) => {
  await seed(page);
  await page.getByRole('button', { name: '打开导航' }).tap();
  await page.getByRole('button', { name: '设置与同步', exact: true }).tap();
  await page.getByRole('button', { name: '浅色', exact: true }).tap();
  await page.getByRole('button', { name: '关闭设置' }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: info.outputPath('phone-tasks-light.png') });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await page.getByRole('tab', { name: '目标', exact: true }).tap();
  await expect(page.locator('.goal-card')).toContainText('每天读一点');
  await page.screenshot({ path: info.outputPath('phone-goals.png') });
  await page.getByRole('button', { name: '手机安排', exact: true }).tap();
  await page.getByRole('tab', { name: '课程表' }).tap();
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '打开导航' }).tap();
  await page.getByRole('button', { name: '设置与同步', exact: true }).tap();
  await page.getByRole('button', { name: '跟随系统', exact: true }).tap();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '关闭设置' }).tap();
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(page.locator('[data-layout="desktop"]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '课程表', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
});
