import { test, expect } from '@playwright/test';
test('imports pasted reference, explicitly sends it as context and restores the document after reload', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '匯入參考', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '匯入參考' });
  await dialog.getByLabel('參考名稱').fill('產品參考文件');
  const text = '文檔原文🙂\n\n每個結論都必須保留來源，禁止靜默刪除。';
  await dialog.getByLabel('參考文字').fill(text);
  await dialog.getByRole('button', { name: '匯入畫布' }).click();
  const ref = page.locator('.canvas-card.reference.active');
  await expect(ref.getByTestId('content-block')).toHaveText(text);
  await expect(ref.getByRole('button', { name: '加入本輪上下文' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await ref.getByRole('button', { name: '以此提問', exact: true }).click();
  const conversation = page.locator('.canvas-card.conversation.active');
  await conversation.getByLabel('你的问题', { exact: true }).fill('請解釋這份規格。');
  await conversation.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(conversation.getByTestId('turn-assistant')).toContainText('每個結論都必須保留來源');
  const state = await (await request.get('/api/state')).json();
  const node = state.nodes.find((n: { title: string }) => n.title === '產品參考文件');
  expect(
    state.packages.some((p: { items: { node_id: string; content: string }[] }) =>
      p.items.some((i) => i.node_id === node.id && i.content === text),
    ),
  ).toBe(true);
  await page.reload();
  const saved = page.locator('.react-flow__node[data-id="' + node.id + '"]');
  await saved.locator('.card-title').click();
  await expect(saved.getByTestId('content-block')).toHaveText(text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('imports Markdown and picks exact source with a branch and source highlight', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '匯入參考', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '匯入參考' });
  await dialog.getByLabel('選擇文件').setInputFiles({
    name: 'Reference.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 來源文件\n\n**必要來源🙂** 不可遺忘。\n'),
  });
  await dialog.getByRole('button', { name: '改用貼上文字' }).click();
  await expect(dialog.getByLabel('選擇文件')).toHaveValue('');
  await dialog
    .getByLabel('選擇文件')
    .setInputFiles({
      name: 'Reference.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 來源文件\n\n**必要來源🙂** 不可遺忘。\n'),
    });
  await dialog.getByRole('button', { name: '匯入畫布' }).click();
  const ref = page.locator('.canvas-card.reference.active');
  await expect(ref.getByRole('heading', { name: '來源文件' })).toBeVisible();
  await ref
    .locator('strong')
    .filter({ hasText: '必要來源🙂' })
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  const excerpt = page.locator('.canvas-card.excerpt.active');
  await expect(excerpt.locator('blockquote')).toHaveText('必要來源🙂');
  await excerpt.getByRole('button', { name: '回到来源并高亮', exact: true }).click();
  await expect(page.locator('.canvas-card.reference.active strong mark')).toHaveText('必要來源🙂');
});

test('finds and picks a late passage in a large reference without changing global source offsets', async ({
  page,
  request,
}) => {
  const exact = 'late source marker';
  const text = 'start\n' + 'x'.repeat(65000) + '\n' + exact + '\nend';
  const ref = await (
    await request.post('/api/references', {
      data: { request_id: crypto.randomUUID(), title: 'Large reference', text },
    })
  ).json();
  const zoom = page.viewportSize()!.width < 600 ? 0.8 : 1;
  await request.patch('/api/workspace', {
    data: { viewport: { x: 24 - ref.node.x * zoom, y: 100 - ref.node.y * zoom, zoom } },
  });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + ref.node.id + '"]');
  await card.locator('.card-title').click();
  await card.getByLabel('尋找參考文字').fill(exact);
  await card.getByRole('button', { name: '尋找下一個' }).click();
  const visible = card.locator('[data-source-start]').first();
  expect(Number(await visible.getAttribute('data-source-start'))).toBeGreaterThan(0);
  await visible.locator('.picked-text').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  const state = await (await request.get('/api/state')).json();
  const excerpt = state.excerpts.find(
    (e: { source_block_id: string }) => e.source_block_id === ref.block.id,
  );
  expect(excerpt.selector.start_char).toBe(text.indexOf(exact));
  expect(excerpt.snapshot_text).toBe(exact);
  await page
    .locator('.canvas-card.excerpt.active')
    .getByRole('button', { name: '回到来源并高亮', exact: true })
    .click();
  await expect(card.locator('mark')).toHaveText(exact);
});
