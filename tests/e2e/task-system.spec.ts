import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  emptyState,
  newTask,
  dateKey,
  shiftDate,
  changeSubtask,
  type AppState,
} from '../../src/model';
import { configureRepeat, generateRepeatedTasks } from '../../src/task-repeat';
import { setTimeZone, setDayStart, businessDayStart } from '../../src/timezone';

setTimeZone('Asia/Shanghai');
setDayStart('04:00');
async function seed(page: Page, state: AppState) {
  state.settings.timeZone = 'Asia/Shanghai';
  state.settings.dayStartsAt = '04:00';
  state.settings.theme = 'dark';
  await page.addInitScript((data) => {
    if (!localStorage.getItem('dayweave.v1'))
      localStorage.setItem('dayweave.v1', JSON.stringify(data));
  }, state);
  await page.goto('/');
  await expect(page.locator('[data-layout]')).toBeVisible();
}

for (const width of [390, 1440]) {
  test.describe(`task model at ${width}px`, () => {
    test.use({ viewport: { width, height: 960 }, hasTouch: width < 700, isMobile: width < 700 });
    test('date range, per-day slots, infinity and manual difficulty persist without changing time fields', async ({
      page,
    }) => {
      await seed(page, emptyState());
      await page.getByRole('button', { name: '新建任务', exact: true }).click();
      const form = page.getByRole('dialog', { name: '新建任务', exact: true });
      await form.getByLabel('新任务标题').fill('跨日复习生化');
      await expect(form.getByLabel('任务难度', { exact: true })).toHaveValue('easy');
      await expect(form.getByLabel('任务难度').locator('option')).toHaveCount(3);
      await form.getByLabel('任务难度').selectOption('hard');
      const today = dateKey(),
        end = shiftDate(today, 2);
      await form.getByLabel('结束日期', { exact: true }).fill(end);
      await form.getByRole('button', { name: '添加日期', exact: true }).click();
      await form.getByRole('button', { name: `新建 ${today} 时段`, exact: true }).click();
      const group = page.getByRole('dialog', { name: '新的时段', exact: true });
      await group.getByLabel('时段名称').fill('午饭前');
      await group.getByRole('button', { name: '创建时段', exact: true }).click();
      await expect(form.getByLabel(`${today} 时段`, { exact: true })).not.toHaveValue('');
      await expect(form.getByLabel(`${end} 时段`, { exact: true })).toHaveValue('');
      await form.getByRole('button', { name: '∞ 总视图保留', exact: true }).click();
      await form.getByLabel('预计用时', { exact: true }).fill('180');
      await form.getByLabel('实际用时', { exact: true }).fill('20');
      await form.getByLabel('新任务子任务').fill('复制');
      await form.getByLabel('新任务子任务').press('Enter');
      await form.getByRole('button', { name: '添加任务', exact: true }).click();
      await expect(form).not.toBeVisible();
      const row = page.getByTestId('task-row');
      await expect(row).toHaveClass(/difficulty-hard/);
      await expect(row.locator('.difficulty-tier')).toHaveText('困难');
      await expect(row).not.toContainText('逾期');
      await page.reload();
      await page.getByRole('button', { name: '编辑 跨日复习生化', exact: true }).click();
      const edit = page.getByRole('dialog', { name: '编辑任务', exact: true });
      await expect(edit.getByLabel('预计用时', { exact: true })).toHaveValue('180');
      await expect(edit.getByLabel('实际用时', { exact: true })).toHaveValue('20');
      const output = path.resolve('.local/preview/task-system');
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: `${output}/editor-${width}.png`, fullPage: true });
      await edit.evaluate((element) =>
        element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }),
      );
      await expect(edit.getByLabel('任务难度', { exact: true })).toBeInViewport();
      await page.screenshot({ path: `${output}/difficulty-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await edit.getByRole('button', { name: '保存任务', exact: true }).click();
      const saved = await page.evaluate(
        () => JSON.parse(localStorage.getItem('dayweave.v1')!).tasks[0],
      );
      expect(Object.keys(saved.dates)).toHaveLength(4);
      expect(saved.dates['∞']).toBeNull();
      expect(saved.id).toMatch(/-0$/);
      expect(saved.difficulty).toBe('hard');
    });

    test('history keeps only that day’s child facts; today keeps remaining work and current-day completion', async ({
      page,
    }) => {
      const today = dateKey(),
        yesterday = shiftDate(today, -1),
        state = emptyState();
      let task = newTask('多日任务', {
        dates: { [yesterday]: null, [today]: null },
        subtasks: [
          { id: 'dna', title: 'DNA 复制', done: false },
          { id: 'rna', title: '转录', done: false },
          { id: 'protein', title: '翻译', done: false },
        ],
      });
      task = changeSubtask(
        task,
        'dna',
        { done: true },
        new Date(businessDayStart(yesterday) + 5 * 3600000).toISOString(),
      );
      task = changeSubtask(
        task,
        'rna',
        { done: true },
        new Date(businessDayStart(today) + 5 * 3600000).toISOString(),
      );
      state.tasks = [task];
      await seed(page, state);
      const row = page.getByTestId('task-row');
      await expect(row.getByRole('checkbox', { name: '子任务 DNA 复制', exact: true })).toHaveCount(
        0,
      );
      await expect(row.getByRole('checkbox', { name: '子任务 转录', exact: true })).toBeChecked();
      await expect(
        row.getByRole('checkbox', { name: '子任务 翻译', exact: true }),
      ).not.toBeChecked();
      await page.getByLabel('待办日期', { exact: true }).fill(yesterday);
      await expect(
        row.getByRole('checkbox', { name: '子任务 DNA 复制', exact: true }),
      ).toBeChecked();
      await expect(
        row.getByRole('checkbox', { name: '子任务 DNA 复制', exact: true }),
      ).toBeDisabled();
      await expect(row.getByRole('checkbox', { name: '子任务 转录', exact: true })).toHaveCount(0);
      await expect(row.getByRole('checkbox', { name: '子任务 翻译', exact: true })).toHaveCount(0);
      await expect(row).toContainText('当日安排');
    });

    test('overview folds instances by ID, history stays searchable, and offline instance editing keeps its template', async ({
      page,
    }) => {
      const today = dateKey();
      const state = emptyState();
      const task = newTask('背单词', { dates: { [today]: null } });
      state.tasks = [task];
      const generated = generateRepeatedTasks(
        configureRepeat(state, task, '0 4 * * *'),
        shiftDate(today, 7),
      );
      generated.tasks.push(
        newTask('同名但独立', { dates: { '∞': null } }),
        newTask('历史的实验', { dates: { [shiftDate(today, -1)]: null } }),
      );
      await seed(page, generated);
      await page.getByRole('tab', { name: /^全部/ }).click();
      await expect(page.locator('.task-series')).toHaveCount(1);
      await expect(page.locator('[data-testid=task-row]:visible')).toHaveCount(1);
      await page.locator('.task-series summary').click();
      await expect(page.getByTestId('task-row')).toHaveCount(9);
      await page.getByRole('button', { name: '编辑 背单词', exact: true }).first().click();
      const form = page.getByRole('dialog', { name: '编辑任务', exact: true });
      await form.getByLabel('任务标题').fill('只改今天这一项');
      await form.getByRole('button', { name: '保存任务', exact: true }).click();
      await expect(form).not.toBeVisible();
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem('dayweave.v1')!).repeatRules[0].template.title,
        ),
      ).toBe('背单词');
      await page.getByLabel('搜索任务与历史').fill('历史的实验');
      await expect(page.getByTestId('task-row')).toHaveCount(1);
      await expect(page.getByTestId('task-row')).toContainText('历史的实验');
    });
  });
}
