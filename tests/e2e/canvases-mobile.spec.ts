import { test, expect } from '@playwright/test';
test.use({ hasTouch: true, isMobile: true });

test('creates and switches canvases with touch without losing a saved draft', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const catalog = await (await request.get('/api/canvases')).json();
  const primaryName = catalog.canvases.find(
    (entry: { id: string }) => entry.id === catalog.primary_id,
  ).name;
  await page.goto('/');
  await page.getByRole('button', { name: '切换画布', exact: true }).tap();
  let dialog = page.getByRole('dialog', { name: '画布管理', exact: true });
  await dialog.getByRole('button', { name: '新建画布', exact: true }).tap();
  await dialog.getByLabel('画布名称', { exact: true }).fill('手机里的第二张画布');
  await dialog.getByRole('button', { name: '创建画布', exact: true }).tap();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(
    '手机里的第二张画布',
  );
  await page.getByRole('button', { name: '開始第一段對話', exact: true }).tap();
  await page.getByLabel('给这段对话起个名字').fill('手机草稿独立保存');
  await page.getByRole('button', { name: '创建对话', exact: true }).tap();
  await page.getByLabel('你的问题', { exact: true }).fill('手机输入，普通标点。');
  await page.getByRole('button', { name: '切换画布', exact: true }).tap();
  dialog = page.getByRole('dialog', { name: '画布管理', exact: true });
  await dialog.getByRole('button', { name: primaryName, exact: true }).tap();
  await page.getByRole('button', { name: '切换画布', exact: true }).tap();
  dialog = page.getByRole('dialog', { name: '画布管理', exact: true });
  await dialog.getByRole('button', { name: '手机里的第二张画布', exact: true }).tap();
  const editor = page.getByLabel('你的问题', { exact: true });
  await expect(editor).toHaveValue('手机输入，普通标点。');
  await editor.press('Comma');
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
