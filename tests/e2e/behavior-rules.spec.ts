import { expect, test } from '@playwright/test';
import { emptyState } from '../../src/model';
import { mkdir } from 'node:fs/promises';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('a behavior rule counts triggers and actions side by side and resets on the next business day', async ({
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
  const trigger = card.getByRole('button', { name: /^触发条件 停止重复思考/ });
  const action = card.getByRole('button', { name: /^目标行为 停止重复思考/ });
  await expect(trigger).toHaveText('触发条件0');
  await expect(action).toHaveText('目标行为0');
  const [triggerBox, actionBox] = await Promise.all([trigger.boundingBox(), action.boundingBox()]);
  expect(Math.abs(triggerBox!.y - actionBox!.y)).toBeLessThan(1);
  expect(actionBox!.x).toBeGreaterThan(triggerBox!.x + triggerBox!.width - 1);
  await trigger.click();
  await action.click();
  await expect(trigger).toHaveText('触发条件2');
  await expect(action).toHaveText('目标行为1');
  const moved = (await trigger.boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.width / 2 + 20, moved.y + moved.height / 2);
  await page.waitForTimeout(520);
  await page.mouse.up();
  await expect(trigger).toHaveText('触发条件2');
  const touch = await page.context().newCDPSession(page);
  const actionTouch = (await action.boundingBox())!;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: actionTouch.x + actionTouch.width / 2, y: actionTouch.y + actionTouch.height / 2 },
    ],
  });
  await expect(action).toHaveText('目标行为0');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(action).toHaveText('目标行为0');
  await action.click();
  await touch.detach();
  await expect(trigger).toHaveText('触发条件2');
  await expect(action).toHaveText('目标行为1');
  const hold = async (button: typeof trigger, expected: string) => {
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(button).toHaveText(expected);
    await page.mouse.up();
    await expect(button).toHaveText(expected);
  };
  await hold(trigger, '触发条件1');
  await expect(action).toHaveText('目标行为1');
  await trigger.click();
  await hold(action, '目标行为0');
  await expect(trigger).toHaveText('触发条件1');
  await action.click();
  await expect(trigger).toHaveText('触发条件2');
  await expect(action).toHaveText('目标行为1');
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.behaviorReviews.map(
          ({ triggered, executed }: { triggered: number; executed: number }) => [
            triggered,
            executed,
          ],
        ),
      ),
    )
    .toEqual([[2, 1]]);
  await mkdir('.local/preview/behavior-counters', { recursive: true });
  await card.screenshot({ path: '.local/preview/behavior-counters/card-390.png' });
  await page.reload();
  await openGoals();
  await expect(trigger).toHaveText('触发条件2');
  await page.clock.setFixedTime(deadline);
  await expect(trigger).toHaveText('触发条件0');
  await expect(trigger).toBeEnabled();

  await nav.getByRole('button', { name: '手机统计', exact: true }).click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page.getByLabel('记录统计来源').getByRole('button', { name: '目标', exact: true }).click();
  await page.getByRole('button', { name: '2026-11-10 触发 2 次 · 执行 1 次', exact: true }).click();
  await expect(page.locator('.goal-review-history')).toHaveText('2026-11-10 触发 2 次 · 执行 1 次');
  await expect(page.getByRole('group', { name: /今日行为回顾/ })).toHaveCount(0);
});
