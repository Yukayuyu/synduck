import { test, expect } from '@playwright/test';

test('creates at the cursor, sends in one click, renames, deletes, undoes and restores after reload', async ({
  page,
  request,
}) => {
  await request.patch('/api/workspace', { data: { viewport: { x: 45080, y: 45080, zoom: 1 } } });
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/conversations') && response.request().method() === 'POST',
  );
  await page.mouse.click(600, 180, { button: 'right' });
  await page.getByRole('menuitem', { name: '在這裡提問', exact: true }).click();
  const result = await (await created).json();
  const card = page.locator('.react-flow__node[data-id="' + result.node.id + '"]');
  const editor = card.getByLabel('你的问题', { exact: true });
  await expect(editor).toBeFocused();
  await page.keyboard.type('One click, ordinary typing.');
  await card.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(card.getByTestId('turn-human')).toHaveCount(1);
  await expect(card.getByTestId('turn-human')).toContainText('One click, ordinary typing.');
  await expect(editor).toHaveValue('');
  await expect(page.getByRole('button', { name: '關閉面板', exact: true })).toHaveCount(0);
  await card.locator('.card-title').click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: 'test-results/canvas-actions-menu.png' });
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: '刪除卡片', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '重新命名', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('卡片名稱', { exact: true }).fill('精簡操作卡片');
  await page.keyboard.press('Enter');
  await expect(card.locator('.card-title')).toContainText('精簡操作卡片');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await card.getByRole('button', { name: '卡片操作：精簡操作卡片', exact: true }).click();
  await page.getByRole('menuitem', { name: '複製內容', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('One click, ordinary typing.');
  await card.getByRole('button', { name: '卡片操作：精簡操作卡片', exact: true }).click();
  await page.getByRole('menuitem', { name: '固定上下文', exact: true }).click();
  await expect(card.getByLabel('已固定', { exact: true })).toBeVisible();
  const before = await (await request.get('/api/state')).json();
  await card.locator('.card-title').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '刪除卡片', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(card).toBeVisible();
  await expect(card.getByTestId('turn-human')).toContainText('One click, ordinary typing.');
  const after = await (await request.get('/api/state')).json();
  expect(after.blocks).toEqual(before.blocks);
  expect(after.packages).toEqual(before.packages);
  await card.locator('.card-eyebrow').click();
  await card.evaluate((element: HTMLElement) => element.focus());
  await card.dispatchEvent('keydown', { key: 'Backspace', code: 'Backspace', isComposing: true });
  await expect(card).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '回收桶', exact: true }).click();
  const trash = page.getByRole('dialog', { name: '回收桶', exact: true });
  await trash.getByRole('button', { name: '精簡操作卡片 對話', exact: true }).click();
  await expect(trash.locator('.trash-preview')).toContainText('One click, ordinary typing.');
  await trash.getByRole('button', { name: '還原「精簡操作卡片」', exact: true }).click();
  await expect(trash).toHaveCount(0);
  await expect(card).toBeVisible();
  await request.post('/api/context-control', {
    data: { node_id: result.node.id, action: 'unpin' },
  });
});

