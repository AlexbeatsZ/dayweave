import { test, expect } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('shared task form keeps estimated and actual minutes optional and shows saved record time separately', async ({
  page,
}) => {
  const state = emptyState();
  state.tasks = [
    newTask('带记录的任务', { id: 'effort-task', estimatedMinutes: 30, actualMinutes: null }),
  ];
  state.timelog.records = [
    {
      id: 'effort-record',
      activityId: 'study',
      taskId: 'effort-task',
      note: '已记录',
      tags: [],
      spans: [{ start: Date.now() - 660000, end: Date.now() - 60000 }],
      nature: 'positive',
      pointsPerHour: 20,
      updatedAt: Date.now(),
      deletedAt: null,
    },
  ];
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await page.getByRole('tab', { name: /全部/ }).click();
  await page.getByRole('button', { name: '编辑 带记录的任务', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await expect(edit.getByLabel('预计用时', { exact: true })).toHaveValue('30');
  await expect(edit.getByLabel('实际用时', { exact: true })).toHaveValue('');
  await expect(edit.locator('.task-effort-reference')).toHaveText('关联记录累计 10 分钟');
  await edit.getByLabel('预计用时', { exact: true }).fill('');
  await edit.getByLabel('实际用时', { exact: true }).fill('0');
  await edit.getByRole('button', { name: '保存任务', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: /全部/ }).click();
  const row = page.getByTestId('task-row');
  await expect(row).toContainText('实际 0 分钟');
  await expect(row).not.toContainText('预计');
  await row.getByRole('button', { name: '编辑 带记录的任务', exact: true }).click();
  await expect(edit.getByLabel('预计用时', { exact: true })).toHaveValue('');
  await edit.getByLabel('实际用时', { exact: true }).fill('');
  await edit.getByRole('button', { name: '保存任务', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks[0].actualMinutes,
    ),
  ).toBeNull();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建任务', exact: true });
  await create.getByLabel('新任务标题').fill('半分钟任务');
  await create.getByLabel('预计用时', { exact: true }).fill('0.5');
  await create.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.getByTestId('task-row').filter({ hasText: '半分钟任务' })).toContainText(
    '预计 0.5 分钟',
  );
});
