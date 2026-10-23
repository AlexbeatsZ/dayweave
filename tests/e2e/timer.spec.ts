import { test, expect, type Page } from '@playwright/test';
import { emptyState, newTask, type AppState } from '../../src/model';
import { duration } from '../../src/timelog/domain';
import { dateTimeInput, setTimeZone, shiftDay, zoneDateKey } from '../../src/timezone';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/New_York',
});

const NOW = Date.parse('2026-10-23T14:13:00Z');
const PREVIOUS_END = NOW - 600000 + 12345;
const stored = (page: Page): Promise<AppState> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));

async function openTimer(page: Page) {
  await page.getByRole('button', { name: '手机记录', exact: true }).tap();
  await page.getByRole('tab', { name: '计时', exact: true }).tap();
  await expect(page.locator('.activity-timer-panel')).toBeVisible();
}

async function seed(page: Page) {
  setTimeZone('Asia/Shanghai');
  const day = zoneDateKey(NOW),
    state = emptyState();
  state.settings.theme = 'dark';
  state.tasks = [
    newTask('复习量子化学', { id: 'today-plan', due: day }),
    newTask('明天的计划', { id: 'tomorrow-plan', due: shiftDay(day, 1) }),
    newTask('未排期想法', { id: 'undated-plan', due: null }),
    newTask('已经完成的计划', {
      id: 'finished-plan',
      due: day,
      completedAt: new Date(NOW - 3600000).toISOString(),
    }),
    newTask('已删除的计划', {
      id: 'deleted-plan',
      due: day,
      deletedAt: new Date(NOW - 3600000).toISOString(),
    }),
  ];
  state.timelog.records = [
    {
      id: 'previous-record',
      activityId: 'study',
      note: '上一段有效记录',
      tags: ['历史标签'],
      spans: [{ start: NOW - 2400000, end: PREVIOUS_END }],
      pointsPerHour: 20,
      nature: 'positive',
      deletedAt: null,
      updatedAt: PREVIOUS_END,
    },
  ];
  state.tagColors.records = { 化学: '#76b9ed' };
  // Only Date is fixed. React intervals and browser animations still run normally.
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await openTimer(page);
}

async function back(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('clearlist:back', { cancelable: true })),
  );
}

