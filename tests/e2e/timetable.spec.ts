import { test, expect, type Page } from '@playwright/test';
import { emptyState } from '../../src/model';
import { setTimeZone, zoneDateKey, shiftDay, weekday, wallTime } from '../../src/timezone';

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
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
  return state;
}

async function courseMenu(page: Page) {
  await page.getByRole('button', { name: '课程操作', exact: true }).click();
  return page.getByRole('dialog', { name: '课程操作', exact: true });
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
    await expect(page.getByRole('button', { name: '课程操作', exact: true })).toBeEnabled();
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
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '预览导入课程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '课程操作', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('dayweave.v1'))).toBe(before);
});

test('shared lanes preserve short-first course ordering and restore full width for adjacent courses', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    await store.transact((state: import('../../src/model').AppState) => ({
      ...state,
      schedule: {
        ...state.schedule,
        courses: [
          { ...state.schedule.courses[0], id: 'long', name: '长课', start: '08:00', end: '10:00' },
          { ...state.schedule.courses[0], id: 'short', name: '短课', start: '08:00', end: '09:00' },
          {
            ...state.schedule.courses[0],
            id: 'later',
            name: '后续课程',
            start: '10:00',
            end: '11:00',
          },
        ],
      },
    }));
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const short = (await page
      .getByRole('button', { name: '编辑课程 短课', exact: true })
      .boundingBox())!;
    const long = (await page
      .getByRole('button', { name: '编辑课程 长课', exact: true })
      .boundingBox())!;
    const later = (await page
      .getByRole('button', { name: '编辑课程 后续课程', exact: true })
      .boundingBox())!;
    expect(short.x).toBeLessThan(long.x);
    expect(Math.abs(short.width - long.width)).toBeLessThan(1);
    expect(later.width).toBeGreaterThan(short.width * 1.8);
    expect(short.y).toBeCloseTo(long.y, 0);
    expect(short.height).toBeLessThan(long.height);
  }
});

