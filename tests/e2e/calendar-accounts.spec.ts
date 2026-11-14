import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptyState } from '../../src/model';

async function seed(page: Page, configured = false) {
  await page.addInitScript(
    (state) => localStorage.setItem('dayweave.v1', JSON.stringify(state)),
    emptyState(),
  );
  await page.goto('/#timetable');
  await expect(page.getByRole('region', { name: '日程安排', exact: true })).toBeVisible();
  await page.evaluate((configured) => {
    const status = {
      providers: {
        google: {
          configured,
          clientId: configured ? 'google-client' : '',
          baseUrl: configured ? 'https://hub.example/dayweave' : '',
        },
        microsoft: { configured: false, clientId: '', baseUrl: '' },
      },
      accounts: configured
        ? [
            {
              id: 'a8f9d842-6e20-4c47-90e7-e13b77320551',
              provider: 'google',
              name: 'person@example.com',
              calendars: [
                { id: 'primary', name: '工作与生活', writable: true },
                { id: 'shared', name: '家庭日历', writable: false },
              ],
              importIds: ['primary'],
              publishId: null,
              checkedAt: Date.now(),
              error: '',
              refreshing: false,
            },
          ]
        : ([] as any[]),
    };
    const calls: any[] = [];
    Object.assign(window, {
      calendarTest: { status, calls, opened: [] as string[] },
      clearlist: {
        ...window.clearlist,
        openCalendarLink: async (url: string) => {
          (window as any).calendarTest.opened.push(url);
        },
        sync: {
          status: async () => ({
            mode: 'client',
            connected: true,
            endpoints: ['http://100.106.169.46:49732', 'https://hub.example/dayweave'],
            conflicts: [],
            name: '测试设备',
            error: '',
          }),
          calendarAccounts: async (command: any) => {
            calls.push(command);
            if (command.action === 'configure')
              status.providers[command.provider as 'google' | 'microsoft'] = {
                configured: true,
                clientId: command.clientId,
                baseUrl: command.baseUrl,
              };
            if (command.action === 'authorize')
              return {
                status,
                authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=test-state',
              };
            if (command.action === 'select')
              Object.assign(
                status.accounts.find((row) => row.id === command.accountId),
                { importIds: command.importIds, publishId: command.publishId },
              );
            if (command.action === 'apple')
              status.accounts.push({
                id: '248a8db9-5859-420b-b096-91e599371341',
                provider: 'apple',
                name: command.username,
                calendars: [{ id: 'private', name: '私人日历', writable: true }],
                importIds: [],
                publishId: null,
                checkedAt: 0,
                error: '',
                refreshing: false,
              });
            if (command.action === 'disconnect')
              status.accounts = status.accounts.filter((row) => row.id !== command.accountId);
            return { status: structuredClone(status) };
          },
        },
      },
    });
  }, configured);
  await page.getByRole('button', { name: '日程操作', exact: true }).click();
  await page.getByRole('button', { name: '连接日历账号', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '连接日历账号', exact: true });
  await expect(dialog.getByRole('button', { name: '登录 Google 日历', exact: true })).toBeEnabled();
  return dialog;
}

test('first connection configures one shared OAuth application and opens the system browser', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await seed(page);
  await dialog.getByRole('button', { name: '登录 Google 日历', exact: true }).click();
  await expect(dialog.getByLabel('登录数据中心地址')).toHaveValue('https://hub.example/dayweave');
  await expect(dialog.getByLabel('日历授权回调地址')).toHaveValue(
    'https://hub.example/dayweave/calendar-oauth/callback',
  );
  await dialog.getByText('注册登录应用', { exact: true }).click();
  await dialog.getByRole('button', { name: '打开 Google Cloud', exact: true }).click();
  await mkdir('.local/preview/calendar-accounts', { recursive: true });
  await page.screenshot({ path: '.local/preview/calendar-accounts/first-setup-390.png' });
  await dialog.getByLabel('日历客户端 ID').fill('registered-google-client');
  await dialog.getByLabel('日历客户端密钥').fill('test-secret');
  await dialog.getByRole('button', { name: '保存并登录', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('浏览器完成授权');
  const recorded = await page.evaluate(() => (window as any).calendarTest);
  expect(recorded.opened).toHaveLength(2);
  expect(recorded.opened[0]).toBe('https://console.cloud.google.com/apis/credentials');
  expect(recorded.calls.find((row: any) => row.action === 'configure')).toMatchObject({
    clientId: 'registered-google-client',
    clientSecret: 'test-secret',
  });
  await expect(dialog.getByLabel('日历客户端密钥')).toHaveCount(0);
});

test('connected accounts select import and publish calendars, connect iCloud and preserve data on disconnect', async ({
  page,
}) => {
  const dialog = await seed(page, true);
  const account = dialog.getByRole('region', { name: 'Google 日历账号 person@example.com' });
  await expect(account.getByLabel('导入 工作与生活')).toBeChecked();
  await account.getByLabel('导入 家庭日历').check();
  await account.getByLabel('person@example.com的发布日历').selectOption('primary');
  await expect(account.getByLabel('person@example.com的发布日历')).toHaveValue('primary');
  await expect(account.locator('select option')).toHaveCount(2);
  await mkdir('.local/preview/calendar-accounts', { recursive: true });
  await page.screenshot({ path: '.local/preview/calendar-accounts/desktop-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/preview/calendar-accounts/mobile-390.png' });
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '连接 Apple / iCloud', exact: true }).click();
  await dialog.getByLabel('Apple 账户邮箱').fill('apple@example.com');
  await dialog.getByLabel('Apple 应用专用密码').fill('aaaa-bbbb-cccc-dddd');
  await page.screenshot({ path: '.local/preview/calendar-accounts/icloud-390.png' });
  await dialog.getByRole('button', { name: '连接 iCloud 日历', exact: true }).click();
  await expect(
    dialog.getByRole('region', { name: 'Apple / iCloud账号 apple@example.com' }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Apple 应用专用密码')).toHaveCount(0);
  const before = await page.evaluate(() => localStorage.getItem('dayweave.v1'));
  page.once('dialog', (confirmation) => confirmation.accept());
  await account.getByRole('button', { name: '断开连接', exact: true }).click();
  await expect(account).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('dayweave.v1'))).toBe(before);
});
