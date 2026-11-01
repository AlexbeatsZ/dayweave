import { expect, test, type Page } from '@playwright/test';
import { emptyState } from '../../src/model';
import type { UsageQuery } from '../../src/usage/domain';

async function seed(page: Page, count = 40) {
  await page.clock.install({ time: new Date('2026-10-27T08:00:00Z') });
  await page.addInitScript((state) => {
    localStorage.setItem('dayweave.v1', JSON.stringify(state));
  }, emptyState());
  await page.goto('/');
  await page
    .getByRole('button', {
      name: page.viewportSize()!.width <= 700 ? '手机记录' : '记录',
      exact: true,
    })
    .first()
    .click();
  await page.evaluate(async (count) => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge } = await import(modulePath);
    const start = Date.parse('2026-10-27T01:00:00Z');
    await usageBridge().import(
      Array.from({ length: count }, (_, index) => ({
        id: `perf-${index}`,
        deviceId: 'perf',
        deviceName: 'Synthetic desktop',
        platform: 'win32',
        source: 'work-review',
        kind: 'app',
        app: 'Editor',
        title: `Document ${index}`,
        start: start + index * 10000,
        end: start + (index + 1) * 10000,
        revision: 1,
      })),
    );
  }, count);
  await page.getByRole('button', { name: '自动记录', exact: true }).click();
  await expect(page.locator('.usage-block.app').first()).toBeAttached();
}

