import { test, expect } from '@playwright/test';
import { emptyState } from '../../src/model';

test('pending automatic upload cannot stall foreground manual retries or queue duplicate uploads', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-27T12:00:00Z') });
  await page.addInitScript((state) => {
    const files: Record<string, string> = { 'data.json': JSON.stringify(state) };
    const counters = { manual: 0, automatic: 0 };
    Object.assign(window, {
      __usageCounters: counters,
      androidBridge: {},
      Capacitor: {
        PluginHeaders: [
          {
            name: 'DayweaveFiles',
            methods: ['read', 'write', 'deviceInfo', 'appearance', 'usage', 'discoverSync'].map(
              (name) => ({ name, rtype: 'promise' }),
            ),
          },
          {
            name: 'App',
            methods: [
              { name: 'addListener', rtype: 'callback' },
              ...['getLaunchUrl', 'removeListener'].map((name) => ({ name, rtype: 'promise' })),
            ],
          },
        ],
        nativePromise: async (
          plugin: string,
          method: string,
          options: Record<string, string> = {},
        ) => {
          if (plugin === 'App') return {};
          if (method === 'read') return { content: files[options.name] ?? null };
          if (method === 'write') {
            files[options.name] = options.content;
            return;
          }
          if (method === 'deviceInfo') return { name: 'Test Android' };
          if (method === 'appearance') return;
          if (method === 'discoverSync') return { peers: [] };
          if (method === 'usage' && options.action === 'sync') {
            counters.automatic++;
            return new Promise(() => {});
          }
          throw new Error('Unsupported synthetic native request');
        },
        nativeCallback: () => 'listener',
      },
    });
  }, emptyState());
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/native-mobile/);
  await page.evaluate(async () => {
    const modulePath = '/src/sync/client.ts';
    const { SyncClient } = await import(modulePath);
    SyncClient.prototype.now = async function () {
      (window as unknown as { __usageCounters: { manual: number } }).__usageCounters.manual++;
      throw new Error('Synthetic offline manual exchange');
    };
  });
  await page.clock.runFor(34000);
  const counters = await page.evaluate(
    () =>
      (window as unknown as { __usageCounters: { manual: number; automatic: number } })
        .__usageCounters,
  );
  expect(counters.automatic).toBe(1);
  expect(counters.manual).toBeGreaterThan(10);
});