test('phone timetable keeps a real week grid; empty slot selection creates through the shared course editor', async ({
  page,
}) => {
  await seed(page);
  const timetable = page.locator('.timetable-grid-view');
  await expect(timetable.locator('.next-class')).toHaveCount(0);
  await expect(timetable.getByRole('button', { name: '导出课程表', exact: true })).toHaveCount(0);
  await expect(timetable.locator('.timetable-day-heading')).toHaveCount(5);
  await expect(page.locator('.phone-fab')).toHaveCount(1);
  const slot = timetable.locator('.timetable-empty-slot[data-weekday="2"][data-period="3"]');
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await slot.click();
  const editor = page.getByRole('dialog', { name: '添加课程', exact: true });
  await expect(editor).toHaveClass(/phone-sheet/);
  await expect(editor.getByLabel('上课星期')).toHaveValue('2');
  await expect(editor.getByLabel('上课时间', { exact: true })).toHaveValue('09:55');
  await expect(editor.getByLabel('下课时间', { exact: true })).toHaveValue('10:40');
  await editor.getByLabel('课程名称').fill('应用化学专题');
  await editor.getByLabel('教室 / 地点').fill('H2105A');
  await editor.getByRole('button', { name: '单周', exact: true }).click();
  await expect(editor.getByRole('button', { name: '第 1 教学周', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(editor.getByRole('button', { name: '第 2 教学周', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  const created = timetable.getByRole('button', { name: '编辑课程 应用化学专题', exact: true }),
    original = timetable.getByRole('button', { name: '编辑课程 量子化学', exact: true });
  await expect(created).toBeVisible();
  expect((await created.boundingBox())!.y).toBeGreaterThan((await original.boundingBox())!.y);
  await created.click();
  const editing = page.getByRole('dialog', { name: '编辑课程', exact: true });
  await expect(editing.getByLabel('课程名称')).toHaveValue('应用化学专题');
  await editing.getByLabel('上课时间', { exact: true }).fill('10:00');
  await editing.getByLabel('下课时间', { exact: true }).fill('10:50');
  await editing.getByRole('button', { name: '保存课程', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: '编辑课程 应用化学专题', exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dayweave.v1')!).schedule.courses.find(
      (item: { name: string }) => item.name === '应用化学专题',
    ),
  );
  expect(saved).toMatchObject({
    weekday: 2,
    start: '10:00',
    end: '10:50',
    weeks: [1, 3, 5, 7, 9, 11],
  });
  await page.getByRole('button', { name: '编辑课程 应用化学专题', exact: true }).click();
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '编辑课程 应用化学专题', exact: true }),
  ).toHaveCount(0);
  await timetable.getByRole('button', { name: '下一周', exact: true }).click();
  await expect(timetable.getByRole('button', { name: '回到本周', exact: true })).toContainText(
    '第 2 周',
  );
  await timetable.getByRole('button', { name: '回到本周', exact: true }).click();
  await expect(timetable.getByRole('button', { name: '回到本周', exact: true })).toContainText(
    '第 1 周',
  );
});

test('period ruler opens one section editor; changing periods preserves real course times and seeds later additions', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: '第 1 节，打开节次设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '节次设置', exact: true });
  await expect(dialog.getByRole('group', { name: '上午', exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: '下午', exact: true })).toBeAttached();
  await expect(dialog.getByRole('group', { name: '晚上', exact: true })).toBeAttached();
  await dialog.getByLabel('第 1 节上课时间', { exact: true }).fill('08:05');
  await dialog.getByLabel('第 1 节下课时间', { exact: true }).fill('08:50');
  await dialog.getByRole('button', { name: '增加上午节次', exact: true }).click();
  await expect(dialog.getByRole('group', { name: '上午', exact: true })).toContainText('6 节');
  await dialog.getByRole('button', { name: '保存节次', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));
  expect(state.schedule.periods).toHaveLength(14);
  expect(state.schedule.periods[0]).toMatchObject({
    start: '08:05',
    end: '08:50',
    section: 'morning',
  });
  expect(state.schedule.courses[0]).toMatchObject({ start: '08:00', end: '09:40' });
  const slot = page.locator('.timetable-empty-slot[data-weekday="2"][data-period="1"]');
  await slot.click();
  await slot.click();
  await expect(page.getByLabel('上课时间', { exact: true })).toHaveValue('08:05');
  await expect(page.getByLabel('下课时间', { exact: true })).toHaveValue('08:50');
  await page.getByRole('button', { name: '关闭添加课程', exact: true }).click();
  await page.reload();
  await expect(page.locator('.timetable-ruler .timetable-period')).toHaveCount(14);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const grid = page.getByRole('region', { name: '每周课程表' });
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await expect(page.getByRole('tab', { name: '课程表', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const last = page.locator('.timetable-day-heading').last();
  const bounds = (await grid.boundingBox())!,
    day = (await last.boundingBox())!;
  expect(day.x + day.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
});

test('five and seven day preferences fit all phone widths without horizontal scrolling and survive reload', async ({
  page,
}) => {
  await seed(page);
  for (const displayDays of ['auto', '7', '5']) {
    const menu = await courseMenu(page);
    await menu.locator('summary').click();
    await menu.getByRole('button', { name: '学期与时区', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '学期与时区', exact: true });
    await settings.getByLabel('课表显示天数').selectOption(displayDays);
    await settings.getByRole('button', { name: '保存学期', exact: true }).click();
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const grid = page.getByRole('region', { name: '每周课程表' });
      await expect(page.locator('.timetable-day-heading')).toHaveCount(displayDays === '7' ? 7 : 5);
      expect(
        await grid.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBeTruthy();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBeTruthy();
      const bounds = (await grid.boundingBox())!,
        finalDay = (await page.locator('.timetable-day-heading').last().boundingBox())!;
      expect(finalDay.x + finalDay.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(finalDay.width).toBeGreaterThan(35);
      if (width === 390 && displayDays !== 'auto')
        await page.screenshot({
          path: `release/phone-preview-0.4.1/timetable-${displayDays}-days.png`,
        });
    }
  }
  await page.reload();
  await expect(page.locator('.timetable-day-heading')).toHaveCount(5);
  const menu = await courseMenu(page);
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: '学期与时区', exact: true }).click();
  await expect(page.getByLabel('课表显示天数')).toHaveValue('5');
});

test('automatic mode includes future weekend teaching, while a fixed five-day view preserves those courses', async ({
  page,
}) => {
  await seed(page, false, true);
  await expect(page.locator('.timetable-day-heading')).toHaveCount(7);
  await expect(page.getByRole('button', { name: '编辑课程 周末实验', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '下一周', exact: true }).click();
  const weekend = page.getByRole('button', { name: '编辑课程 周末实验', exact: true });
  await expect(weekend).toBeVisible();
  const grid = page.getByRole('region', { name: '每周课程表' });
  const bounds = (await grid.boundingBox())!,
    course = (await weekend.boundingBox())!;
  expect(course.x + course.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  let menu = await courseMenu(page);
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: '学期与时区', exact: true }).click();
  await page.getByLabel('课表显示天数').selectOption('5');
  await page.getByRole('button', { name: '保存学期', exact: true }).click();
  await expect(page.locator('.timetable-day-heading')).toHaveCount(5);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dayweave.v1')!).schedule.courses.length,
    ),
  ).toBe(2);
  menu = await courseMenu(page);
  await menu.locator('summary').click();
  await menu.getByRole('button', { name: '学期与时区', exact: true }).click();
  await page.getByLabel('课表显示天数').selectOption('auto');
  await page.getByRole('button', { name: '保存学期', exact: true }).click();
  await expect(page.locator('.timetable-day-heading')).toHaveCount(7);
  await expect(weekend).toBeVisible();
  await weekend.click();
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await expect(page.locator('.timetable-day-heading')).toHaveCount(5);
});

test('imported single occurrences use the same editor and retain untouched epoch precision', async ({
  page,
}) => {
  const original = await seed(page, true);
  await page.getByRole('button', { name: '编辑课程 一次实验安排', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑课程', exact: true });
  await expect(editor.getByLabel('课程名称')).toHaveValue('一次实验安排');
  await expect(editor.getByRole('group', { name: '上课周数', exact: true })).toHaveCount(0);
  await editor.getByLabel('教室 / 地点').fill('实验楼 302');
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dayweave.v1')!).schedule.events[0],
  );
  expect(saved).toMatchObject({
    start: original.schedule.events[0].start,
    end: original.schedule.events[0].end,
    location: '实验楼 302',
  });
  await page.getByRole('button', { name: '编辑课程 一次实验安排', exact: true }).click();
  await page.getByRole('button', { name: '删除课程', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '编辑课程 一次实验安排', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑课程 量子化学', exact: true })).toHaveCount(1);
});

test('course actions keep imports and settings in one add menu; repeated file imports do not duplicate courses', async ({
  page,
}) => {
  await seed(page);
  const menu = await courseMenu(page);
  await expect(menu.getByRole('button', { name: /网站导入/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /文件导入/ })).toBeVisible();
  await menu.locator('summary').click();
  await expect(menu.getByRole('button', { name: '学期与时区', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭课程操作', exact: true }).click();
  const content =
    '课程名称,星期,开始时间,结束时间,周次,教室,教师\n物理化学,3,13:30,15:10,1-12,H3304,乔老师\n';
  for (let index = 0; index < 2; index++) {
    const actions = await courseMenu(page);
    const chooser = page.waitForEvent('filechooser');
    await actions.getByRole('button', { name: /文件导入/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'courses.csv', mimeType: 'text/csv', buffer: Buffer.from(content) });
    const preview = page.getByRole('dialog', { name: '预览导入课程', exact: true });
    await expect(preview).toContainText('物理化学');
    await preview.getByRole('button', { name: '合并导入', exact: true }).click();
    await expect(page.getByRole('button', { name: '编辑课程 物理化学', exact: true })).toHaveCount(
      1,
    );
  }
  const count = await page.evaluate(
    () => JSON.parse(localStorage.getItem('dayweave.v1')!).schedule.courses.length,
  );
  expect(count).toBe(2);
});
