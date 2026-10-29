import { test, expect, type Page } from '@playwright/test';
import { emptyState } from '../../src/model';
import { dayStart, dayKey } from '../../src/timelog/domain';
import { setTimeZone } from '../../src/timezone';

async function seed(page: Page, phone = false, crowded = false) {
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
  if (crowded)
    state.timelog.records.push({
      ...state.timelog.records[0],
      id: 'manual-work',
      activityId: 'work',
      note: '项目开发',
      spans: [{ start: start + 3600000, end: start + 10800000 }],
    });
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
  await expect(page.locator('.usage-column-headings, .usage-column-heading')).toHaveCount(0);
  await expect(page.getByLabel('自动记录设备')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开启本机记录', exact: true })).toHaveCount(0);
  await expect(page.locator('.usage-lane.automatic')).toHaveCount(1);
  await expect(
    page.locator('.usage-lane.automatic .usage-block.app[data-device="omen"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.usage-lane.automatic .usage-block.app[data-device="k70"]'),
  ).toHaveCount(1);
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
  await expect(page.locator('.usage-block.app[data-device="omen"]')).toHaveCount(1);
  await expect(page.locator('.usage-block.app[data-device="k70"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).timelog.records),
  ).toEqual(state.timelog.records);
  await page.reload();
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await page.getByRole('button', { name: '自动记录', exact: true }).click();
  await expect(page.locator('.usage-block.app')).toHaveCount(2);
});

for (const width of [360, 390, 430]) {
  test(`crowded multi-device timeline fits ${width}px without horizontal scrolling and opens full details`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const { start } = await seed(page, true, true);
    await page.evaluate(async (start) => {
      const modulePath = '/src/usage/client.ts';
      const { usageBridge, usageChanged } = await import(modulePath);
      const names = ['OMEN', 'ROG', 'MacBook', 'Redmi K70', 'Pad 6 Pro'];
      const apps = ['Visual Studio Code', 'Chrome', 'Obsidian', '微信', 'Via', '阅读'];
      await usageBridge().import(
        Array.from({ length: 12 }, (_, index) => ({
          id: `preview-${index}`,
          deviceId: `preview-${index}`,
          deviceName: names[index % names.length],
          platform: index % 2 ? 'android' : 'win32',
          source: 'work-review',
          kind: index % 3 === 1 ? 'web' : 'app',
          app: apps[index % apps.length],
          title:
            index === 5 ? '完整的阅读内容与窗口标题' : `${apps[index % apps.length]} · 项目资料`,
          url: index % 3 === 1 ? `https://example.com/document/${index}` : '',
          start: start + 3600000,
          end: start + 10800000,
          revision: 1,
        })),
      );
      usageChanged();
    }, start);
    for (const mode of ['自动记录', '对照时间线']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.usage-lane.automatic')).toHaveCount(1);
      await expect(page.locator('.usage-block[data-device^="preview-"]')).toHaveCount(12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(
        await page
          .locator('.usage-frame, .usage-aligned, .usage-lane')
          .evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth)),
      ).toBe(true);
      expect(
        await page.locator('.usage-lane.automatic').evaluate((lane) => {
          const bounds = lane.getBoundingClientRect();
          return [...lane.querySelectorAll('.usage-block')].every((node) => {
            const card = node.getBoundingClientRect();
            return card.width > 0 && card.left >= bounds.left && card.right <= bounds.right + 1;
          });
        }),
      ).toBe(true);
      await expect(page.locator('.usage-column-headings, .usage-capture-control')).toHaveCount(0);
      await expect(page.getByLabel('自动记录设备')).toHaveCount(0);
      if (width === 390 && mode === '自动记录')
        await page.screenshot({ path: test.info().outputPath('automatic-phone.png') });
    }
    await page.screenshot({ path: test.info().outputPath(`comparison-${width}.png`) });
    await page.locator('.usage-block[data-device="preview-5"]').click();
    const detail = page.getByRole('dialog', { name: '自动记录详情' });
    await expect(detail).toContainText('OMEN');
    await expect(detail).toContainText('完整的阅读内容与窗口标题');
    expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`details-${width}.png`) });
  });
}

test('staggered cards keep fixed equal widths, blank ends and full-width standalone cards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { start } = await seed(page, true);
  await page.evaluate(async (start) => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge, usageChanged } = await import(modulePath);
    const base = {
      deviceId: 'staggered-preview',
      deviceName: 'OMEN',
      platform: 'win32',
      source: 'work-review',
      kind: 'app',
      revision: 1,
    };
    await usageBridge().import([
      {
        ...base,
        id: 'staggered-a',
        app: '卡片 A',
        start: start + 2 * 3600000,
        end: start + 5 * 3600000,
      },
      {
        ...base,
        id: 'staggered-b',
        app: '卡片 B',
        start: start + 3 * 3600000,
        end: start + 6 * 3600000,
      },
      {
        ...base,
        id: 'standalone',
        app: '单条记录',
        start: start + 6 * 3600000,
        end: start + 6.5 * 3600000,
      },
    ]);
    usageChanged();
  }, start);
  for (const mode of ['对照时间线', '自动记录']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const lane = page.locator('.usage-lane.automatic');
    const cards = lane.locator('.usage-block[data-device="staggered-preview"]');
    await expect(cards).toHaveCount(3);
    const positions = await cards.evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.querySelector('strong')!.textContent,
        left: (node as HTMLElement).style.left,
        width: (node as HTMLElement).style.width,
      })),
    );
    expect(positions).toEqual([
      { label: '卡片 A', left: '0%', width: '50%' },
      { label: '卡片 B', left: '50%', width: '50%' },
      { label: '单条记录', left: '0%', width: '100%' },
    ]);
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    const single = await cards.nth(2).boundingBox();
    const container = await lane.boundingBox();
    expect(first!.width).toBeCloseTo(container!.width / 2, 1);
    expect(second!.width).toBeCloseTo(first!.width, 1);
    expect(single!.width).toBeCloseTo(container!.width, 1);
    expect(first!.y + first!.height).toBeGreaterThan(second!.y + second!.height);
    expect(first!.y).toBeGreaterThan(second!.y);
    expect(await lane.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('staggered-phone.png') });
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
      .locator('.usage-frame')
      .first()
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(false);
  await page.locator('.usage-block.app').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('comparison-phone.png') });
  await page.locator('.usage-block.app').first().click();
  await expect(page.getByRole('heading', { name: '自动记录详情' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(page.getByText('载入与同步', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/没有记录不代表|设备观察，不会自动/)).toHaveCount(0);
  await expect(page.locator('.timeline-summary, .timeline-options')).toHaveCount(0);
});

test('short records auto-size while same-name devices share a column without changing identity', async ({
  page,
}) => {
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
  await expect(page.locator('.usage-lane.automatic')).toHaveCount(1);
  await expect(page.locator('.usage-column-headings, .usage-column-heading')).toHaveCount(0);
  const lane = page.locator('.usage-lane.automatic');
  const cards = lane.locator('.usage-block[data-device="old-omen"]');
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
