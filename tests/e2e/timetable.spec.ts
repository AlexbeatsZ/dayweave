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

test('event week shows five mobile days with horizontally accessible weekends', async ({
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
    const grid = page.locator('.arrangement-week-scroll');
    const sizing = await grid.evaluate((node) => ({
      width: node.clientWidth,
      content: node.scrollWidth,
      day: node
        .querySelector('.arrangement-day:not(.arrangement-period-column)')!
        .getBoundingClientRect().width,
      ruler: node.querySelector('.arrangement-period-column')!.getBoundingClientRect().width,
    }));
    expect(sizing.day).toBeCloseTo((sizing.width - sizing.ruler) / (width <= 700 ? 5 : 7), 0);
    expect(sizing.content > sizing.width).toBe(width <= 700);
    await expect(page.getByRole('region', { name: '节次标尺' })).toBeVisible();
    await expect(page.locator('.timetable-period')).toHaveCount(13);
    await page.screenshot({ path: `.local/preview/arrangements/events-week-${width}.png` });
  }
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(page.locator('.arrangement-event').filter({ hasText: '周末实验' })).toBeVisible();
});

test('original period settings move the shared ruler without changing Event data', async ({
  page,
}) => {
  await seed(page, true);
  const eventsBefore = await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { store } = await import(path);
    return store.get().calendarEvents;
  });
  await page.getByRole('button', { name: '第 1 节，打开节次设置', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '节次设置', exact: true });
  await editor.getByLabel('第 1 节上课时间', { exact: true }).fill('07:20');
  await editor.getByLabel('第 1 节下课时间', { exact: true }).fill('08:05');
  await editor.getByRole('button', { name: '保存节次', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const first = page.getByRole('button', { name: '第 1 节，打开节次设置', exact: true });
  await expect(first).toContainText('07:20');
  const ruler = (await first.boundingBox())!;
  const course = (await page
    .getByRole('button', { name: '编辑日程 量子化学', exact: true })
    .boundingBox())!;
  expect(course.y - ruler.y).toBeCloseTo(40 * 1.35, 0);
  expect(ruler.height).toBeCloseTo(45 * 1.35, 0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).calendarEvents),
  ).toEqual(eventsBefore);
  await page.reload();
  await expect(first).toContainText('07:20');
  await page.getByRole('button', { name: '编辑日程 量子化学', exact: true }).click();
  await page.getByLabel('日程标题').fill('一项需要省略显示的很长很长的课程名称');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const title = page.locator('.arrangement-timed-event strong').filter({ hasText: '一项需要省略' });
  expect(
    await title.evaluate((node) => ({
      overflow: getComputedStyle(node).textOverflow,
      wrapping: getComputedStyle(node).whiteSpace,
      clipped: node.scrollWidth > node.clientWidth,
    })),
  ).toEqual({ overflow: 'ellipsis', wrapping: 'nowrap', clipped: true });
  await title.click();
  await expect(page.getByLabel('日程标题')).toHaveValue('一项需要省略显示的很长很长的课程名称');
});