test('leaves native text menus and Backspace alone, confirms unsent drafts and restores the draft with undo', async ({
  page,
  request,
}) => {
  const result = await (
    await request.post('/api/conversations', {
      data: { title: '未送出文字', position: { x: -47000, y: -47000 } },
    })
  ).json();
  await request.patch('/api/workspace', { data: { viewport: { x: 47080, y: 47080, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + result.node.id + '"]');
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  await page.keyboard.type('Unsent, draft!');
  await editor.evaluate((element) => {
    window.addEventListener(
      'contextmenu',
      (event) => Reflect.set(window, 'nativeMenuPrevented', event.defaultPrevented),
      { once: true },
    );
    element.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
    );
  });
  expect(await page.evaluate(() => Reflect.get(window, 'nativeMenuPrevented'))).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveValue('Unsent, draft');
  await card.getByRole('button', { name: '卡片操作：未送出文字', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await card.getByRole('button', { name: '卡片操作：未送出文字', exact: true }).click();
  await page.getByRole('menuitem', { name: '刪除卡片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '卡片還有未送出的文字', exact: true });
  await expect(dialog.getByRole('button', { name: '保留卡片', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: '保留卡片', exact: true }).click();
  await expect(editor).toHaveValue('Unsent, draft');
  await expect(editor).toBeFocused();
  await card.getByRole('button', { name: '卡片操作：未送出文字', exact: true }).click();
  await page.getByRole('menuitem', { name: '刪除卡片', exact: true }).click();
  await dialog.getByRole('button', { name: '刪除卡片', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(editor).toHaveValue('Unsent, draft');
  await expect(editor).toBeFocused();
});

test('opens a deleted branch source read-only without restoring or sending it as context', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '已刪除來源', position: { x: -49000, y: -49000 } },
    })
  ).json();
  const preview = await (
    await request.post('/api/compile', {
      data: {
        conversation_id: root.conversation.id,
        prompt: 'Deleted source evidence.',
        selected_node_ids: [],
      },
    })
  ).json();
  await request.post('/api/answer', { data: { context_set_id: preview.context_set.id } });
  const state = await (await request.get('/api/state')).json();
  const turn = state.turns.find(
    (turn: { conversation_id: string; actor: string }) =>
      turn.conversation_id === root.conversation.id && turn.actor === 'human',
  );
  const block = state.blocks.find((block: { turn_id: string }) => block.turn_id === turn.id);
  const excerpt = await (
    await request.post('/api/excerpts', {
      data: {
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 14, exact: 'Deleted source' },
        branch: true,
      },
    })
  ).json();
  await request.delete('/api/nodes/' + root.node.id, { data: {} });
  await request.patch('/api/workspace', { data: { viewport: { x: 49080, y: 49080, zoom: 1 } } });
  await page.goto('/');
  const branch = page.locator('.react-flow__node[data-id="' + excerpt.branch.node.id + '"]');
  await branch.locator('.card-title').click();
  await branch.getByRole('button', { name: /源自摘录/ }).click();
  const trash = page.getByRole('dialog', { name: '回收桶', exact: true });
  await expect(trash.locator('mark')).toHaveText('Deleted source');
  const unchanged = await (await request.get('/api/state')).json();
  expect(unchanged.nodes.find((node: { id: string }) => node.id === root.node.id).visibility).toBe(
    'hidden',
  );
  await trash.getByRole('button', { name: '關閉回收桶', exact: true }).click();
  await branch.getByLabel('你的问题', { exact: true }).fill('New independent question');
  await branch.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(page.getByText('卡片已刪除，可從回收桶還原', { exact: true })).toBeVisible();
  await expect(page.locator('.context-item')).toHaveCount(0);
});

test('direct send keeps a blocked draft and opens the context explanation without calling a model', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '超過預算的來源', position: { x: -51000, y: -51000 } },
    })
  ).json();
  const preview = await (
    await request.post('/api/compile', {
      data: {
        conversation_id: root.conversation.id,
        prompt: 'X'.repeat(5000),
        selected_node_ids: [],
      },
    })
  ).json();
  await request.post('/api/answer', { data: { context_set_id: preview.context_set.id } });
  await request.post('/api/context-control', { data: { node_id: root.node.id, action: 'pin' } });
  const target = await (
    await request.post('/api/conversations', {
      data: { title: '直接傳送仍檢查預算', position: { x: -54000, y: -54000 } },
    })
  ).json();
  await request.patch('/api/workspace', { data: { viewport: { x: 54080, y: 54080, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + target.node.id + '"]');
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  await editor.fill('Keep this draft');
  await card.getByText('上下文預算', { exact: true }).click();
  await card.getByLabel('上下文预算', { exact: true }).selectOption('2000');
  const rejected = page.waitForResponse(
    (response) => response.url().endsWith('/api/send') && response.request().method() === 'POST',
  );
  await card.getByRole('button', { name: '傳送', exact: true }).click();
  expect((await rejected).status()).toBe(422);
  await expect(page.getByText('需处理后才能发送', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue('Keep this draft');
  await expect(editor).not.toHaveAttribute('readonly', '');
  const after = await (await request.get('/api/state')).json();
  expect(
    after.turns.filter(
      (turn: { conversation_id: string }) => turn.conversation_id === target.conversation.id,
    ),
  ).toEqual([]);
  await request.post('/api/context-control', { data: { node_id: root.node.id, action: 'unpin' } });
});

test.describe('touch card actions', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('uses the overflow button and keeps the menu inside a phone viewport', async ({
    page,
    request,
  }) => {
    const result = await (
      await request.post('/api/conversations', {
        data: { title: '觸控卡片', position: { x: -56000, y: -56000 } },
      })
    ).json();
    await request.patch('/api/workspace', {
      data: { viewport: { x: 50415, y: 50480, zoom: 0.9 } },
    });
    await page.goto('/');
    const card = page.locator('.react-flow__node[data-id="' + result.node.id + '"]');
    await card.getByRole('button', { name: '卡片操作：觸控卡片', exact: true }).tap();
    const menu = page.getByRole('menu', { name: '畫布操作', exact: true });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.getByRole('menuitem', { name: '刪除卡片', exact: true }).tap();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: '復原', exact: true }).tap();
    await expect(card).toBeVisible();
  });
});
