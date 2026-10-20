import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('phone navigation, full-screen task detail and dark preference work with touch', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '手机底部导航' })).toBeVisible();
  await page.getByRole('button', { name: '切换深浅主题', exact: true }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('新任务标题').fill('手机上的第一件事');
  await page.getByRole('button', { name: '添加任务', exact: true }).tap();
  await page.getByRole('button', { name: '编辑 手机上的第一件事', exact: true }).tap();
  const detail = page.getByRole('complementary', { name: '任务详情' });
  await expect(detail).toBeVisible();
  const bounds = await detail.boundingBox();
  expect(bounds!.width).toBe(390);
  await page.getByLabel('任务备注').fill('离线记下来');
  await page.getByRole('button', { name: '关闭详情', exact: true }).tap();
  await page.getByRole('button', { name: '手机更多', exact: true }).tap();
  await expect(page.getByLabel('搜索任务')).toBeVisible();
  await page.getByRole('button', { name: '新建清单', exact: true }).tap();
  await page.getByLabel('清单名称').fill('随手记');
  await page.getByRole('button', { name: '创建清单', exact: true }).tap();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).tap();
  await page.getByRole('button', { name: '手机更多', exact: true }).tap();
  await page.getByRole('button', { name: '日历', exact: true }).tap();
  await expect(page.getByRole('region', { name: '月历' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '手机清单', exact: true }).tap();
  await expect(
    page.getByRole('button', { name: '编辑 手机上的第一件事', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('system theme changes update surfaces and native color scheme without changing the preference', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#18221f');
  await page.getByRole('button', { name: '手机更多', exact: true }).tap();
  await page.getByRole('button', { name: '打开设置', exact: true }).tap();
  await expect(page.getByRole('button', { name: '跟随系统', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '浅色', exact: true }).tap();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
