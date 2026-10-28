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
  await page.getByText('载入与同步', { exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '载入 AW / Work Review JSON' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await (
    await chooser
  ).setFiles({
    name: 'usage.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'dayweave-usage', version: 1, events })),
  });
  await expect(page.getByText('已载入 4 条新增或修订记录')).toBeVisible();
  await page.getByText('载入与同步', { exact: true }).click();
  return { start, state };
}

test('automatic import persists, shares a central clock and never changes manual records', async ({
  page,
}) => {
  const { start, state } = await seed(page);
  await page.getByRole('button', { name: '对照时间线', exact: true }).click();
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
  await automatic.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('comparison-desktop.png') });
  await automatic.click();
  await expect(page.getByText('这是一条设备观察，不会自动增加手动记录或积分。')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: '网站访问（独立口径）' })).toBeVisible();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();
  await page.getByLabel('自动统计设备').selectOption('k70');
  await expect(card).toContainText('1 小时');
  await expect(page.getByText('example.com', { exact: true })).toHaveCount(0);
});

test('narrow comparison remains within the viewport and reports browser capture as unavailable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, true);
  await page.getByRole('button', { name: '对照时间线', exact: true }).click();
  await expect(page.locator('.usage-block.app')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('.usage-block.app').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('comparison-phone.png') });
  await page.locator('.usage-block.app').first().click();
  await expect(page.getByText('这是一条设备观察，不会自动增加手动记录或积分。')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByText('载入与同步', { exact: true }).click();
  await page.getByRole('button', { name: '立即同步自动记录' }).click();
  await expect(
    page.getByText('浏览器版不运行本机同步中心；请使用安装版同步，或载入 JSON 历史'),
  ).toBeVisible();
});