test('mobile week swipes horizontally with a pinned ruler, uniform backgrounds and editable card accents', async ({
  page,
}) => {
  await seed(page, true, true);
  const scroll = page.locator('.arrangement-week-scroll');
  const ruler = page.getByRole('region', { name: '节次标尺', exact: true });
  const initialRuler = (await ruler.boundingBox())!;
  const initialDay = (await page.locator('.arrangement-day-heading').first().boundingBox())!;
  const viewport = (await scroll.boundingBox())!;
  const gesture = await page.context().newCDPSession(page);
  async function swipe(from: number, to: number) {
    const y = viewport.y + 130;
    await gesture.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y }],
    });
    for (let step = 1; step <= 6; step++) {
      await gesture.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from + ((to - from) * step) / 6, y }],
      });
    }
    await gesture.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await swipe(viewport.x + viewport.width - 20, viewport.x + 65);
  await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(50);
  expect(Math.abs((await ruler.boundingBox())!.x - initialRuler.x)).toBeLessThan(1);
  expect((await page.locator('.arrangement-day-heading').first().boundingBox())!.x).toBeLessThan(
    initialDay.x - 50,
  );
  await expect(page.getByRole('region', { name: '日程安排', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/preview/arrangements/events-week-scrolled-390.png' });
  const shifted = await scroll.evaluate((node) => node.scrollLeft);
  await swipe(viewport.x + 65, viewport.x + viewport.width - 20);
  await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeLessThan(shifted);
  await gesture.detach();
  await scroll.evaluate((node) => {
    node.scrollLeft = 0;
  });
  const canvas = await page
    .locator('.phone-shell')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const backgrounds = await page
    .locator(
      '.arrangement-day, .arrangement-day-heading, .timetable-period, .timetable-corner, .arrangement-event',
    )
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(backgrounds.every((background) => background === canvas)).toBe(true);
  await page.getByRole('button', { name: '编辑日程 量子化学', exact: true }).click();
  await page.getByLabel('自定义顶部标记颜色', { exact: true }).fill('#bc6466');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const card = page.getByRole('button', { name: '编辑日程 量子化学', exact: true });
  await expect(card).toHaveCSS('border-top-color', 'rgb(188, 100, 102)');
  await expect(card).toHaveCSS('background-color', canvas);
  const change = page.getByRole('button', { name: '切换到待办', exact: true });
  expect((await change.boundingBox())!.x).toBeLessThan(
    (await page.getByRole('button', { name: '本周', exact: true }).boundingBox())!.x,
  );
  await change.click();
  await page.getByRole('tab', { name: '周视图', exact: true }).click();
  await expect(page.getByRole('region', { name: '待办安排', exact: true })).toBeVisible();
  expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '切换到日程', exact: true }).click();
  await expect(card).toHaveCSS('border-top-color', 'rgb(188, 100, 102)');
  await page.locator('.phone-content').evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  await page.screenshot({ path: '.local/preview/arrangements/events-mobile-five-days-390.png' });
  await page.evaluate(async () => {
    const path = '/src/store.ts';
    const { store } = await import(path);
    store.update((state: ReturnType<typeof store.get>) => ({
      ...state,
      settings: { ...state.settings, theme: 'light' },
    }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightCanvas = await page
    .locator('.phone-shell')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const lightBackgrounds = await page
    .locator(
      '.arrangement-day, .arrangement-day-heading, .timetable-period, .timetable-corner, .arrangement-event',
    )
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(lightBackgrounds.every((background) => background === lightCanvas)).toBe(true);
  await expect(card).toHaveCSS('border-top-color', 'rgb(188, 100, 102)');
  await page.screenshot({ path: '.local/preview/arrangements/events-mobile-light-390.png' });
});

test('event cards align by real time and duration beneath a shared all-day row', async ({
  page,
}) => {
  const initial = await seed(page);
  await page.evaluate(async (monday) => {
    const storePath = '/src/store.ts',
      domainPath = '/src/event-domain.ts',
      zonePath = '/src/timezone.ts';
    const { store } = await import(storePath);
    const { newEvent } = await import(domainPath);
    const { shiftDay } = await import(zonePath);
    store.update((state: typeof initial) => ({
      ...state,
      calendarEvents: [
        ...state.calendarEvents,
        newEvent({
          title: '实验展示',
          date: shiftDay(monday, 1),
          periods: [
            ['08:00', '08:45'],
            ['08:55', '09:40'],
          ],
        }),
        newEvent({ title: '短会', date: shiftDay(monday, 2), periods: [['08:00', '08:50']] }),
        newEvent({ title: '稍后会议', date: shiftDay(monday, 1), periods: [['10:00', '10:30']] }),
        newEvent({
          title: '跨时区会议',
          date: shiftDay(monday, 3),
          timeZone: 'UTC',
          periods: [['00:00', '01:00']],
        }),
        newEvent({ title: '全天学术活动', date: monday, allDay: true }),
        newEvent({ title: '全天考试准备与材料整理', date: shiftDay(monday, 3), allDay: true }),
      ],
    }));
  }, initial.schedule.semesterStart);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.arrangement-time-column')).toHaveCount(width <= 700 ? 7 : 5);
    // Read one layout snapshot so responsive navigation cannot move the page between measurements.
    const cards = await page
      .locator('.arrangement-timed-event .arrangement-event')
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [
            node.getAttribute('aria-label')!.replace('编辑日程 ', ''),
            node.getBoundingClientRect().toJSON(),
          ]),
        ),
      );
    const course = cards['量子化学'],
      multi = cards['实验展示'];
    const short = cards['短会'],
      later = cards['稍后会议'],
      foreign = cards['跨时区会议'];
    expect(Math.abs(course.y - multi.y)).toBeLessThan(1);
    expect(Math.abs(multi.y - short.y)).toBeLessThan(1);
    expect(Math.abs(foreign.y - short.y)).toBeLessThan(1);
    expect(Math.abs(multi.height - course.height)).toBeLessThan(1);
    expect(multi.height / short.height).toBeCloseTo(2, 1);
    expect(later.y - multi.y).toBeCloseTo(120 * 1.35, 0);
    expect(later.height).toBeCloseTo(30 * 1.35, 0);
    const tops = await page
      .locator('.arrangement-time-column')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    await page.screenshot({ path: `.local/preview/arrangements/events-time-aligned-${width}.png` });
  }
});