test('countdown presets can be customized and persist; pause preserves remaining time and expiry saves the exact deadline once', async ({
  page,
}) => {
  test.setTimeout(60000);
  await seed(page);
  const presets = page.locator('.timer-presets');
  for (const minute of [5, 30, 45, 60]) {
    const preset = presets.getByRole('button', { name: `${minute} min`, exact: true });
    await preset.tap();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.activity-timer-panel .section-note')).toContainText(
      `倒计时 ${minute} 分钟`,
    );
  }
  await page.getByRole('button', { name: '管理倒计时预设', exact: true }).tap();
  const editor = page.getByRole('dialog', { name: '倒计时预设', exact: true });
  await editor.getByRole('button', { name: '删除 30 分钟预设', exact: true }).tap();
  await editor.getByLabel('预设分钟').fill('15');
  await editor.getByRole('button', { name: '添加预设', exact: true }).tap();
  await expect(editor.getByRole('button', { name: '删除 15 分钟预设', exact: true })).toBeVisible();
  await back(page);
  await page.reload();
  await openTimer(page);
  await expect(presets.getByRole('button', { name: /^\d+ min$/ })).toHaveText([
    '5 min',
    '15 min',
    '45 min',
    '60 min',
  ]);
  expect((await stored(page)).timelog.settings.timerPresets).toEqual([5, 15, 45, 60]);
  await presets.getByRole('button', { name: '15 min', exact: true }).tap();
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  const initial = (await stored(page)).timelog.timer!;
  expect(initial).toMatchObject({ startedAt: NOW, runningSince: NOW, plannedEndAt: NOW + 900000 });
  await expect(page.locator('.timer-detail-header')).toContainText('倒计时');
  await expect(page.getByLabel('计时时长')).toHaveText('00:15:00');
  await page.reload();
  await openTimer(page);
  expect((await stored(page)).timelog.timer?.id).toBe(initial.id);
  await page.clock.setFixedTime(NOW + 120000);
  await page.getByRole('button', { name: '暂停', exact: true }).tap();
  await expect(page.getByLabel('计时时长')).toHaveText('00:13:00');
  await page.clock.setFixedTime(NOW + 600000);
  await expect(page.locator('.timer-detail-header')).toContainText('已暂停');
  await expect(page.getByLabel('计时时长')).toHaveText('00:13:00');
  expect((await stored(page)).timelog.timer?.plannedEndAt).toBe(NOW + 900000);
  await page.getByRole('button', { name: '继续', exact: true }).tap();
  const deadline = NOW + 1380000;
  await expect.poll(async () => (await stored(page)).timelog.timer?.plannedEndAt).toBe(deadline);
  await page.getByRole('button', { name: '手机待办', exact: true }).tap();
  await expect(page.locator('.phone-timer-dock')).toBeVisible();
  // Simulate a device waking late: the record must end at its deadline, not at wake-up.
  await page.clock.setFixedTime(NOW + 1800000);
  await expect.poll(async () => (await stored(page)).timelog.timer).toBeNull();
  const closed = (await stored(page)).timelog.records.find((record) => record.id === initial.id)!;
  expect(closed.spans).toEqual([
    { start: NOW, end: NOW + 120000 },
    { start: NOW + 600000, end: deadline },
  ]);
  expect(duration(closed.spans)).toBe(900000);
  await expect(page.locator('.phone-timer-dock')).toHaveCount(0);
  await page.reload();
  expect(
    (await stored(page)).timelog.records.filter((record) => record.id === initial.id),
  ).toHaveLength(1);
});

