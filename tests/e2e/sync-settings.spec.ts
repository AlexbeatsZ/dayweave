import { test, expect } from '@playwright/test';
import { emptyState } from '../../src/model';

test('sync settings edits ordered address lines without disconnecting or dropping the fallback', async ({
  page,
}) => {
  await page.addInitScript((state) => {
    let endpoint = 'http://192.168.31.32:49732';
    let delivery = 'local-error';
    Object.assign(window, {
      clearlist: {
        load: async () => ({ state, path: 'test', recovered: false }),
        save: async () => {},
        onBeforeClose: () => {},
        readyToClose: () => {},
        sync: {
          status: async () => ({
            mode: 'client',
            name: 'Test',
            endpoint,
            endpoints: endpoint.split('\n'),
            connected: false,
            delivery,
            pendingChanges: true,
            conflicts: [],
          }),
          setEndpoint: async (address: string) => {
            endpoint = address;
            delivery = 'offline';
            localStorage.setItem('new-sync-endpoint', address);
          },
          disconnect: async () => {
            throw new Error('Must preserve pairing');
          },
          now: async () => {
            delivery = 'synced';
          },
        },
      },
    });
  }, emptyState());
  await page.goto('/');
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  await expect(page.getByText('本地保存失败 · 暂停同步', { exact: true })).toBeVisible();
  await page.getByText('更换同步地址（保留配对）', { exact: true }).click();
  await expect(page.getByLabel('新的同步中心地址')).toHaveValue('http://192.168.31.32:49732');
  const addresses = 'https://sync.example.com/dayweave\n192.168.31.32:49732\n100.106.169.46:49732';
  await page.getByLabel('新的同步中心地址').fill(addresses);
  await page.getByRole('button', { name: '保存地址并同步', exact: true }).click();
  await expect(page.getByText('离线 · 本地已保存，待上传', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('new-sync-endpoint'))).toBe(addresses);
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await expect(page.getByText('已同步', { exact: true })).toBeVisible();
});
