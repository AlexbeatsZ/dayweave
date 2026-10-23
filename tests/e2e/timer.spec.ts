import { mkdir } from 'node:fs/promises';
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
  await page.getByRole('button', { name: /^(手机)?记录$/ }).click();
  await page.getByRole('tab', { name: '计时', exact: true }).click();
  await expect(page.locator('.activity-timer-panel')).toBeVisible();
}

async function seed(page: Page, configure?: (state: AppState) => void) {
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
  configure?.(state);
  // Only Date is fixed. React intervals and browser animations still run normally.
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await openTimer(page);
  await page.locator('.activity-library').scrollIntoViewIfNeeded();
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
  await expect(page.getByRole('button', { name: '正计时', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '调整起止时间', exact: true })).toHaveCount(0);
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  const presets = page.locator('.timer-presets');
  for (const minute of [5, 30, 45, 60]) {
    const preset = presets.getByRole('button', { name: `${minute} min`, exact: true });
    await preset.tap();
    await expect(preset).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('计时时长')).toHaveText(
      `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`,
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
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  const times = page.getByRole('dialog', { name: '调整起止时间', exact: true });
  await times.getByLabel('活动开始时间').fill(dateTimeInput(NOW - 480000));
  await times.getByLabel('活动结束时间').fill(dateTimeInput(NOW + 1800000));
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
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
  await page.locator('.activity-tile').filter({ hasText: '学习' }).tap();
  await page.getByRole('button', { name: '调整起止时间', exact: true }).tap();
  const times = page.getByRole('dialog', { name: '调整起止时间', exact: true });
  await times.getByRole('button', { name: '上一条记录末尾', exact: true }).tap();
  await expect(times.getByLabel('活动开始时间')).toHaveValue(dateTimeInput(PREVIOUS_END));
  await times.getByLabel('活动结束时间').fill(dateTimeInput(NOW + 300000));
  await times.getByRole('button', { name: '保存起止时间', exact: true }).tap();
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

test('each activity group can create with its nature; touch hold opens before release and preserves the editor after release', async ({
  page,
}) => {
  await seed(page);
  await expect(page.getByRole('button', { name: '管理活动', exact: true })).toHaveCount(0);
  await expect(page.locator('.timer-presets')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '调整起止时间', exact: true })).toHaveCount(0);
  await mkdir('release/activity-interactions-preview', { recursive: true });
  await expect(page.locator('.activity-group')).toHaveCount(3);
  for (const group of await page.locator('.activity-group').all())
    await expect(group.locator('.activity-grid > :last-child')).toHaveClass('activity-create');
  await page.screenshot({ path: 'release/activity-interactions-preview/phone-activities.png' });
  const activity = page.getByRole('button', { name: '开始 学习', exact: true });
  const box = (await activity.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await page.waitForTimeout(550);
  const edit = page.getByRole('dialog', { name: '编辑活动', exact: true });
  // The editor must already be open while the finger is still held down.
  await expect(edit).toBeVisible();
  expect((await stored(page)).timelog.timer).toBeNull();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(edit).toBeVisible();
  await page.screenshot({ path: 'release/activity-interactions-preview/phone-edit-activity.png' });
  expect((await stored(page)).timelog.timer).toBeNull();
  await edit.getByLabel('活动名称', { exact: true }).fill('学习与复习');
  await edit.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始 学习与复习', exact: true })).toBeVisible();
  const create = page.getByRole('dialog', { name: '添加活动', exact: true });
  for (const [label, nature, name] of [
    ['积极', 'positive', '整理讲义'],
    ['日常', 'neutral', '晚间散步'],
    ['消极', 'negative', '无目的浏览'],
  ]) {
    await page.getByRole('button', { name: `新建${label}活动`, exact: true }).tap();
    await expect(create.getByRole('combobox', { name: '性质', exact: true })).toHaveValue(nature);
    await create.getByLabel('活动名称', { exact: true }).fill(name);
    await create.getByRole('button', { name: '保存', exact: true }).click();
    expect((await stored(page)).timelog.activities.find((row) => row.name === name)?.nature).toBe(
      nature,
    );
    await expect(
      page
        .getByRole('region', { name: `${label}活动`, exact: true })
        .getByRole('button', { name: `开始 ${name}`, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: '开始 整理讲义', exact: true }).tap();
  await expect(page.getByLabel('计时时长')).toBeVisible();
  await expect(page.getByRole('button', { name: '调整起止时间', exact: true })).toBeVisible();
  await expect(page.locator('.timer-presets')).toBeVisible();
  await page.clock.setFixedTime(NOW + 780000);
  await expect(page.getByLabel('计时时长')).toHaveText('00:13:00');
  await page.screenshot({ path: 'release/activity-interactions-preview/phone-running.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'release/activity-interactions-preview/desktop-running.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({ path: 'release/activity-interactions-preview/desktop-activities.png' });
});

for (const distance of [10, 30]) {
  test(
    'touch movement of ' + distance + ' px cancels activity editing and does not start a timer',
    async ({ page }) => {
      await seed(page);
      const box = (await page
        .getByRole('button', { name: '开始 学习', exact: true })
        .boundingBox())!;
      const touch = await page.context().newCDPSession(page);
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + distance }],
      });
      await page.waitForTimeout(550);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.getByRole('dialog', { name: '编辑活动', exact: true })).toHaveCount(0);
      expect((await stored(page)).timelog.timer).toBeNull();
      await page.getByRole('button', { name: '开始 学习', exact: true }).tap();
      await expect(page.getByLabel('计时时长')).toBeVisible();
      await touch.detach();
    },
  );
}

