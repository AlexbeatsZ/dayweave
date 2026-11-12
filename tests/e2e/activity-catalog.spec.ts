import { test, expect } from '@playwright/test';
import { emptyState } from '../../src/model';

test('an unused old preset is hidden and the goal editor offers only the created activity', async ({
  page,
}) => {
  const initial = emptyState();
  initial.timelog.activities = [
    {
      id: 'exercise',
      name: '运动',
      color: '#8f9851',
      nature: 'positive',
      archived: false,
      updatedAt: 1,
    },
  ];
  await page.addInitScript(
    (state) => localStorage.setItem('dayweave.v1', JSON.stringify(state)),
    initial,
  );
  await page.goto('/');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('tab', { name: '计时', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始 运动', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建积极活动', exact: true }).click();
  await page.getByLabel('活动名称').fill('专项练习');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始 专项练习', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '目标', exact: true }).click();
  await page.getByRole('button', { name: '添加目标', exact: true }).first().click();
  const options = page.getByRole('group', { name: '规则 1 的活动' }).getByRole('button');
  await expect(options).toHaveText(['专项练习']);
  await expect(options.first()).toHaveAttribute('aria-pressed', 'false');
});