test('cross-day and overlapping Events retain clipped time positions and independent lanes', async ({
  page,
}) => {
  const initial = await seed(page);
  await page.evaluate(async (monday) => {
    const storePath = '/src/store.ts',
      domainPath = '/src/event-domain.ts',
      zonePath = '/src/timezone.ts';
    const { store } = await import(storePath);
    const { newEvent } = await import(domainPath);
    const { shiftDay } = await import(zonePath);
    store.update((state: typeof initial) => ({
      ...state,
      calendarEvents: [
        ...state.calendarEvents,
        newEvent({
          title: '跨夜实验',
          date: monday,
          durationDays: 2,
          periods: [['23:00', '01:00']],
        }),
        newEvent({ title: '重叠会议', date: shiftDay(monday, 1), periods: [['00:30', '01:30']] }),
        newEvent({ title: '相接会议', date: shiftDay(monday, 1), periods: [['01:30', '02:00']] }),
      ],
    }));
  }, initial.schedule.semesterStart);
  const cards = page.getByRole('button', { name: '编辑日程 跨夜实验', exact: true });
  await expect(cards).toHaveCount(2);
  const monday = (await cards.nth(0).boundingBox())!,
    tuesday = (await cards.nth(1).boundingBox())!;
  expect(monday.y - tuesday.y).toBeCloseTo(23 * 60 * 1.35, 0);
  expect(monday.height).toBeCloseTo(60 * 1.35, 0);
  expect(tuesday.height).toBeCloseTo(monday.height, 0);
  const overlap = (await page
    .getByRole('button', { name: '编辑日程 重叠会议', exact: true })
    .boundingBox())!;
  const adjacent = (await page
    .getByRole('button', { name: '编辑日程 相接会议', exact: true })
    .boundingBox())!;
  expect(overlap.x).toBeGreaterThan(tuesday.x + tuesday.width);
  expect(adjacent.width).toBeGreaterThan(overlap.width * 1.8);
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
  await page.getByRole('button', { name: '切换到待办', exact: true }).click();
  await page.getByRole('tab', { name: '周视图', exact: true }).click();
  await page.locator('.arrangement-day-add').first().click();
  await page.getByLabel('新任务标题').fill('独立待办');
  await page.getByLabel('任务优先级').selectOption('3');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.locator('.week-task')).toContainText('独立待办');
  await page.screenshot({ path: '.local/preview/arrangements/tasks-week-390.png' });
  await expect(page.locator('.arrangement-event')).toHaveCount(0);
  await page.getByRole('button', { name: '切换到日程', exact: true }).click();
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
  await page.getByRole('button', { name: '切换到待办', exact: true }).click();
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
