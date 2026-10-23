import { test, expect, type Locator, type Page } from '@playwright/test';
import { emptyState, newTask, type AppState } from '../../src/model';
import { dayKey, dayStart, shiftDay } from '../../src/timelog/domain';
import { setTimeZone } from '../../src/timezone';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/New_York',
});

/** Every test owns a fresh browser context; no device or desktop profile is used. */
async function seed(page: Page) {
  setTimeZone('Asia/Shanghai');
  const today = dayKey(Date.now()),
    start = dayStart(today),
    old = shiftDay(today, -8),
    state = emptyState();
  state.settings.theme = 'dark';
  state.lists.push(
    { id: 'study-list', name: '学习', color: '#4264b2', order: 1 },
    { id: 'work-list', name: '工作', color: '#bb6475', order: 2 },
    { id: 'life-list', name: '生活', color: '#b18a32', order: 3 },
  );
  state.tasks = [
    newTask('学习计划', {
      id: 'study-task',
      due: today,
      listId: 'study-list',
      order: 10,
      tags: ['旧分类'],
      priority: 2,
    }),
    newTask('工作计划', {
      id: 'work-task',
      due: today,
      listId: 'work-list',
      order: 20,
      priority: 1,
    }),
    newTask('生活计划', {
      id: 'life-task',
      due: today,
      listId: 'life-list',
      order: 30,
    }),
    newTask('未排期学习', { id: 'undated-study', listId: 'study-list', order: 40 }),
    newTask('未排期工作', { id: 'undated-work', listId: 'work-list', order: 50 }),
    newTask('历史已完成', {
      id: 'completed-task',
      listId: 'study-list',
      due: old,
      completedAt: new Date(dayStart(old) + 3600000).toISOString(),
      tags: ['旧分类'],
      order: 60,
    }),
    newTask('已删除但保留内容', {
      id: 'deleted-task',
      listId: 'work-list',
      due: old,
      deletedAt: new Date(start).toISOString(),
      tags: ['旧分类'],
      order: 70,
    }),
  ];
  // Only 学习 exists: starting 工作 / 生活 must create 实操 / 日常 without duplicates.
  state.timelog.activities = state.timelog.activities.filter((activity) => activity.id === 'study');
  state.timelog.records = [
    {
      id: 'record-alive',
      activityId: 'study',
      note: '保留原始记录内容',
      tags: ['旧分类'],
      spans: [{ start, end: start + 1800000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 1800000,
    },
    {
      id: 'record-deleted',
      activityId: 'study',
      note: '保留删除标记的记录内容',
      tags: ['旧分类'],
      spans: [{ start: start + 3600000, end: start + 5400000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: start + 6000000,
      updatedAt: start + 6000000,
    },
  ];
  state.tagColors = { tasks: { 旧分类: '#b18a32' }, records: { 旧分类: '#9671a5' } };
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '手机底部导航' })).toBeVisible();
  return today;
}

const state = (page: Page): Promise<AppState> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));
const rows = (page: Page) => page.locator('.phone-content .task-row');
const row = (page: Page, title: string) =>
  rows(page).filter({ has: page.getByRole('button', { name: `编辑 ${title}`, exact: true }) });

async function back(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('clearlist:back', { cancelable: true })),
  );
}

