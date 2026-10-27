import { test, expect, type Page } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';

async function boot(page: Page) {
  const state = emptyState();
  state.tasks.push(newTask('Saved task'));
  await page.addInitScript(
    (initial) => localStorage.setItem('dayweave.v1', JSON.stringify(initial)),
    state,
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: '设置与同步', exact: true })).toBeVisible();
}

async function edit(page: Page, title: string) {
  return page.evaluate(async (value) => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    try {
      await store.transact((state: ReturnType<typeof emptyState>) => ({
        ...state,
        tasks: [{ ...state.tasks[0], title: value }],
      }));
      return '';
    } catch (error) {
      return String(error);
    }
  }, title);
}

async function optimistic(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    return store.get().tasks[0].title;
  });
}

test('disk failure retains the pending edit, blocks further optimistic changes and retries from the UI', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    Object.assign(window, {
      clearlist: {
        save: async () => {
          throw new Error('disk full');
        },
      },
    });
  });
  expect(await edit(page, 'Pending edit')).toContain('disk full');
  await page.evaluate(async () => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    store.patchTask(store.get().tasks[0].id, { title: 'Must not queue' });
  });
  expect(await optimistic(page)).toBe('Pending edit');
  await expect(page.getByRole('button', { name: '重试保存', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.clearlist!.save = async (state) => {
      localStorage.setItem('dayweave.v1', JSON.stringify(state));
    };
  });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks[0].title),
  ).toBe('Pending edit');
  expect(await edit(page, 'Next edit')).toBe('');
});

test('conflict recovery requires confirmation; canceled export and failed reload preserve the pending queue', async ({
  page,
}, testInfo) => {
  await boot(page);
  await page.evaluate(() => {
    Object.assign(window, {
      clearlist: {
        patch: async () => {
          throw new Error('STATE_CONFLICT: conflicting title');
        },
        exportData: async () => false,
        load: async () => {
          throw new Error('network read failed');
        },
      },
    });
  });
  expect(await edit(page, 'Local candidate')).toContain('并发冲突');
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '重新检查冲突' })).toBeVisible();
  await page.getByRole('button', { name: '重新读取已保存数据', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重新读取已保存数据' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('recovery-phone.png') });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await optimistic(page)).toBe('Local candidate');
  await page.getByRole('button', { name: '重新读取已保存数据', exact: true }).click();
  await dialog.getByRole('button', { name: '导出备份后重新读取' }).click();
  await expect(dialog).toBeVisible();
  expect(await optimistic(page)).toBe('Local candidate');
  await dialog.getByRole('button', { name: '放弃未保存修改并重新读取' }).click();
  await expect(page.locator('.error-banner')).toContainText('重新读取失败，未保存内容仍保留');
  expect(await optimistic(page)).toBe('Local candidate');
  await page.evaluate(() => {
    window.clearlist!.load = async () => ({
      state: JSON.parse(localStorage.getItem('dayweave.v1')!),
      recovered: false,
      path: 'test',
      revision: 'test:2',
    });
    window.clearlist!.exportData = async (state) => {
      localStorage.setItem('exported-candidate', JSON.stringify(state));
      return true;
    };
  });
  await page.getByRole('button', { name: '重新读取已保存数据', exact: true }).click();
  await dialog.getByRole('button', { name: '导出备份后重新读取' }).click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(await optimistic(page)).toBe('Saved task');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('exported-candidate')!).tasks[0].title,
    ),
  ).toBe('Local candidate');
  await page.evaluate(() => {
    delete window.clearlist!.patch;
    window.clearlist!.save = async (state) => {
      localStorage.setItem('dayweave.v1', JSON.stringify(state));
    };
  });
  expect(await edit(page, 'After recovery')).toBe('');
});

test('browser corruption recovery rejects invalid backups and preserves damaged bytes', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('dayweave.v1', 'broken primary');
    localStorage.setItem('dayweave.v1.backup', 'broken backup');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '选择备份恢复' })).toBeVisible();
  const picker = page.getByLabel('选择恢复备份');
  await picker.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.locator('.loading-screen')).toContainText('恢复失败');
  expect(await page.evaluate(() => localStorage.getItem('dayweave.v1'))).toBe('broken primary');
  const backup = emptyState();
  backup.tasks.push(newTask('Recovered task'));
  await picker.setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator('.recovery-banner')).toBeVisible();
  expect(await optimistic(page)).toBe('Recovered task');
  const preserved = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((name) => name.includes('before-restore'))
      .map((name) => localStorage.getItem(name))
      .sort(),
  );
  expect(preserved).toEqual(['broken backup', 'broken primary']);
  expect(await edit(page, 'Recovered and edited')).toBe('');
});

test('native load failure exposes restore, cancellation is safe, restored data can be saved', async ({
  page,
}) => {
  const backup = emptyState();
  backup.tasks.push(newTask('Native restored'));
  await page.addInitScript((state) => {
    let attempts = 0;
    Object.assign(window, {
      clearlist: {
        load: async () => {
          throw new Error('damaged primary and backup');
        },
        restoreData: async () =>
          ++attempts === 1 ? null : { state, recovered: true, path: 'native test' },
        save: async (value: unknown) => {
          localStorage.setItem('native-saved', JSON.stringify(value));
        },
        onBeforeClose: () => {},
        readyToClose: () => {},
      },
    });
  }, backup);
  await page.goto('/');
  await page.getByRole('button', { name: '选择备份恢复' }).click();
  await expect(page.locator('.loading-screen')).toContainText('damaged primary');
  await page.getByRole('button', { name: '选择备份恢复' }).click();
  await expect(page.locator('.recovery-banner')).toBeVisible();
  expect(await edit(page, 'Native next edit')).toBe('');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('native-saved')!).tasks[0].title),
  ).toBe('Native next edit');
});
