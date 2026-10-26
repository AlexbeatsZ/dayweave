import { mkdir } from 'node:fs/promises';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { emptyState, newTask, dateKey, type AppState } from '../../src/model';
import { setTimeZone } from '../../src/timezone';

const title = '核对课程小组安排';
const row = (page: Page, id = 'parent') => page.locator(`.phone-content [data-task-id="${id}"]`);
const saved = (page: Page): Promise<AppState> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dayweave.v1')!));
async function sameCheckStyle(main: Locator, child: Locator) {
  const geometry = (element: Element) => {
    const css = getComputedStyle(element);
    return {
      width: css.width,
      height: css.height,
      radius: css.borderRadius,
      color: css.borderColor,
    };
  };
  const regular = await main.evaluate(geometry);
  expect(regular.width).toBe('23px');
  expect(regular.height).toBe('23px');
  expect(await child.evaluate(geometry)).toEqual(regular);
}

for (const phone of [true, false]) {
  test.describe(phone ? 'phone subtasks' : 'desktop subtasks', () => {
    test.use({
      viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: phone,
      hasTouch: phone,
      timezoneId: 'America/New_York',
    });

    test('inline completion shares ordinary checkboxes and persists across task views and editing', async ({
      page,
    }) => {
      setTimeZone('Asia/Shanghai');
      const state = emptyState();
      state.settings.theme = 'dark';
      state.lists.push({ id: 'study-list', name: '学习', color: '#76b9ed', order: 1 });
      state.tasks = [
        newTask(title, {
          id: 'parent',
          due: dateKey(),
          listId: 'study-list',
          order: 1,
          notes: '先核对成员，再提交名单。子任务在列表中直接处理。',
          tags: ['课程'],
          subtasks: [
            { id: 'check', title: '确认小组成员', done: false },
            { id: 'submit', title: '提交最终名单', done: false },
            {
              id: 'deadline',
              title: '核对截止日期与课程要求，保留很长的子任务名称以检查窄屏换行',
              done: true,
            },
          ],
        }),
        newTask('准备课堂材料', { id: 'second', due: dateKey(), listId: 'study-list', order: 2 }),
        newTask('未排期的小组想法', {
          id: 'undated',
          listId: 'study-list',
          order: 3,
          subtasks: [{ id: 'draft', title: '整理候选题目', done: false }],
        }),
      ];
      await page.addInitScript(
        (data) =>
          localStorage.setItem(
            'dayweave.v1',
            localStorage.getItem('dayweave.v1') ?? JSON.stringify(data),
          ),
        state,
      );
      await page.goto('/');
      const parent = row(page);
      const main = parent.locator(':scope > .task-check');
      const child = parent.getByRole('checkbox', { name: '子任务 确认小组成员', exact: true });
      await expect(child).toBeVisible();
      await expect(parent.locator('.task-subtask')).toHaveCount(3);
      await sameCheckStyle(main, child);
      await expect(main).toHaveText('1');
      await expect(row(page, 'second').locator(':scope > .task-check')).toHaveText('2');
      await expect(parent.locator('.task-meta')).toContainText('1/3');
      if (phone) await child.tap();
      else {
        await child.focus();
        await page.keyboard.press('Space');
      }
      await expect(child).toBeChecked();
      await expect(parent.locator('.task-meta')).toContainText('2/3');
      await expect(main).not.toBeChecked();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveClass(/task-sort-active/);
      expect((await saved(page)).timelog.timer).toBeNull();
      expect((await saved(page)).tasks.find((task) => task.id === 'parent')?.subtasks[0].done).toBe(
        true,
      );

      await parent.getByRole('button', { name: `编辑 ${title}`, exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
      const draft = editor.getByRole('checkbox', { name: '子任务 确认小组成员', exact: true });
      await expect(draft).toBeChecked();
      await sameCheckStyle(main, draft);
      await expect(editor.locator('.phone-subtasks input[type="checkbox"]')).toHaveCount(0);
      await draft.click();
      // Editor checkboxes remain draft-only until explicit Save.
      expect((await saved(page)).tasks.find((task) => task.id === 'parent')?.subtasks[0].done).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(editor).not.toBeVisible();
      await expect(child).toBeChecked();

      for (const tab of [/^周计划/, /^全部/, /^日计划/]) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(child).toBeVisible();
        await expect(child).toBeChecked();
      }
      await page.getByRole('button', { name: '四象限', exact: true }).click();
      await expect(child).toBeVisible();
      await child.click();
      await expect(child).not.toBeChecked();
      await expect(parent.locator('.task-meta')).toContainText('1/3');
      await page.getByRole('button', { name: '列表', exact: true }).click();
      await page.reload();
      await expect(child).not.toBeChecked();
      if (phone) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name: /^学习\s*\d+$/ }).click();
      await expect(child).toBeVisible();
      await child.click();
      await expect(child).toBeChecked();
      if (phone) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name: /^课程\s*\d+$/ }).click();
      await expect(child).toBeChecked();

      // Preview both the ordinary view and the editor using only synthetic data.
      const directory = 'release/subtasks-preview';
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: `${directory}/${phone ? 'phone' : 'desktop'}-list.png` });
      await parent.getByRole('button', { name: `编辑 ${title}`, exact: true }).click();
      await editor.getByRole('checkbox', { name: '子任务 提交最终名单', exact: true }).click();
      await page.screenshot({ path: `${directory}/${phone ? 'phone' : 'desktop'}-editor.png` });
      await editor.getByRole('button', { name: '保存任务', exact: true }).click();
      await expect(
        parent.getByRole('checkbox', { name: '子任务 提交最终名单', exact: true }),
      ).toBeChecked();
      expect((await saved(page)).tasks.find((task) => task.id === 'parent')?.notes).toBe(
        state.tasks[0].notes,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );

      await page.getByRole('button', { name: phone ? '手机待办' : '待办', exact: true }).click();
      await page.getByRole('tab', { name: /^待办箱/ }).click();
      const undated = row(page, 'undated').getByRole('checkbox', {
        name: '子任务 整理候选题目',
        exact: true,
      });
      await expect(undated).toBeVisible();
      await undated.click();
      await expect(undated).toBeChecked();
      await page.reload();
      await page.getByRole('tab', { name: /^待办箱/ }).click();
      await expect(undated).toBeChecked();
    });
  });
}
