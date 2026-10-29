import { test, expect } from '@playwright/test';
import { emptyState } from '../../src/model';
import { defaultUsageSettings } from '../../src/usage/domain';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test('settings categories preserve drafts, align controls and fit phone and desktop themes', async ({
  page,
}) => {
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const navigation = dialog.getByRole('navigation', { name: '设置分类' });
  await expect(dialog.getByLabel('日程时区', { exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: '自动记录', exact: true }).click();
  await dialog.getByRole('switch', { name: '本机记录', exact: true }).check();
  await dialog.getByLabel('添加敏感词').fill('private draft');
  await navigation.getByRole('button', { name: '设备同步', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: '本机记录' })).toBeHidden();
  await navigation.getByRole('button', { name: '自动记录', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: '本机记录', exact: true })).toBeChecked();
  await expect(dialog.getByLabel('添加敏感词')).toHaveValue('private draft');
  expect(await page.evaluate(() => localStorage.getItem('saved-usage'))).toBeNull();
  const previews = path.resolve('.local/preview/settings');
  await mkdir(previews, { recursive: true });
  for (const width of [1440, 700, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((width) => {
      Object.assign(window.clearlist!, { platform: width > 700 ? 'win32' : 'android' });
    }, width);
    for (const theme of ['light', 'dark']) {
      await navigation.getByRole('button', { name: '通用', exact: true }).click();
      await dialog
        .getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true })
        .click();
      await dialog.screenshot({ path: path.join(previews, `general-${width}-${theme}.png`) });
      await navigation.getByRole('button', { name: '自动记录', exact: true }).click();
      const row = dialog.locator('.usage-setting-row').first();
      const bounds = (await row.boundingBox())!;
      const control = (await row.getByRole('switch').boundingBox())!;
      expect(Math.abs(control.y + control.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(
        2,
      );
      expect(control.x).toBeGreaterThan(bounds.x + bounds.width / 2);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(
        await dialog
          .locator('.settings-content')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await dialog.screenshot({ path: path.join(previews, `settings-${width}-${theme}.png`) });
    }
  }
});

test('settings shares native nested-dialog back, Escape and focus restoration', async ({
  page,
}) => {
  const opener = page.getByRole('button', { name: '设置与同步', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '自动记录', exact: true })
    .click();
  await dialog.getByRole('button', { name: /忽略应用/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '忽略应用', exact: true })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /忽略应用/ })).toBeFocused();
  await page.evaluate(() =>
    document.dispatchEvent(new Event('clearlist:back', { cancelable: true })),
  );
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('incoming pairing switches an open settings dialog to device sync', async ({ page }) => {
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('dayweave:pairing')));
  await expect(
    page
      .getByRole('navigation', { name: '设置分类' })
      .getByRole('button', { name: '设备同步', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

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
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '自动记录', exact: true })
    .click();
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

test('local capture and permission actions belong only to settings, never the timeline', async ({
  page,
}) => {
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await page.getByRole('button', { name: '自动记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开启本机记录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '授权使用情况', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('自动记录设备')).toHaveCount(0);
  await expect(page.locator('.usage-capture-control')).toHaveCount(0);
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '自动记录', exact: true })
    .click();
  await page.getByRole('switch', { name: '本机记录', exact: true }).check();
  await page.locator('.usage-settings').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '授权使用情况', exact: true }).click();
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
  await page
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '自动记录', exact: true })
    .click();
  await page.getByRole('button', { name: /忽略应用/ }).click();
  await expect(page.getByRole('dialog', { name: '忽略应用', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('ignored-applications-phone.png') });
});
