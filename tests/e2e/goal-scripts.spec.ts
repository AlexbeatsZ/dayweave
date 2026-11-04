import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { emptyState } from '../../src/model';
import { setDayStart, setTimeZone, wallTime } from '../../src/timezone';

const DAY = '2026-11-03';
const NOW = Date.parse('2026-11-03T06:00:00Z'); // 14:00 in Shanghai
setTimeZone('Asia/Shanghai');
setDayStart('00:00');
const at = (time: string) => wallTime(DAY, time);

async function seed(page: Page) {
  const state = emptyState();
  state.settings.theme = 'dark';
  state.timelog.records = [
    {
      id: 'study',
      activityId: 'study',
      note: '',
      tags: [],
      spans: [{ start: at('09:00'), end: at('11:00') }],
      nature: 'positive',
      deletedAt: null,
      updatedAt: at('11:00'),
    },
  ];
  state.timelog.scripts = [
    {
      id: 'focus',
      name: '学习时少用无关软件',
      code: await readFile('src/timelog/script-templates/focus-apps.js', 'utf8'),
      updatedAt: 1,
    },
  ];
  state.timelog.goals = [
    {
      id: 'focus-goal',
      name: '专心学习',
      period: 'day',
      archived: false,
      updatedAt: 1,
      kind: 'script',
      scriptId: 'focus',
      params: { apps: ['bilibili'] },
    },
  ];
  const usage = [
    { app: 'tv.danmaku.bilibili', start: at('09:30'), end: at('09:36') },
    { app: 'tv.danmaku.bilibili', start: at('12:00'), end: at('12:30') },
    { app: 'com.android.chrome', start: at('10:00'), end: at('10:20') },
  ].map((row, index) => ({
    id: `u${index}`,
    deviceId: 'phone',
    deviceName: 'Redmi',
    platform: 'android',
    source: 'dayweave',
    kind: 'app',
    title: '',
    url: '',
    category: '',
    revision: 1,
    deleted: false,
    ...row,
  }));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    ({ state, usage }) => {
      let saved = state;
      const status = {
        settings: {
          enabled: false,
          sampleSeconds: 10,
          idleMinutes: 5,
          browser: false,
          excludedApps: [],
          excludedDomains: [],
          excludedKeywords: [],
        },
        capture: 'off',
        error: '',
        pending: 0,
        count: usage.length,
        devices: [],
      };
      Object.assign(window, {
        clearlist: {
          load: async () => ({ state: saved, path: 'test', recovered: false }),
          save: async (next: typeof state) => {
            saved = next;
          },
          onBeforeClose: () => {},
          readyToClose: () => {},
          usage: {
            query: async (query: { start: number; end: number }) => ({
              events: usage.filter((row) => row.end > query.start && row.start < query.end),
              complete: true,
            }),
            status: async () => status,
            configure: async () => status,
            import: async () => 0,
            sync: async () => {},
          },
        },
      });
    },
    { state, usage },
  );
  await page.goto('/');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('tab', { name: '目标', exact: true }).click();
}

test('a library script judges a goal in a sandboxed worker from records and automatic usage', async ({
  page,
}) => {
  test.setTimeout(60000);
  await seed(page);
  // Only the 09:30–09:36 bilibili use overlaps the 09:00–11:00 study record.
  const card = page.locator('.goal-card', { hasText: '专心学习' });
  await expect(card).toContainText('学习时用无关软件 6 分钟 · 1 次');
  await expect(card).toContainText('学习时少用无关软件');

  await card.getByRole('button', { name: '编辑目标 专心学习' }).click();
  await expect(page.getByRole('radio', { name: /学习时少用无关软件/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByLabel('无关软件')).toHaveValue('bilibili');
  await page.getByRole('button', { name: '编辑脚本', exact: true }).click();
  const code = page.locator('.script-code');
  const run = page.getByRole('button', { name: '试运行', exact: true });

  // The page CSP and the worker lockdown leave no network access.
  await code.fill(
    "export default async function judge() { await fetch('https://example.com'); return true }",
  );
  await run.click();
  await expect(page.locator('.script-run')).toContainText('出错');
  await code.fill('export default async function judge(ctx) {\n  return ctx.nope.value\n}');
  await run.click();
  await expect(page.locator('.script-run')).toContainText(/出错：.*第 2 行/);
  await code.fill('export default async function judge() { while (true) {} }');
  await run.click();
  await expect(page.locator('.script-run')).toContainText('运行超过 10 秒，已停止', {
    timeout: 15000,
  });
  await code.fill(
    "export default async function judge(ctx) {\n  const tasks = await ctx.tasks()\n  ctx.log('tasks', tasks.length)\n  return { met: true, note: '自定义' }\n}",
  );
  await run.click();
  await expect(page.locator('.script-run')).toContainText('今天：达成 · 自定义');
  await expect(page.locator('.script-run pre')).toHaveText('tasks 0');
});
