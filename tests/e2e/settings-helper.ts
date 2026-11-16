import type { Page } from '@playwright/test';

/** Opens Settings → 日程, where course import, semester, periods and calendar feeds live. */
export async function scheduleSettings(page: Page) {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  if (!(await dialog.isVisible())) {
    const drawer = page.getByRole('button', { name: '打开导航', exact: true });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole('button', { name: '设置与同步', exact: true }).click();
  }
  await dialog
    .getByRole('navigation', { name: '设置分类' })
    .getByRole('button', { name: '日程', exact: true })
    .click();
  return dialog;
}
