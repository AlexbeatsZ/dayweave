import { test, expect } from '@playwright/test';
import { dateKey, emptyState, newTask, shiftDate } from '../../src/model';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^今天/, level: 1 })).toBeVisible();
});

test('create a list, edit a tagged recurring task, complete, restore and retain state after reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建清单', exact: true }).click();
  await page.getByLabel('清单名称').fill('研究');
  await page.getByRole('button', { name: '创建清单', exact: true }).click();
  await page.getByLabel('新任务标题').fill('阅读论文 #化学');
  await page.getByLabel('新任务清单').selectOption({ label: '研究' });
  await page.getByLabel('新任务优先级').selectOption('1');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByRole('button', { name: '编辑 阅读论文', exact: true }).click();
  await page.getByLabel('任务备注').fill('先看摘要和方法');
  await page.getByLabel('添加子任务').fill('阅读摘要');
  await page.getByLabel('添加子任务').press('Enter');
  await page.getByRole('checkbox', { name: '子任务 阅读摘要', exact: true }).click();
  await page.getByLabel('重复频率').selectOption('daily');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('checkbox', { name: '完成 阅读论文', exact: true }).click();
  await page.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部任务', exact: false }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '编辑 阅读论文', exact: true }).click();
  await expect(page.getByLabel('计划日期')).toHaveValue(shiftDate(dateKey(), 1));
  await expect(page.getByLabel('任务备注')).toHaveValue('先看摘要和方法');
  await expect(
    page.getByRole('checkbox', { name: '子任务 阅读摘要', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: '删除当前任务', exact: true }).click();
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await page.getByRole('button', { name: '恢复 阅读论文', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '全部任务', exact: false }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toHaveCount(1);
  await page.getByLabel('搜索任务').fill('#化学');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});

test('valid backup import merges idempotently; invalid import preserves data; export contains the task', async ({
  page,
}) => {
  const incoming = { ...emptyState(), tasks: [newTask('导入的任务')] };
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const file = page.getByLabel('选择备份文件');
  await file.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await expect(page.getByRole('status')).toContainText('新增 1 件任务');
  await file.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(incoming)),
  });
  await expect(page.getByRole('status')).toContainText('新增 0 件任务');
  await file.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":9}'),
  });
  await expect(page.getByRole('alert')).toContainText('原有数据未改变');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/Dayweave-.*\.json/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream!) chunks.push(c);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.tasks).toHaveLength(1);
  expect(exported.tasks[0].title).toBe('导入的任务');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '收集箱', exact: false }).click();
  await expect(page.getByRole('button', { name: '编辑 导入的任务', exact: true })).toBeVisible();
});

test('focus pause survives reload; elapsed timer is credited exactly once', async ({ page }) => {
  await page.clock.install();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByLabel('专注时长', { exact: true }).fill('1');
  await page.getByLabel('专注时长', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '专注', exact: true }).click();
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await page.clock.fastForward(10000);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '专注', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.clock.fastForward(65000);
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: '专注', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
});

test('calendar drag reschedules tasks; deleting a list preserves its tasks', async ({ page }) => {
  await page.getByRole('button', { name: '添加入门示例', exact: false }).click();
  await page.getByRole('button', { name: '日历', exact: true }).click();
  const source = page.locator('.calendar-event').filter({ hasText: '把最重要的一件事' });
  const targetDate = shiftDate(dateKey(), 1);
  await source.dragTo(page.locator(`[data-date="${targetDate}"]`));
  await page.getByRole('button', { name: '把最重要的一件事，留在今天', exact: true }).click();
  await expect(page.getByLabel('计划日期')).toHaveValue(targetDate);
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '编辑清单 学习与创造', exact: true }).click();
  await page.getByRole('button', { name: '删除清单', exact: true }).click();
  await page.getByRole('button', { name: '确认删除清单', exact: true }).click();
  await page.getByRole('button', { name: '全部任务', exact: false }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(6);
});

test('all views render without errors; dark theme persists; compact viewport has no horizontal overflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '添加入门示例', exact: false }).click();
  for (const view of ['四象限', '统计', '日历', '专注', '回收站', '已完成', '今天'])
    await page.getByRole('button', { name: view, exact: view !== '今天' }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(page.getByLabel('新任务标题')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: '关闭新建任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '搜索任务', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '手机更多', exact: true }).click();
  await page.getByRole('button', { name: /^阅读/, exact: false }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});
