import { test, expect, type Page } from '@playwright/test';
import { emptyState } from '../../src/model';
import { dayStart, dayKey } from '../../src/timelog/domain';
import { setTimeZone } from '../../src/timezone';

async function seed(page: Page, phone = false) {
  await page.clock.install({ time: new Date('2026-10-27T08:00:00Z') });
  setTimeZone('Asia/Shanghai');
  const day = dayKey(Date.parse('2026-10-27T08:00:00Z')),
    start = dayStart(day) + 9 * 3600000;
  const state = emptyState();
  state.timelog.records = [
    {
      id: 'manual-study',
      activityId: 'study',
      note: '保留手动记录',
      tags: [],
      spans: [{ start, end: start + 3600000 }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 3600000,
    },
  ];
  await page.addInitScript((value) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(value));
  }, state);
  await page.goto('/');
  await page
    .getByRole('button', { name: phone ? '手机记录' : '记录', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('group', { name: '时间线视图' }).or(page.locator('[aria-label="时间线视图"]')),
  ).toBeVisible();
  const base = {
    deviceName: 'OMEN',
    deviceId: 'omen',
    platform: 'win32',
    source: 'work-review',
    kind: 'app',
    start,
    end: start + 3600000,
    app: 'Editor',
    revision: 1,
  };
  const events = [
    { ...base, id: 'desktop' },
    {
      ...base,
      id: 'phone',
      deviceId: 'k70',
      deviceName: 'Redmi K70',
      platform: 'android',
      app: 'Via',
      start: start + 1800000,
      end: start + 5400000,
    },
    {
      ...base,
      id: 'web',
      kind: 'web',
      url: 'https://example.com/read',
      app: 'Browser',
      end: start + 1800000,
    },
    { ...base, id: 'unlock', kind: 'unlock', start: start + 1200000, end: start + 1200000 },
  ];
  await page.evaluate(async (events) => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge, usageChanged } = await import(modulePath);
    await usageBridge().import(events);
    usageChanged();
  }, events);
  return { start, state };
}

test('automatic import persists, shares a central clock and never changes manual records', async ({
  page,
}) => {
  const { start, state } = await seed(page);
  await page.getByRole('button', { name: '对照时间线', exact: true }).click();
  await expect(page.getByLabel('时间线缩放')).toHaveCount(0);
  await expect(page.locator('.usage-column-heading[data-device="omen"]')).toContainText('OMEN');
  await expect(page.locator('.usage-column-heading[data-device="k70"]')).toContainText('Redmi K70');
  await expect(page.locator('.usage-lane.automatic')).toHaveCount(2);
  await expect(page.locator('.usage-lane[data-device="omen"] .usage-block.app')).toHaveCount(1);
  await expect(page.locator('.usage-lane[data-device="k70"] .usage-block.app')).toHaveCount(1);
  const manual = page.locator(`.usage-block.manual[data-start="${start}"]`).first();
  const automatic = page
    .locator(`.usage-block.app[data-device="omen"][data-start="${start}"]`)
    .first();
  await expect(automatic).toBeAttached();
  expect(await automatic.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe('1px');
  const positions = await Promise.all(
    [manual, automatic].map((block) =>
      block.evaluate((node) => ({
        top: (node as HTMLElement).style.top,
        height: (node as HTMLElement).style.height,
      })),
    ),
  );
  expect(positions[0]).toEqual(positions[1]);
  expect(
    await automatic.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(70);
  await automatic.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('comparison-desktop.png') });
  await automatic.click();
  await expect(page.getByRole('heading', { name: '自动记录详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByLabel('自动记录设备').selectOption('k70');
  await expect(page.locator('.usage-block.app[data-device="omen"]')).toHaveCount(0);
  await expect(page.locator('.usage-block.app[data-device="k70"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.records),
  ).toEqual(state.timelog.records);
  await page.reload();
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await page.getByRole('button', { name: '自动记录', exact: true }).click();
  await expect(page.locator('.usage-block.app')).toHaveCount(2);
});

test('record statistics distinguish simultaneous devices, website layers and manual points', async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '统计', exact: true })
    .click();
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await page
    .locator('[aria-label="记录统计来源"]')
    .getByRole('button', { name: '自动', exact: true })
    .click();
  const card = page
    .locator('.phone-analysis-card')
    .filter({ has: page.getByRole('heading', { name: '设备使用', exact: true }) });
  await expect(card).toContainText('1 小时 30 分钟');
  await expect(card).toContainText('2 小时');
  await expect(page.getByRole('heading', { name: '网站访问' })).toBeVisible();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();
  await page.getByLabel('自动统计设备').selectOption('k70');
  await expect(card).toContainText('1 小时');
  await expect(page.getByText('example.com', { exact: true })).toHaveCount(0);
});

test('narrow comparison remains within the viewport without import controls or explanatory copy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, true);
  await page.getByRole('button', { name: '对照时间线', exact: true }).click();
  await expect(page.locator('.usage-block.app')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(
    await page
      .locator('.usage-scroll')
      .first()
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await page.locator('.usage-block.app').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('comparison-phone.png') });
  await page.locator('.usage-block.app').first().click();
  await expect(page.getByRole('heading', { name: '自动记录详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(page.getByText('载入与同步', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/没有记录不代表|设备观察，不会自动/)).toHaveCount(0);
  await expect(page.locator('.timeline-summary, .timeline-options')).toHaveCount(0);
});

test('short records auto-size and same-name devices keep independent columns', async ({ page }) => {
  const { start } = await seed(page);
  await page.evaluate(async (start) => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge, usageChanged } = await import(modulePath);
    await usageBridge().import([
      {
        id: 'short-1',
        deviceId: 'old-omen',
        deviceName: 'OMEN',
        platform: 'win32',
        source: 'work-review',
        kind: 'app',
        app: 'Short Editor',
        revision: 1,
        start: start + 5 * 3600000,
        end: start + 5 * 3600000 + 5000,
      },
      {
        id: 'short-2',
        deviceId: 'old-omen',
        deviceName: 'OMEN',
        platform: 'win32',
        source: 'work-review',
        kind: 'app',
        app: 'Short Browser',
        revision: 1,
        start: start + 5 * 3600000 + 5000,
        end: start + 5 * 3600000 + 10000,
      },
    ]);
    usageChanged();
  }, start);
  await page.getByRole('button', { name: '对照时间线', exact: true }).click();
  await expect(page.locator('.usage-lane.automatic')).toHaveCount(3);
  await expect(page.locator('.usage-column-heading[data-device="old-omen"]')).toContainText('OMEN');
  const lane = page.locator('.usage-lane[data-device="old-omen"]');
  const cards = lane.locator('.usage-block');
  await expect(cards).toHaveCount(2);
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => ({
      top: (node as HTMLElement).offsetTop,
      height: (node as HTMLElement).offsetHeight,
    })),
  );
  expect(boxes.every((box) => box.height >= 70)).toBe(true);
  expect(boxes[1].top + boxes[1].height).toBeLessThanOrEqual(boxes[0].top);
  expect(await lane.evaluate((node) => node.clientHeight)).toBeLessThan(650);
  await cards.first().click();
  await expect(page.getByRole('heading', { name: '自动记录详情' })).toBeVisible();
});
