import { test, expect } from '@playwright/test';

test('keeps appearance and advanced input options reachable on a phone', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '更轻的移动画布', position: { x: -73000, y: -73000 } },
    })
  ).json();
  const zoom = 0.85;
  await request.patch('/api/workspace', {
    data: { viewport: { x: 20 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
  });
  await page.goto('/');
  await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '画布外观', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '给思路一种形状。' });
  await dialog.locator('input[value="paper"]').check();
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-canvas-style', 'paper');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  await card.getByLabel('你的问题', { exact: true }).fill('少一点界面，多一点思考。');
  await card.getByLabel('提问选项', { exact: true }).click();
  await expect(card.getByRole('button', { name: '预览上下文', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
