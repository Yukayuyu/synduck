import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('phone Markdown picks use original offsets and return to the formatted highlight', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '手机 Markdown 来源', position: { x: -41000, y: -41000 } },
    })
  ).json();
  const response = await request.post('/api/send', {
    data: {
      request_id: crypto.randomUUID(),
      conversation_id: root.conversation.id,
      prompt: '手机格式预览\n\n## 小标题\n\n**引用🙂** 与行内 \x60code\x60。\n\n- 第一项\n- 第二项',
      selected_node_ids: [],
    },
  });
  expect(response.ok()).toBe(true);
  const zoom = 0.8;
  await request.patch('/api/workspace', {
    data: { viewport: { x: 24 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
  });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  await card.locator('.card-title').tap();
  const block = card.getByTestId('turn-assistant').getByTestId('content-block');
  await expect(block.getByRole('heading', { name: '小标题', exact: true })).toHaveCount(1);
  await expect(block.locator('code')).toHaveText('code');
  await block.locator('strong').evaluate((element) => {
    const text = element.querySelector('[data-source-start]')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .tap();
  const excerpt = page.locator('.canvas-card.excerpt.active');
  await expect(excerpt.locator('blockquote')).toHaveText('引用🙂');
  await excerpt.getByRole('button', { name: '回到来源并高亮', exact: true }).tap();
  await expect(block.locator('strong mark')).toHaveText('引用🙂');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone options keep geometry stable and local development opens with the same draft', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '手机开发入口', position: { x: -39000, y: -39000 } },
    })
  ).json();
  const zoom = 0.8;
  await request.patch('/api/workspace', {
    data: { viewport: { x: 24 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
  });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  await card.locator('.card-title').tap();
  const editor = card.getByLabel('你的问题', { exact: true });
  await editor.fill('在项目里检查源码，不修改文件。');
  // Opening a card also animates the canvas zoom. Compare layout dimensions,
  // not screen-space pixels sampled at different points of that animation.
  const before = await card.evaluate((element: HTMLElement) => ({
    width: element.offsetWidth,
    height: element.offsetHeight,
  }));
  await card.getByLabel('提问选项', { exact: true }).tap();
  await expect(card.getByLabel('上下文预算', { exact: true })).toBeVisible();
  const after = await card.evaluate((element: HTMLElement) => ({
    width: element.offsetWidth,
    height: element.offsetHeight,
  }));
  expect(after).toEqual(before);
  const menu = await card.locator('.composer-options').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  await card.getByLabel('提问选项', { exact: true }).tap();
  await editor.tap();
  await editor.press('Comma');
  await expect(editor).toBeFocused();
  const draft = await editor.inputValue();
  await card.getByRole('button', { name: '交给本地任务', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
  await expect(dialog.getByLabel('本地 AI 任務')).toHaveValue(draft);
  await expect(dialog.getByLabel('附上目前已預覽的畫布上下文')).toBeChecked();
  await dialog.getByRole('button', { name: '關閉本地任務', exact: true }).tap();
  await expect(editor).toHaveValue(draft);
  await card.getByRole('button', { name: '卡片操作：手机开发入口', exact: true }).tap();
  await page.getByRole('menuitem', { name: '调整对话框尺寸', exact: true }).tap();
  const size = page.getByRole('dialog', { name: '调整对话框尺寸', exact: true });
  await size.getByLabel('宽度', { exact: true }).fill('440');
  await size.getByLabel('高度', { exact: true }).fill('500');
  await size.getByRole('button', { name: '保存尺寸', exact: true }).tap();
  await expect(size).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
