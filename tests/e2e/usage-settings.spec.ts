import { test, expect } from '@playwright/test';
import { emptyState } from '../../src/model';
import { defaultUsageSettings } from '../../src/usage/domain';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ state, settings }) => {
      let current = settings;
      let permitted = false;
      const status = () => ({
        settings: current,
        capture: permitted ? '正在记录' : '未授权',
        permissionRequired: !permitted,
        devices: [],
        count: 0,
        pending: 0,
        error: '',
      });
      Object.assign(window, {
        clearlist: {
          platform: 'android',
          load: async () => ({ state, path: 'synthetic', recovered: false }),
          save: async () => {},
          onBeforeClose: () => {},
          readyToClose: () => {},
          usage: {
            query: async () => ({ events: [], complete: true }),
            status: async () => status(),
            configure: async (value: typeof settings) => {
              current = value;
              localStorage.setItem('saved-usage', JSON.stringify(current));
              return status();
            },
            permission: async (kind: string) => {
              permitted = true;
              localStorage.setItem('permission-opened', kind);
            },
            applications: async () => [
              {
                id: 'com.tencent.mm',
                name: '微信',
                icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZhkAAAAASUVORK5CYII=',
              },
              { id: 'mark.via', name: 'Via' },
              { id: 'com.example.private', name: '隐私应用' },
            ],
          },
        },
      });
    },
    { state: emptyState(), settings: defaultUsageSettings() },
  );
  await page.goto('/');
});

test('ignored applications use searchable native identities, preserve drafts and persist on save', async ({
  page,
}) => {
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.getByRole('button', { name: /忽略应用/ }).click();
  const picker = page.getByRole('dialog', { name: '忽略应用', exact: true });
  await picker.getByLabel('搜索应用').fill('微信');
  await expect(picker.getByText('com.tencent.mm', { exact: true })).toBeVisible();
  await picker.getByRole('checkbox', { name: '忽略 微信 com.tencent.mm', exact: true }).check();
  await picker.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.usage-settings').getByRole('button', { name: '保存', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('saved-usage')!).excludedApps))
    .toContain('com.tencent.mm');
  await page.getByRole('button', { name: /忽略应用/ }).click();
  await picker.getByRole('checkbox', { name: '忽略 Via mark.via', exact: true }).check();
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.usage-settings').getByRole('button', { name: '保存', exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('saved-usage')!).excludedApps),
  ).not.toContain('mark.via');
  await expect(page.locator('.usage-settings textarea')).toHaveCount(0);
  await expect(page.getByText(/不会自动增加|默认关闭|未授权、未上传/)).toHaveCount(0);
});

test('empty local timeline offers enable and the actual permission action instead of import advice', async ({
  page,
}) => {
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await page.getByRole('button', { name: '自动记录', exact: true }).click();
  await page.getByRole('button', { name: '开启本机记录', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('permission-opened')))
    .toBe('usage');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('saved-usage')!).enabled)).toBe(
    true,
  );
  await expect(page.locator('.timeline-summary, .timeline-options')).toHaveCount(0);
  await expect(page.getByText(/没有记录不代表|载入与同步/)).toHaveCount(0);
});

test('application picker remains usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.getByRole('button', { name: /忽略应用/ }).click();
  await expect(page.getByRole('dialog', { name: '忽略应用', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('ignored-applications-phone.png') });
});
