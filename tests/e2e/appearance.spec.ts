import { test, expect } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

test('offers three actual canvas styles, preserves editor/provenance, and remembers the selection', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '让思路自然生长', position: { x: -69940, y: -69950 } },
    })
  ).json();
  const sent = await request.post('/api/send', {
    data: {
      request_id: crypto.randomUUID(),
      conversation_id: root.conversation.id,
      prompt: '把复杂的问题，拆成清晰的路径。',
      selected_node_ids: [],
    },
  });
  expect(await sent.text()).toContain('"type":"complete"');
  const state: ClientState = await (await request.get('/api/state')).json();
  const turn = state.turns.find(
    (t) => t.conversation_id === root.conversation.id && t.actor === 'assistant',
  )!;
  const block = state.blocks.find((b) => b.turn_id === turn.id)!;
  const exact = '让上下文可见';
  const start = block.text_content!.indexOf(exact);
  const excerpt = await (
    await request.post('/api/excerpts', {
      data: {
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
        branch: true,
      },
    })
  ).json();
  await request.patch('/api/nodes/' + excerpt.node.id, { data: { x: -69460, y: -69700 } });
  await request.patch('/api/nodes/' + excerpt.branch.node.id, { data: { x: -69100, y: -69950 } });
  await request.post('/api/nodes/' + excerpt.branch.node.id + '/rename', {
    data: { title: '下一步，从这里开始' },
  });
  await request.patch('/api/workspace', { data: { viewport: { x: 70000, y: 70100, zoom: 1 } } });
  const before: ClientState = await (await request.get('/api/state')).json();
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  const excerptCard = page.locator(`.react-flow__node[data-id="${excerpt.node.id}"]`);
  await card.locator('.card-title').click();
  const input = card.getByLabel('你的问题', { exact: true });
  await input.fill('继续输入，保持这个游标。');
  await input.evaluate((element: HTMLTextAreaElement) => {
    Reflect.set(window, 'appearanceEditor', element);
    element.setSelectionRange(2, 4);
  });
  const position = (await card.boundingBox())!;
  await page.getByRole('button', { name: '平移工具', exact: true }).click();
  await page.mouse.move(1250, 120);
  await page.mouse.down();
  await page.mouse.move(1250 + 60 - position.x, 120 + 150 - position.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '選取工具', exact: true }).click();
  await expect(card.getByRole('button', { name: '预览上下文', exact: true })).toBeHidden();
  await expect(card.getByRole('button', { name: '固定上下文', exact: true })).toHaveCount(0);
  const widths = await page.evaluate(
    ({ conversation, excerpt }) => ({
      conversation: document
        .querySelector(`.react-flow__node[data-id="${conversation}"]`)!
        .getBoundingClientRect().width,
      excerpt: document
        .querySelector(`.react-flow__node[data-id="${excerpt}"]`)!
        .getBoundingClientRect().width,
    }),
    { conversation: root.node.id, excerpt: excerpt.node.id },
  );
  expect(widths.excerpt).toBeLessThan(widths.conversation);
  for (const style of ['arc', 'paper', 'ink']) {
    await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '画布外观', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '给思路一种形状。' });
    await expect(dialog.getByRole('radio')).toHaveCount(3);
    if (style === 'arc')
      await page.screenshot({ path: 'test-results/ui-styles.png', animations: 'disabled' });
    await dialog.locator(`input[value="${style}"]`).check();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-canvas-style', style);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(input).toHaveValue('继续输入，保持这个游标。');
    expect(
      await input.evaluate((element: HTMLTextAreaElement) => [
        element === Reflect.get(window, 'appearanceEditor'),
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([true, 2, 4]);
    await expect(excerptCard.locator('blockquote')).toHaveText(exact);
    // A complete sample of the real UI for visual review, using synthetic Demo data.
    await page.mouse.move(1370, 800);
    await page.screenshot({ path: `test-results/ui-${style}.png`, animations: 'disabled' });
  }
  const after: ClientState = await (await request.get('/api/state')).json();
  for (const key of ['turns', 'blocks', 'excerpts', 'packages', 'edges'] as const)
    expect(after[key]).toEqual(before[key]);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-canvas-style', 'ink');
  await expect(excerptCard.locator('blockquote')).toHaveText(exact);
});
