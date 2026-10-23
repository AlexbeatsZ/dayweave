import { test, expect } from '@playwright/test';
import { emptyState, newTask } from '../../src/model';
import { makeBackup, initialState } from '../../src/timelog/domain';

test.use({ timezoneId: 'America/New_York' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, emptyState());
});
test('Shanghai course stays 08:00 on a UTC-4 device and shows Sunday 20:00 with a 30 minute countdown', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-09-06T23:30:00Z'));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '安排', exact: true })
    .click();
  await page.getByRole('tab', { name: '课程表', exact: true }).click();
  await page.getByRole('button', { name: '课程操作', exact: true }).click();
  await page.getByText('更多', { exact: true }).click();
  await page.getByRole('button', { name: '学期与时区', exact: true }).click();
  await page.getByLabel('第一周的周一').fill('2026-09-07');
  await page.getByLabel('学期周数').fill('18');
  await page.getByRole('button', { name: '保存学期', exact: true }).click();
  await page.getByRole('button', { name: '课程操作', exact: true }).click();
  await page.getByRole('button', { name: '手动添加课程', exact: true }).click();
  await page.getByLabel('课程名称', { exact: true }).fill('量子化学（H）');
  await page.getByLabel('教室 / 地点').fill('H4306');
  await page.getByLabel('下课时间', { exact: true }).fill('09:40');
  await page.getByLabel('教学周', { exact: true }).fill('1-16');
  await page.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '编辑课程 量子化学（H）', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '安排', exact: true })
    .click();
  await page.getByRole('tab', { name: '课程表', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '编辑课程 量子化学（H）', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '待办', exact: true })
    .click();
  await expect(page.locator('.next-class')).toContainText('30 分钟');
  await expect(page.locator('.next-class')).toContainText('08:00–09:40');
  await expect(page.locator('.device-time')).toContainText('2026-09-06 20:00');
  await expect(page.locator('.next-class')).toContainText('H4306');
});
test('task starts a shared positive timer and timelog records persist through reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByLabel('新任务标题').fill('做量子化学习题');
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByRole('button', { name: '编辑 做量子化学习题', exact: true }).click();
  await page.getByRole('button', { name: '开始记录时间', exact: true }).click();
  await expect(page.locator('.timelog-module')).toBeVisible();
  await page.getByRole('tab', { name: '计时', exact: true }).click();
  await expect(page.getByLabel('计时描述')).toHaveValue('做量子化学习题');
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.record-card')).toContainText('做量子化学习题');
  await page.reload();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '记录', exact: true })
    .click();
  await expect(page.locator('.record-card')).toContainText('做量子化学习题');
});
test('course and full backup imports preserve both original project formats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  const old = JSON.parse(JSON.stringify(emptyState()));
  delete old.timelog;
  delete old.schedule;
  delete old.settings.timeZone;
  old.tasks = [newTask('旧 Clearlist 任务')];
  const picker = page.getByLabel('选择备份文件');
  await picker.setInputFiles({
    name: 'clearlist.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(old)),
  });
  await expect(page.getByRole('status')).toContainText('新增 1 件任务');
  const timelog = initialState();
  timelog.records = [
    {
      id: 'old-record',
      activityId: 'study',
      note: '旧时迹记录',
      tags: [],
      spans: [{ start: Date.now() - 600000, end: Date.now() - 1000 }],
      pointsPerHour: 20,
      nature: 'positive',
      updatedAt: Date.now(),
      deletedAt: null,
    },
  ];
  await picker.setInputFiles({
    name: 'timelog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(makeBackup(timelog))),
  });
  await expect(page.getByRole('status')).toContainText('导入完成');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '记录', exact: true })
    .click();
  await expect(page.locator('.record-card')).toContainText('旧时迹记录');
});
test('phone course and time destinations stay within screen width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '手机安排', exact: true }).click();
  await page.getByRole('tab', { name: '课程表' }).click();
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: '手机记录', exact: true }).click();
  await expect(page.locator('.timelog-module')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