for (const width of [390, 1440]) {
  test(`large automatic history bounds rendered cards and remains browsable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await seed(page, 2400);
    const day = page.locator('[data-timeline-day="2026-10-27"]');
    const cards = day.locator('.usage-block.app');
    expect(await cards.count()).toBeLessThan(80);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const scriptTime = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find(
        (item) => item.name === 'ScriptDuration',
      )!.value;
    const before = await scriptTime();
    await page.clock.runFor(4000);
    expect((await scriptTime()) - before).toBeLessThan(0.5);
    expect(await cards.count()).toBeLessThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    // Scroll using the existing full-height axis, including cards that were never mounted.
    for (const fraction of [0.5, 1, 0]) {
      await day.locator('.usage-aligned').evaluate((axis, fraction) => {
        const root = axis.closest<HTMLElement>('.phone-content')!;
        const top =
          axis.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
        root.scrollTop = top + fraction * (axis.clientHeight - root.clientHeight);
      }, fraction);
      await page.clock.runFor(100);
      await expect.poll(() => cards.count()).toBeGreaterThan(0);
      expect(await cards.count()).toBeLessThan(80);
      if (fraction === 0.5) {
        const titles = await cards.locator('span').allTextContents();
        expect(titles.some((title) => /Document 12\d\d/.test(title))).toBe(true);
      }
      if (fraction === 1) await expect(cards.filter({ hasText: 'Document 0' })).toBeAttached();
      if (fraction === 0) await expect(cards.filter({ hasText: 'Document 2399' })).toBeAttached();
    }
    await cards.filter({ hasText: 'Document 2399' }).click();
    await expect(page.getByRole('dialog', { name: '自动记录详情' })).toContainText('Document 2399');
    await page.getByRole('button', { name: '关闭', exact: true }).last().click();
    await page.getByRole('button', { name: '对照时间线', exact: true }).click();
    expect(await cards.count()).toBeLessThan(80);
    // A resize across the shared phone/desktop breakpoint keeps the visible records reachable.
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: 720 });
    await page.clock.runFor(100);
    await expect(cards.filter({ hasText: 'Document 2399' })).toBeAttached();
    await page.setViewportSize({ width, height: 960 });
    await page.clock.runFor(100);
    await page.screenshot({ path: test.info().outputPath(`large-history-${width}.png`) });
  });
}

test('background refresh retains cards and scroll while coalescing pending requests and recovering errors', async ({
  page,
}) => {
  await seed(page);
  await page.locator('.phone-content').evaluate((root) => {
    root.scrollTop = 400;
  });
  await page.clock.runFor(100);
  const previousScroll = await page.locator('.phone-content').evaluate((root) => root.scrollTop);
  const previousCardTop = await page
    .locator('.usage-block')
    .first()
    .evaluate((card) => card.getBoundingClientRect().top);
  await page.evaluate(async () => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge, usageChanged } = await import(modulePath);
    const bridge = usageBridge();
    const original = bridge.query.bind(bridge);
    const start = Date.parse('2026-10-26T16:00:00Z');
    const probe = {
      calls: 0,
      release: () => {},
      fail: false,
      card: document.querySelector('.usage-block'),
    };
    Object.assign(window, { __usageProbe: probe });
    const query = async (query: UsageQuery) => {
      if (query.start !== start) return original(query);
      probe.calls++;
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
      if (probe.fail) throw new Error('Synthetic refresh failure');
      return original(query);
    };
    Object.assign(window, { clearlist: { ...window.clearlist, usage: { ...bridge, query } } });
    usageChanged();
    for (let index = 0; index < 10; index++) usageChanged();
  });
  await page.clock.runFor(30000);
  const probe = () =>
    page.evaluate(() => {
      const value = (window as unknown as { __usageProbe: { calls: number; card: Element } })
        .__usageProbe;
      return {
        calls: value.calls,
        sameCard: value.card === document.querySelector('.usage-block'),
      };
    });
  expect(await probe()).toEqual({ calls: 1, sameCard: true });
  expect(await page.locator('.phone-content').evaluate((root) => root.scrollTop)).toBe(
    previousScroll,
  );
  await expect(page.getByText('正在载入自动记录…')).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { __usageProbe: { release: () => void } }).__usageProbe.release(),
  );
  await expect.poll(async () => (await probe()).calls).toBe(2);
  await page.evaluate(() => {
    const value = (window as unknown as { __usageProbe: { release: () => void; fail: boolean } })
      .__usageProbe;
    value.fail = true;
    value.release();
  });
  await expect(page.getByRole('alert')).toContainText('Synthetic refresh failure');
  expect((await probe()).sameCard).toBe(true);
  expect(
    await page
      .locator('.usage-block')
      .first()
      .evaluate((card) => card.getBoundingClientRect().top),
  ).toBe(previousCardTop);
  await page.evaluate(async () => {
    const value = (window as unknown as { __usageProbe: { fail: boolean } }).__usageProbe;
    value.fail = false;
    const modulePath = '/src/usage/client.ts';
    (await import(modulePath)).usageChanged();
  });
  await expect.poll(async () => (await probe()).calls).toBe(3);
  await page.evaluate(() =>
    (window as unknown as { __usageProbe: { release: () => void } }).__usageProbe.release(),
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await probe()).sameCard).toBe(true);
});

test('changing the date cancels remaining pages and ignores a late previous-date reply', async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const modulePath = '/src/usage/client.ts';
    const { usageBridge, usageChanged } = await import(modulePath);
    const bridge = usageBridge();
    const oldStart = Date.parse('2026-10-26T16:00:00Z');
    const probe = { oldCalls: 0, release: () => {} };
    Object.assign(window, { __cancelProbe: probe });
    const query = async (query: UsageQuery) => {
      if (query.start !== oldStart) return { events: [], complete: true };
      probe.oldCalls++;
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
      return { events: [], next: 123, complete: false };
    };
    Object.assign(window, { clearlist: { ...window.clearlist, usage: { ...bridge, query } } });
    usageChanged();
  });
  await page.getByLabel('查看日期', { exact: true }).fill('2026-10-26');
  await page.evaluate(() =>
    (window as unknown as { __cancelProbe: { release: () => void } }).__cancelProbe.release(),
  );
  await expect(page.getByLabel('查看日期', { exact: true })).toHaveValue('2026-10-26');
  await page.clock.runFor(1000);
  expect(
    await page.evaluate(
      () => (window as unknown as { __cancelProbe: { oldCalls: number } }).__cancelProbe.oldCalls,
    ),
  ).toBe(1);
  await expect(page.locator('[data-timeline-day="2026-10-27"]')).toHaveCount(0);
  await expect(page.locator('.usage-block')).toHaveCount(0);
});
