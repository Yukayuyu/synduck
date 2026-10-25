import { test, expect } from '@playwright/test';
test.use({ hasTouch: true, isMobile: true });

test('adds and sends a side question with touch controls and native punctuation input', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const root = await (
    await request.post('/api/conversations', {
      data: {
        title: '移动端分叉输入',
        position: { x: -91000, y: -91000 },
      },
    })
  ).json();
  const zoom = 0.8;
  await request.patch('/api/workspace', {
    data: {
      viewport: {
        x: 20 - root.node.x * zoom,
        y: 110 - root.node.y * zoom,
        zoom,
      },
    },
  });
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').tap();
  await card.getByLabel('添加分支问题', { exact: true }).tap();
  await card.getByRole('button', { name: '顺手问 /btw', exact: true }).tap();
  const editor = card.getByLabel('分支问题 1', { exact: true });
  await editor.fill('顺便问一下，中文、逗号。');
  await editor.evaluate((element) => Reflect.set(window, 'phoneForkEditor', element));
  await editor.press('Comma');
  await expect(editor).toHaveValue('顺便问一下，中文、逗号。,');
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) => element === Reflect.get(window, 'phoneForkEditor')),
  ).toBe(true);
  await card.getByRole('button', { name: '分别发送 1', exact: true }).tap();
  await expect(card.locator('.thread-branch-index summary')).toHaveText('1 个分支 · 0 待答');
  await card.locator('.thread-branch-index summary').tap();
  await card.locator('.thread-branch-index').getByRole('button').tap();
  await expect(
    page.locator('.canvas-card.conversation.active').getByTestId('turn-assistant'),
  ).toContainText('本地演示');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
