import { test, expect } from '@playwright/test';

test('reads multiple conversations on the board and branches from an inactive card without moving its text', async ({
  page,
  request,
}) => {
  const roots: { node: { id: string; x: number; y: number }; conversation: { id: string } }[] = [];
  for (const [index, title] of ['空間中的第一條思路', '並排閱讀的第二條思路'].entries()) {
    const result = await request.post('/api/conversations', {
      data: { title, position: { x: -3000 + index * 460, y: -3000 } },
    });
    expect(result.ok()).toBe(true);
    const root = await result.json();
    roots.push(root);
    const compiled = await (
      await request.post('/api/compile', {
        data: { conversation_id: root.conversation.id, prompt: title, selected_node_ids: [] },
      })
    ).json();
    expect(
      (
        await request.post('/api/answer', { data: { context_set_id: compiled.context_set.id } })
      ).ok(),
    ).toBe(true);
  }
  await request.patch('/api/workspace', { data: { viewport: { x: 3120, y: 3120, zoom: 1 } } });
  await page.goto('/');
  await expect(page.locator('.board-drawer')).toHaveCount(0);
  const first = page.locator(`.react-flow__node[data-id="${roots[0].node.id}"]`);
  const second = page.locator(`.react-flow__node[data-id="${roots[1].node.id}"]`);
  await expect(first.getByTestId('turn-assistant')).toBeVisible();
  await expect(second.getByTestId('turn-assistant')).toBeVisible();
  await expect(first.locator('textarea')).toHaveCount(0);
  const block = first.getByTestId('turn-assistant').getByTestId('content-block');
  const points = await block.evaluate((el) => {
    const text = el.firstChild!;
    const start = text.textContent!.indexOf('让上下文可见');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    const scroll = el.closest<HTMLElement>('.conversation-scroll')!;
    const bounds = scroll.getBoundingClientRect();
    const initial = range.getBoundingClientRect();
    if (initial.bottom > bounds.bottom - 20)
      scroll.scrollTop += initial.bottom - bounds.bottom + 35;
    const rects = [...range.getClientRects()];
    const first = rects[0];
    const last = rects.at(-1)!;
    return {
      start: { x: first.left + 0.2, y: first.top + first.height / 2 },
      end: { x: last.right - 0.2, y: last.top + last.height / 2 },
    };
  });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('让上下文可见');
  const toolbar = page.getByRole('toolbar', { name: '文字选区操作' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: '摘录并分支', exact: true }).click();
  const editor = page.locator('.focus-panel[data-active="true"]');
  await expect(editor.getByText('源自摘录')).toBeVisible();
  await editor.getByLabel('你的问题', { exact: true }).fill('這段文字還能如何延伸？');
  await editor.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(page.locator('.context-item')).toHaveCount(1);
  await expect(page.locator('.context-item')).toContainText('让上下文可见');
  await page.getByRole('button', { name: '關閉面板', exact: true }).click();
  await editor.getByRole('button', { name: '发送此上下文', exact: true }).click();
  await expect(editor.getByTestId('turn-assistant')).toContainText('本轮已包含 1 项上下文');
  const state = await (await request.get('/api/state')).json();
  expect(state.nodes.find((n: { id: string }) => n.id === roots[0].node.id)).toMatchObject({
    id: roots[0].node.id,
    x: roots[0].node.x,
    y: roots[0].node.y,
  });
  expect(
    state.edges.some(
      (e: { type: string; source_node_id: string }) =>
        e.type === 'excerpt_from' && e.source_node_id === roots[0].node.id,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/flat-canvas-branch.png' });
});

test('double-click creates a card at a canvas location and hand dragging pans without creating one', async ({
  page,
  request,
}) => {
  await request.patch('/api/workspace', { data: { viewport: { x: 8500, y: 8500, zoom: 1 } } });
  const before = await (await request.get('/api/state')).json();
  await page.goto('/');
  await page.locator('.react-flow__pane').dblclick({ position: { x: 300, y: 230 } });
  const editor = page.locator('.focus-panel[data-active="true"]');
  await expect(editor.getByLabel('你的问题', { exact: true })).toBeVisible();
  const after = await (await request.get('/api/state')).json();
  expect(after.conversations.length).toBe(before.conversations.length + 1);
  const added = after.nodes.find(
    (n: { id: string }) => !before.nodes.some((p: { id: string }) => p.id === n.id),
  );
  expect(added.x).toBeCloseTo(-8200, 0);
  expect(added.y).toBeCloseTo(-8270, 0);
  await page.getByRole('button', { name: '平移工具', exact: true }).click();
  await page.mouse.move(160, 200);
  await page.mouse.down();
  await page.mouse.move(260, 230, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await (await request.get('/api/state')).json()).workspace.settings.viewport.x,
    )
    .not.toBe(after.workspace.settings.viewport.x);
  expect((await (await request.get('/api/state')).json()).conversations.length).toBe(
    after.conversations.length,
  );
});