test.describe('desktop activity controls', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test('mouse exposes an edit action without long hold, while context menu and F2 use the same editor', async ({
    page,
  }) => {
    await seed(page);
    const activity = page.getByRole('button', { name: '开始 学习', exact: true });
    const editButton = page.getByRole('button', { name: '编辑 学习', exact: true });
    await expect(editButton).toBeVisible();
    await expect(editButton).toHaveCSS('opacity', '1');
    await activity.hover();
    await mkdir('release/activity-interactions-preview', { recursive: true });
    await page.screenshot({ path: 'release/activity-interactions-preview/desktop-pointer.png' });
    await editButton.click();
    const editor = page.getByRole('dialog', { name: '编辑活动', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('活动名称', { exact: true })).toHaveValue('学习');
    expect((await stored(page)).timelog.timer).toBeNull();
    await back(page);
    await activity.click({ button: 'right' });
    await expect(editor).toBeVisible();
    await back(page);
    await activity.focus();
    await activity.press('F2');
    await expect(editor).toBeVisible();
    await back(page);
    await activity.press('Shift+F10');
    await expect(editor).toBeVisible();
    await back(page);
    await activity.press('Tab');
    await expect(editButton).toBeFocused();
    await editButton.press('Enter');
    await expect(editor).toBeVisible();
    await back(page);
    await activity.focus();
    await activity.press('Enter');
    await expect(page.getByLabel('计时时长')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const box = (await activity.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await expect(editor).toHaveCount(0);
    await page.mouse.up();
    await expect(page.getByLabel('计时时长')).toBeVisible();
    expect((await stored(page)).timelog.timer?.activityId).toBe('study');
  });
});

for (const ending of ['move', 'cancel', 'editor-control'] as const) {
  test('touch hold keeps its editor and timer state after ' + ending, async ({ page }) => {
    await seed(page);
    const before = (await stored(page)).timelog;
    const activity = page.getByRole('button', { name: '开始 学习', exact: true });
    const box = (await activity.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    const editor = page.getByRole('dialog', { name: '编辑活动', exact: true });
    await expect(editor).toBeVisible();
    expect((await stored(page)).timelog).toEqual(before);
    if (ending === 'move') {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + 100, y }],
      });
    }
    if (ending === 'editor-control') {
      const cancel = (await editor
        .getByRole('button', { name: '取消', exact: true })
        .boundingBox())!;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cancel.x + cancel.width / 2, y: cancel.y + cancel.height / 2 }],
      });
    }
    await touch.send('Input.dispatchTouchEvent', {
      type: ending === 'cancel' ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    await expect(editor).toBeVisible();
    await expect(page.getByRole('tab', { name: '计时', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect((await stored(page)).timelog).toEqual(before);
    // The release guard must not swallow the next real tap or leak past dismissal.
    await editor.getByRole('button', { name: '取消', exact: true }).tap();
    await expect(editor).toHaveCount(0);
    await activity.tap();
    await expect(page.getByLabel('计时时长')).toBeVisible();
    expect((await stored(page)).timelog.timer?.activityId).toBe('study');
    await touch.detach();
  });
}

test('empty activity groups retain create tiles, cancel is read-only and nature remains editable', async ({
  page,
}) => {
  await seed(page, (state) => {
    for (const activity of state.timelog.activities) activity.archived = true;
  });
  const before = (await stored(page)).timelog;
  const editor = page.getByRole('dialog', { name: '添加活动', exact: true });
  for (const [label, nature] of [
    ['积极', 'positive'],
    ['日常', 'neutral'],
    ['消极', 'negative'],
  ]) {
    const group = page.getByRole('region', { name: label + '活动', exact: true });
    await expect(group.locator('.activity-tile')).toHaveCount(0);
    await expect(group.locator('.activity-grid > :last-child')).toHaveClass('activity-create');
    await group.getByRole('button', { name: '新建' + label + '活动', exact: true }).tap();
    await expect(editor.getByRole('combobox', { name: '性质', exact: true })).toHaveValue(nature);
    await editor.getByLabel('活动名称', { exact: true }).fill('取消的草稿');
    await editor.getByRole('button', { name: '取消', exact: true }).tap();
    await expect(editor).toHaveCount(0);
    expect((await stored(page)).timelog).toEqual(before);
  }
  await page.getByRole('button', { name: '新建消极活动', exact: true }).tap();
  await expect(editor.getByLabel('活动名称', { exact: true })).toBeEmpty();
  await editor.getByLabel('活动名称', { exact: true }).fill('自选性质活动');
  await editor.getByRole('combobox', { name: '性质', exact: true }).selectOption('neutral');
  await editor.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(editor).toHaveCount(0);
  expect(
    (await stored(page)).timelog.activities.find((row) => row.name === '自选性质活动'),
  ).toMatchObject({ nature: 'neutral', pointsPerHour: 0 });
  await page.reload();
  await openTimer(page);
  await expect(
    page
      .getByRole('region', { name: '日常活动', exact: true })
      .getByRole('button', { name: '开始 自选性质活动', exact: true }),
  ).toBeVisible();
});

test('cancelled touch before the hold threshold never edits or starts and the following tap still starts', async ({
  page,
}) => {
  await seed(page);
  const before = (await stored(page)).timelog;
  const activity = page.getByRole('button', { name: '开始 学习', exact: true });
  const box = (await activity.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(550);
  await expect(page.getByRole('dialog', { name: '编辑活动', exact: true })).toHaveCount(0);
  expect((await stored(page)).timelog).toEqual(before);
  await activity.tap();
  await expect(page.getByLabel('计时时长')).toBeVisible();
  await touch.detach();
});

test('horizontal swipe before hold still changes tabs without editing or starting', async ({
  page,
}) => {
  await seed(page);
  const box = (await page.getByRole('button', { name: '开始 学习', exact: true }).boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 100, y }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('tab', { name: '时间线', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.waitForTimeout(550);
  await expect(page.getByRole('dialog', { name: '编辑活动', exact: true })).toHaveCount(0);
  expect((await stored(page)).timelog.timer).toBeNull();
  await touch.detach();
});

async function checkGalleryBounds(page: Page) {
  const overflow = await page.locator('.activity-group').evaluateAll((groups) =>
    groups.flatMap((group) => {
      const bounds = group.getBoundingClientRect();
      return [
        ...group.querySelectorAll(
          '.activity-tile, .activity-mark, .activity-create, .activity-edit',
        ),
      ]
        .filter((node) => {
          if (getComputedStyle(node).display === 'none') return false;
          const box = node.getBoundingClientRect();
          return (
            box.left < bounds.left - 1 ||
            box.right > bounds.right + 1 ||
            box.left < 0 ||
            box.right > window.innerWidth ||
            (node.classList.contains('activity-mark') &&
              box.width > node.parentElement!.getBoundingClientRect().width)
          );
        })
        .map((node) => node.className);
    }),
  );
  expect(overflow).toEqual([]);
  await expect(page.locator('.activity-group')).toHaveCount(3);
  for (const group of await page.locator('.activity-group').all())
    await expect(group.locator('.activity-grid > :last-child')).toHaveClass('activity-create');
}

test('phone activity gallery keeps all group actions in bounds at narrow widths', async ({
  page,
}) => {
  await seed(page);
  await mkdir('release/activity-interactions-preview', { recursive: true });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await checkGalleryBounds(page);
    await expect(page.getByRole('button', { name: '编辑 学习', exact: true })).toBeHidden();
    await page.screenshot({
      path: 'release/activity-interactions-preview/phone-' + width + '.png',
    });
  }
});

test.describe('desktop gallery sizing', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test('fine-pointer editing stays visible and in bounds in narrow and wide windows', async ({
    page,
  }) => {
    await seed(page);
    await mkdir('release/activity-interactions-preview', { recursive: true });
    for (const width of [900, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await checkGalleryBounds(page);
      await expect(page.getByRole('button', { name: '编辑 学习', exact: true })).toHaveCSS(
        'opacity',
        '1',
      );
      await page.screenshot({
        path: 'release/activity-interactions-preview/desktop-' + width + '.png',
      });
    }
  });
});
