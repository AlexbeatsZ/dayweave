import { test, expect, type Page } from '@playwright/test';
import { dateKey, emptyState, newTask, shiftDate } from '../../src/model';
import { setTimeZone } from '../../src/timezone';

test.beforeEach(async ({ page }) => {
  setTimeZone('Asia/Shanghai');
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, emptyState());
  await page.goto('/');
  await expect(page.locator('[data-layout="desktop"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: '待办', exact: true, level: 1 })).toBeVisible();
});

async function createTask(page: Page, title: string, list?: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建任务', exact: true });
  await dialog.getByLabel('新任务标题').fill(title);
  if (list) await dialog.getByRole('button', { name: list, exact: true }).click();
  await dialog.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('create a list, explicitly edit a recurring task, complete, undo deletion and retain state after reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新增所属清单', exact: true }).click();
  await page.getByLabel('清单名称').fill('研究');
  await page.getByRole('button', { name: '创建清单', exact: true }).click();
  await createTask(page, '阅读论文 #化学', '研究');
  await page.getByRole('button', { name: '编辑 阅读论文', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await editor.getByLabel('任务备注').fill('先看摘要和方法');
  await editor.getByLabel('任务优先级').selectOption('1');
  await editor.getByLabel('添加子任务').fill('阅读摘要');
  await editor.getByLabel('添加子任务').press('Enter');
  await editor.getByRole('checkbox', { name: '子任务 阅读摘要', exact: true }).click();
  await editor.getByLabel('重复频率').selectOption('daily');
  await editor.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.getByRole('checkbox', { name: '完成 阅读论文', exact: true }).click();
  await expect(page.locator('.completed-plans .task-row')).toHaveCount(1);
  await page.getByRole('tab', { name: /^全部/ }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '编辑 阅读论文', exact: true }).click();
  await expect(editor.getByLabel('计划日期')).toHaveValue(shiftDate(dateKey(), 1));
  await expect(editor.getByLabel('任务备注')).toHaveValue('先看摘要和方法');
  await expect(editor.getByLabel('任务标签')).toHaveValue('化学');
  await expect(
    editor.getByRole('checkbox', { name: '子任务 阅读摘要', exact: true }),
  ).not.toBeChecked();
  await editor.getByRole('button', { name: '删除当前任务', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /^全部/ }).click();
  await expect(page.getByRole('button', { name: '编辑 阅读论文', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '编辑清单 研究', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '搜索任务', exact: true })).toHaveCount(0);
});

test('internal backup merge remains idempotent without normal import or export UI', async ({
  page,
}) => {
  const incoming = { ...emptyState(), tasks: [newTask('导入的任务')] };
  await page.evaluate(async (incoming) => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    await store.importData(incoming);
    await store.importData(incoming);
    try {
      await store.importData({ version: 9 });
    } catch {}
  }, incoming);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks.length),
  ).toBe(1);
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await expect(page.getByRole('button', { name: '导出 JSON', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('选择备份文件')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('tab', { name: /^待办箱/ }).click();
  await expect(page.getByRole('button', { name: '编辑 导入的任务', exact: true })).toBeVisible();
});

test('Pomodoro entry points and duration settings are removed while task timing remains available', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: '专注', exact: true })).toHaveCount(0);
  await createTask(page, '阅读记录');
  await page.getByRole('button', { name: '编辑 阅读记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始记录时间', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '番茄专注', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await expect(page.getByLabel('专注时长', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('休息时长', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '深色', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
});

test('calendar drag reschedules tasks; deleting a list preserves its tasks and due dates', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新增所属清单', exact: true }).click();
  await page.getByLabel('清单名称').fill('学习与创造');
  await page.getByRole('button', { name: '创建清单', exact: true }).click();
  await createTask(page, '把最重要的一件事留在今天', '学习与创造');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '安排', exact: true })
    .click();
  const source = page.locator('.calendar-event').filter({ hasText: '把最重要的一件事' });
  const targetDate = shiftDate(dateKey(), 1);
  await source.dragTo(page.locator(`[data-date="${targetDate}"]`));
  await page.getByRole('button', { name: '把最重要的一件事留在今天', exact: true }).click();
  await expect(page.getByLabel('计划日期')).toHaveValue(targetDate);
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '待办', exact: true })
    .click();
  await page.getByRole('button', { name: '编辑清单 学习与创造', exact: true }).click();
  await page.getByRole('button', { name: '删除清单', exact: true }).click();
  await page.getByRole('button', { name: '确认删除清单', exact: true }).click();
  await page.getByRole('tab', { name: /^全部/ }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑 把最重要的一件事留在今天', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await expect(editor.getByRole('button', { name: '未分组', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(editor.getByLabel('计划日期')).toHaveValue(targetDate);
});

test('shared destinations render without errors; theme persists and compact viewport has no overflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createTask(page, '阅读图表');
  await page.getByRole('button', { name: '四象限', exact: true }).click();
  await expect(page.locator('.phone-quadrants')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '主导航' });
  for (const name of ['记录', '安排', '统计', '待办'])
    await nav.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-layout="phone"]')).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(page.getByLabel('新任务标题')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭新建任务', exact: true }).click();
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增所属清单', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