async function longDrag(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!,
    to = (await target.boundingBox())!,
    session = await page.context().newCDPSession(page),
    start = { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    end = { x: to.x + to.width / 2, y: to.y + to.height / 2 + 3 };
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    // Intentional hold exercises the real long-press gesture, not an HTML drag shortcut.
    await page.waitForTimeout(500);
    await expect(page.locator('body')).toHaveClass(/\btask-sort-active\b/);
    await expect(page.locator('.task-sort-ghost')).toBeVisible();
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 8,
            y: start.y + ((end.y - start.y) * step) / 8,
          },
        ],
      });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test('inbox collects undated tasks across lists and creation / editing reuse the task sheet', async ({
  page,
}) => {
  const today = await seed(page);
  await page.getByRole('tab', { name: /^待办箱/ }).tap();
  await expect(rows(page).locator('.task-title')).toHaveText(['未排期学习', '未排期工作']);
  await expect(row(page, '未排期学习').locator('.list-meta')).toHaveText('学习');
  await expect(row(page, '未排期工作').locator('.list-meta')).toHaveText('工作');
  await page.getByRole('button', { name: '新建任务', exact: true }).tap();
  const create = page.getByRole('dialog', { name: '新建任务', exact: true });
  await expect(create.locator('.phone-task-form')).toBeVisible();
  await create.getByRole('button', { name: '工作', exact: true }).tap();
  await create.getByLabel('新任务标题').fill('新收纳的工作');
  await create.getByLabel('新任务描述').fill('先收集，再决定计划日期');
  await create.getByRole('button', { name: '无日期', exact: true }).tap();
  await create.getByRole('button', { name: '添加任务', exact: true }).tap();
  await expect(create).not.toBeVisible();
  await expect(row(page, '新收纳的工作')).toBeVisible();
  const created = (await state(page)).tasks.find((task) => task.title === '新收纳的工作')!;
  expect(created.listId).toBe('work-list');
  expect(created.due).toBeNull();

  await page.getByRole('button', { name: '编辑 新收纳的工作', exact: true }).tap();
  const edit = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await expect(edit.locator('.phone-task-form')).toBeVisible();
  await expect(edit.getByLabel('任务备注')).toHaveValue('先收集，再决定计划日期');
  await expect(edit.getByRole('button', { name: '工作', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await edit.getByLabel('计划日期').fill(today);
  await edit.getByLabel('添加子任务').fill('先整理材料');
  await edit.getByRole('button', { name: '加入子任务' }).tap();
  await edit.getByRole('button', { name: '保存任务', exact: true }).tap();
  await expect(edit).not.toBeVisible();
  await expect(row(page, '新收纳的工作')).toHaveCount(0);
  await page.getByRole('tab', { name: '日计划', exact: true }).tap();
  await expect(row(page, '新收纳的工作')).toBeVisible();
  const updated = (await state(page)).tasks.find((task) => task.id === created.id)!;
  expect(updated).toMatchObject({ due: today, listId: 'work-list', notes: created.notes });
  expect(updated.subtasks.map((task) => task.title)).toEqual(['先整理材料']);
  await page.reload();
  await expect(row(page, '新收纳的工作')).toBeVisible();
});

test('long press reorders the visible priority numbers and completed plans sink only in day / week views', async ({
  page,
}) => {
  await seed(page);
  await expect(rows(page).locator('.task-check')).toHaveText(['1', '2', '3']);
  await longDrag(
    page,
    row(page, '学习计划').locator('.task-body'),
    row(page, '生活计划').locator('.task-body'),
  );
  await expect(rows(page).locator('.task-title')).toHaveText(['工作计划', '生活计划', '学习计划']);
  await expect(rows(page).locator('.task-check')).toHaveText(['1', '2', '3']);
  await page.reload();
  await expect(rows(page).locator('.task-title')).toHaveText(['工作计划', '生活计划', '学习计划']);
  await page.getByRole('checkbox', { name: '完成 工作计划', exact: true }).tap();
  await expect(rows(page).locator('.task-title')).toHaveText(['生活计划', '学习计划', '工作计划']);
  await expect(
    rows(page)
      .filter({ hasNot: page.locator('.task-check.checked') })
      .locator('.task-check'),
  ).toHaveText(['1', '2']);
  const completed = row(page, '工作计划');
  await expect(completed).toHaveClass(/\bdone\b/);
  await expect(completed.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(completed.locator('.task-check svg')).toHaveCount(1);
  await expect(completed.locator('.task-title')).toHaveCSS('text-decoration-line', 'line-through');
  expect(
    await completed.locator('.task-title').evaluate((element) => getComputedStyle(element).color),
  ).not.toBe(
    await row(page, '生活计划')
      .locator('.task-title')
      .evaluate((element) => getComputedStyle(element).color),
  );
  await page.getByRole('tab', { name: '周计划', exact: true }).tap();
  await expect(rows(page).last().locator('.task-title')).toHaveText('工作计划');
  await page.getByRole('tab', { name: /^全部/ }).tap();
  await expect(row(page, '工作计划')).toHaveCount(0);
  await expect(rows(page).locator('.task-check')).toHaveText(['1', '2', '3', '4']);
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page
    .getByRole('dialog', { name: '待办', exact: true })
    .getByRole('button', { name: /^工作\s*1$/, exact: true })
    .tap();
  await expect(row(page, '工作计划')).toHaveCount(0);
  await expect(rows(page).locator('.task-title')).toHaveText(['未排期工作']);
  await expect(rows(page).locator('.task-check')).toHaveText(['1']);
});

test('list colors and configurable activity mappings persist while default work / life activities are created once', async ({
  page,
}) => {
  test.setTimeout(60000);
  await seed(page);
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '新增所属清单', exact: true }).tap();
  const create = page.getByRole('dialog', { name: '新的清单', exact: true });
  await create.getByLabel('清单名称').fill('随手记录');
  await create.getByLabel('自定义清单颜色').fill('#37b9aa');
  await create.getByLabel('清单计时活动').selectOption('study');
  await create.getByRole('button', { name: '创建清单', exact: true }).tap();
  await page.getByRole('button', { name: '编辑清单 随手记录', exact: true }).tap();
  const edit = page.getByRole('dialog', { name: '编辑清单', exact: true });
  await expect(edit.getByLabel('自定义清单颜色')).toHaveValue('#37b9aa');
  await expect(edit.getByLabel('清单计时活动')).toHaveValue('study');
  await edit.getByLabel('自定义清单颜色').fill('#e28c54');
  await edit.getByRole('button', { name: '保存清单', exact: true }).tap();
  await back(page);
  await page.reload();
  expect((await state(page)).lists.find((list) => list.name === '随手记录')).toMatchObject({
    color: '#e28c54',
    activityId: 'study',
  });

  for (const [title, taskId, name] of [
    ['学习计划', 'study-task', '学习'],
    ['工作计划', 'work-task', '实操'],
    ['生活计划', 'life-task', '日常'],
    ['工作计划', 'work-task', '实操'],
  ]) {
    await page.getByRole('button', { name: `计时 ${title}`, exact: true }).tap();
    await expect.poll(async () => (await state(page)).timelog.timer?.taskId).toBe(taskId);
    const current = await state(page),
      timer = current.timelog.timer!;
    expect(
      current.timelog.activities.find((activity) => activity.id === timer.activityId)?.name,
    ).toBe(name);
    expect(current.timelog.activities.filter((activity) => activity.name === name)).toHaveLength(1);
    await page.getByRole('button', { name: '取消', exact: true }).tap();
    await page.getByRole('button', { name: '手机待办', exact: true }).tap();
  }
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '编辑清单 工作', exact: true }).tap();
  const mapping = page.getByRole('dialog', { name: '编辑清单', exact: true });
  await mapping.getByLabel('清单计时活动').selectOption('study');
  await mapping.getByLabel('自定义清单颜色').fill('#af79dd');
  await mapping.getByRole('button', { name: '保存清单', exact: true }).tap();
  await back(page);
  await expect(row(page, '工作计划').locator('.task-check')).toHaveCSS(
    'border-color',
    'rgb(175, 121, 221)',
  );
  await page.getByRole('button', { name: '计时 工作计划', exact: true }).tap();
  await expect.poll(async () => (await state(page)).timelog.timer?.activityId).toBe('study');
  await page.reload();
  const persisted = await state(page);
  expect(persisted.lists.find((list) => list.id === 'work-list')).toMatchObject({
    activityId: 'study',
    color: '#af79dd',
  });
  expect(persisted.timelog.timer).toMatchObject({ activityId: 'study', taskId: 'work-task' });
});

