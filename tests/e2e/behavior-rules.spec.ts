import { expect, test } from '@playwright/test';
import { emptyState } from '../../src/model';

test.use({ viewport: { width: 390, height: 844 } });

test('a behavior rule saves the selected answer and starts unselected on the next business day', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const state = emptyState();
  state.settings.timeZone = 'Asia/Shanghai';
  state.settings.dayStartsAt = '04:00';
  const deadline = Date.parse('2026-11-10T20:00:00Z');
  await page.clock.setFixedTime(deadline - 90_000);
  await page.addInitScript((state) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(state));
  }, state);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '手机底部导航' });
  const openGoals = async () => {
    await nav.getByRole('button', { name: '手机记录', exact: true }).click();
    await page.getByRole('tab', { name: '目标', exact: true }).click();
  };
  await openGoals();
  await page.getByRole('button', { name: '添加目标', exact: true }).first().click();
  await page.getByLabel('目标名称').fill('停止重复思考');
  await page.getByLabel('判定方式').selectOption('behaviorRule');
  await expect(page.getByLabel('周期')).toBeDisabled();
  await page.getByLabel('触发条件（P）').fill('第二次重复考虑已经想过的理由');
  await page.getByLabel('目标行为（Q）').fill('立即打开速记，写下问题与下一步');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  const card = page.locator('.goal-card').filter({ hasText: '停止重复思考' });
  await expect(card).toContainText('触发条件：第二次重复考虑已经想过的理由');
  await expect(card).toContainText('目标行为：立即打开速记，写下问题与下一步');
  const review = card.getByRole('combobox');
  await expect(review).toHaveValue('');
  await expect(review.locator('option')).toHaveText([
    '未选择',
    '未触发',
    '已触发，未全部执行',
    '已触发，全部执行',
  ]);
  await review.selectOption('executed');
  await review.selectOption('');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.behaviorReviews),
    )
    .toBeUndefined();
  await review.selectOption('notTriggered');
  await page.reload();
  await openGoals();
  await expect(review).toHaveValue('notTriggered');
  await page.clock.setFixedTime(deadline);
  await expect(review).toHaveValue('');

  await nav.getByRole('button', { name: '手机统计', exact: true }).click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page.getByLabel('记录统计来源').getByRole('button', { name: '目标', exact: true }).click();
  await page.getByRole('button', { name: '2026-11-10 未触发', exact: true }).click();
  await expect(page.locator('.goal-review-history')).toHaveText('2026-11-10 未触发');
  await expect(page.getByRole('combobox', { name: /今日行为回顾/ })).toHaveCount(0);
});