test('start / future end, daily plan, labels and description survive seamless next activity; finish saves while cancel discards', async ({
  page,
}) => {
  test.setTimeout(60000);
  await seed(page);
  await expect(page.getByRole('button', { name: '上一条记录末尾', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  const times = page.getByRole('dialog', { name: '调整起止时间', exact: true });
  await times.getByLabel('活动开始时间').fill(dateTimeInput(NOW - 480000));
  await times.getByLabel('活动结束时间').fill(dateTimeInput(NOW + 1800000));
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  const firstId = (await stored(page)).timelog.timer!.id;
  expect((await stored(page)).timelog.timer).toMatchObject({
    startedAt: NOW - 480000,
    plannedEndAt: NOW + 1800000,
  });
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  await times.getByLabel('活动开始时间').fill(dateTimeInput(NOW - 360000));
  await times.getByLabel('活动结束时间').fill(dateTimeInput(NOW + 2700000));
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
  expect((await stored(page)).timelog.timer).toMatchObject({
    id: firstId,
    startedAt: NOW - 360000,
    runningSince: NOW - 360000,
    plannedEndAt: NOW + 2700000,
  });
  await expect(page.locator('.timer-detail-header')).toContainText('倒计时');
  await expect(page.getByLabel('相关计划').getByRole('option')).toHaveText([
    '不绑定计划',
    '复习量子化学',
  ]);
  await page.getByLabel('相关计划').selectOption('today-plan');
  await page.getByRole('button', { name: '编辑活动标签', exact: true }).tap();
  const tags = page.getByRole('dialog', { name: '相关标签', exact: true });
  await tags.getByRole('button', { name: '#化学', exact: true }).tap();
  await tags.getByLabel('计时标签').fill('化学，#复习，复习');
  await tags.getByRole('button', { name: '保存标签', exact: true }).tap();
  await page.getByLabel('计时描述').fill('先复习，再处理实验结果');
  // Clicking immediately after typing must retain the description's blur write.
  await page.getByRole('button', { name: '下一个活动', exact: true }).tap();
  const next = page.getByRole('dialog', { name: '下一个活动', exact: true });
  await next.locator('.activity-tile').filter({ hasText: '工作' }).tap();
  await expect(next).not.toBeVisible();
  const switched = await stored(page),
    first = switched.timelog.records.find((record) => record.id === firstId)!;
  expect(first).toMatchObject({
    activityId: 'study',
    taskId: 'today-plan',
    tags: ['化学', '复习'],
    note: '先复习，再处理实验结果',
  });
  expect(first.spans).toEqual([{ start: NOW - 360000, end: NOW }]);
  const second = switched.timelog.timer!;
  expect(second.id).not.toBe(firstId);
  expect(second).toMatchObject({
    activityId: 'work',
    startedAt: NOW,
    runningSince: NOW,
    note: '',
    tags: [],
  });
  expect(second.plannedEndAt ?? null).toBeNull();
  expect(second.taskId ?? null).toBeNull();
  expect(first.spans.at(-1)!.end).toBe(second.startedAt);
  await expect(page.locator('.timer-detail-header')).toContainText('正计时');

  await page.clock.setFixedTime(NOW + 90000);
  await page.getByLabel('计时描述').fill('处理完成的实验结果');
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  await expect(page.getByRole('tab', { name: '时间线', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const finished = await stored(page),
    secondRecord = finished.timelog.records.find((record) => record.id === second.id)!;
  expect(finished.timelog.timer).toBeNull();
  expect(secondRecord).toMatchObject({ note: '处理完成的实验结果', activityId: 'work' });
  expect(secondRecord.spans).toEqual([{ start: NOW, end: NOW + 90000 }]);
  expect(finished.timelog.records).toHaveLength(3);
  await page.getByRole('tab', { name: '计时', exact: true }).tap();
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  const cancelledId = (await stored(page)).timelog.timer!.id;
  await page.clock.setFixedTime(NOW + 180000);
  await page.getByLabel('计时描述').fill('这一段选择取消，不记入历史');
  await page.getByRole('button', { name: '取消', exact: true }).tap();
  await expect.poll(async () => (await stored(page)).timelog.timer).toBeNull();
  await page.reload();
  const cancelled = await stored(page);
  expect(cancelled.timelog.records).toHaveLength(3);
  expect(cancelled.timelog.records.some((record) => record.id === cancelledId)).toBe(false);
  expect(
    cancelled.timelog.records.filter((record) => [firstId, second.id].includes(record.id)),
  ).toHaveLength(2);
});

test('previous-record shortcut preserves seconds and milliseconds and untouched time edits retain that exact start', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  const times = page.getByRole('dialog', { name: '调整起止时间', exact: true });
  await times.getByRole('button', { name: '上一条记录末尾', exact: true }).tap();
  await expect(times.getByLabel('活动开始时间')).toHaveValue(dateTimeInput(PREVIOUS_END));
  await times.getByLabel('活动结束时间').fill(dateTimeInput(NOW + 300000));
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  const timer = (await stored(page)).timelog.timer!;
  expect(timer.startedAt).toBe(PREVIOUS_END);
  expect(timer.runningSince).toBe(PREVIOUS_END);
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
  expect((await stored(page)).timelog.timer?.startedAt).toBe(PREVIOUS_END);
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  await times.getByRole('button', { name: '清除结束时间，使用正计时', exact: true }).tap();
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
  await expect(page.locator('.timer-detail-header')).toContainText('正计时');
  expect((await stored(page)).timelog.timer?.plannedEndAt ?? null).toBeNull();
  await page.getByRole('button', { name: '完成', exact: true }).tap();
  const saved = (await stored(page)).timelog.records.find((record) => record.id === timer.id)!;
  expect(saved.spans[0].start).toBe(PREVIOUS_END);
  expect(saved.spans.at(-1)!.end).toBe(NOW);
});