test('task / activity tag colors can be created without content, survive reload and deletion removes all tag references', async ({
  page,
}) => {
  test.setTimeout(60000);
  await seed(page);
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '新增待办标签', exact: true }).tap();
  const taskTag = page.getByRole('dialog', { name: '新增待办标签', exact: true });
  await taskTag.getByLabel('标签名称').fill('独立标签');
  await taskTag.getByLabel('自定义标签颜色').fill('#39babc');
  await taskTag.getByRole('button', { name: '添加标签', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: '编辑待办标签 独立标签', exact: true }),
  ).toBeVisible();
  await back(page);
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '新增活动标签', exact: true }).tap();
  const recordTag = page.getByRole('dialog', { name: '新增活动标签', exact: true });
  await recordTag.getByLabel('标签名称').fill('独立标签');
  await recordTag.getByLabel('自定义标签颜色').fill('#e69b4c');
  await recordTag.getByRole('button', { name: '添加标签', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: '编辑活动标签 独立标签', exact: true }),
  ).toBeVisible();
  await back(page);
  await page.reload();
  const colors = (await state(page)).tagColors;
  expect(colors.tasks['独立标签']).toBe('#39babc');
  expect(colors.records['独立标签']).toBe('#e69b4c');
  expect((await state(page)).tasks.every((task) => !task.tags.includes('独立标签'))).toBe(true);
  expect(
    (await state(page)).timelog.records.every((record) => !record.tags.includes('独立标签')),
  ).toBe(true);
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '编辑待办标签 独立标签', exact: true }).tap();
  const edit = page.getByRole('dialog', { name: '编辑待办标签', exact: true });
  await expect(edit.getByLabel('自定义标签颜色')).toHaveValue('#39babc');
  await edit.getByLabel('自定义标签颜色').fill('#769fed');
  await edit.getByRole('button', { name: '保存标签', exact: true }).tap();
  await page.getByRole('button', { name: '删除待办标签 旧分类', exact: true }).tap();
  await page
    .getByRole('dialog', { name: '删除待办标签', exact: true })
    .getByRole('button', { name: '删除标签', exact: true })
    .tap();
  await expect(page.getByRole('button', { name: '删除待办标签 旧分类', exact: true })).toHaveCount(
    0,
  );
  await back(page);
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: '删除活动标签 旧分类', exact: true }).tap();
  await page
    .getByRole('dialog', { name: '删除活动标签', exact: true })
    .getByRole('button', { name: '删除标签', exact: true })
    .tap();
  await expect(page.getByRole('button', { name: '删除活动标签 旧分类', exact: true })).toHaveCount(
    0,
  );
  await back(page);
  await page.reload();
  const stored = await state(page);
  expect(stored.tagColors.tasks).toEqual({ 独立标签: '#769fed' });
  expect(stored.tagColors.records).toEqual({ 独立标签: '#e69b4c' });
  expect(stored.tasks).toHaveLength(7);
  expect(stored.tasks.every((task) => !task.tags.includes('旧分类'))).toBe(true);
  expect(stored.timelog.records).toHaveLength(2);
  expect(stored.timelog.records.every((record) => !record.tags.includes('旧分类'))).toBe(true);
  expect(stored.timelog.records.map((record) => record.note)).toEqual([
    '保留原始记录内容',
    '保留删除标记的记录内容',
  ]);
  expect(stored.tasks.find((task) => task.id === 'deleted-task')?.deletedAt).not.toBeNull();
});
