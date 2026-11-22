import { test, expect, type Locator } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

async function select(element: Locator, exact: string) {
  await element.evaluate((element, exact) => {
    const start = element.textContent!.indexOf(exact);
    if (start < 0) throw new Error('Missing quote');
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0,
      begun = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = offset + node.textContent!.length;
      if (!begun && start < end) {
        range.setStart(node, start - offset);
        begun = true;
      }
      if (begun && start + exact.length <= end) {
        range.setEnd(node, start + exact.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, exact);
}
test('keeps editable memos on excerpts and collections, appends through the context menu and includes the memo when continuing later', async ({
  page,
  request,
}) => {
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '摘錄備註與右鍵追加', position: { x: -111000, y: -111000 } },
    })
  ).json();
  expect(
    (
      await request.post('/api/send', {
        data: {
          request_id: crypto.randomUUID(),
          conversation_id: root.conversation.id,
          prompt: '第一段保留來源。第二段之後追加。',
          selected_node_ids: [],
        },
      })
    ).ok(),
  ).toBe(true);
  const zoom = page.viewportSize()!.width < 600 ? 0.8 : 1;
  await request.patch('/api/workspace', {
    data: { viewport: { x: 24 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
  });
  await page.goto('/');
  const source = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  await source.locator('.card-title').click();
  const block = source.getByTestId('turn-human').getByTestId('content-block');
  await select(block, '第一段保留來源');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  const hub = page.locator('.canvas-card.excerpt.active');
  await expect(hub.locator('blockquote')).toHaveText('第一段保留來源');
  const anchorNodeId = await hub.evaluate((element) =>
    element.closest('.react-flow__node')!.getAttribute('data-id'),
  );
  await expect(hub.getByRole('button', { name: '收集更多摘录' })).toHaveCount(0);
  let generated = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/api/send')) generated++;
  });
  await hub.getByRole('button', { name: '編輯摘錄備註' }).click();
  const memo = page.getByRole('dialog', { name: '摘錄備註', exact: true });
  const editor = memo.getByRole('textbox', { name: '備註內容' });
  await editor.fill('先記下兩個假設');
  await editor.press('Comma');
  await editor.press('Enter');
  await editor.type('稍後再問 AI。');
  await expect(editor).toBeFocused();
  const text = await editor.inputValue();
  await memo.getByRole('button', { name: '保存備註' }).click();
  await expect(memo).toHaveCount(0);
  expect(generated).toBe(0);
  await expect(hub.getByRole('complementary', { name: '摘錄備註' })).toContainText('稍後再問 AI。');
  const before: ClientState = await (await request.get('/api/state')).json();
  const excerpt = before.excerpts.find(
    (e) => e.id === before.nodes.find((n) => n.id === anchorNodeId)!.ref_id,
  )!;
  const firstMemo = before.blocks.find((b) => b.id === excerpt.memo_block_id)!;
  expect(firstMemo.text_content).toBe(text.trim());
  await page.reload();
  await page
    .locator(
      '.react-flow__node[data-id="' +
        before.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === excerpt.id)!.id +
        '"] .card-title',
    )
    .click();
  await expect(hub.getByRole('complementary', { name: '摘錄備註' })).toContainText('稍後再問 AI。');
  await hub.getByRole('button', { name: '回到来源并高亮' }).click();
  await select(block, '第二段之後追加');
  const toolbar = page.getByRole('toolbar', { name: '文字选区操作' });
  await expect(toolbar.getByRole('button', { name: '加入汇合点' })).toHaveCount(0);
  if (page.viewportSize()!.width < 600) {
    await toolbar.getByRole('button', { name: '更多選取操作' }).click();
  } else {
    // Returning to a source animates the camera. Wait for it to settle before
    // translating the live Range into screen coordinates for a real right click.
    await block.hover();
    const bounds = await block.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(bounds.x, bounds.y, { button: 'right' });
  }
  await page.getByRole('menuitem', { name: '追加到摘錄…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '追加到摘錄', exact: true });
  await picker.getByRole('textbox', { name: '尋找摘錄' }).fill('第一段保留來源');
  await picker.getByRole('button', { name: /第一段保留來源/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(hub.locator('.collection-source')).toHaveCount(2);
  await expect(hub.getByRole('complementary', { name: '摘錄備註' })).toContainText('稍後再問 AI。');
  await hub.getByRole('button', { name: '編輯摘錄備註' }).click();
  await memo.getByRole('textbox', { name: '備註內容' }).fill('整合兩段之後，再比較可讀性。');
  await memo.getByRole('button', { name: '保存備註' }).click();
  await expect(memo).toHaveCount(0);
  expect(generated).toBe(0);
  await page.screenshot({ path: 'test-results/excerpt-memo.png' });
  await hub.getByRole('button', { name: '从摘录开始分支' }).click();
  const child = page.locator('.canvas-card.conversation.active');
  await child.getByRole('textbox', { name: '你的问题', exact: true }).fill('根據摘錄與備註繼續。');
  await child.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(child.getByTestId('turn-assistant')).toContainText('本地演示');
  const after: ClientState = await (await request.get('/api/state')).json();
  const branch = after.conversations.find((c) => c.branch_origin_excerpt_id === excerpt.id)!;
  const answer = after.turns.find(
    (t) => t.actor === 'assistant' && t.conversation_id === branch.id,
  )!;
  const pkg = after.packages.find((p) => p.context_set_id === answer.input_context_set_id)!;
  expect(pkg.items.map((i) => i.content)).toEqual(
    expect.arrayContaining(['第一段保留來源', '第二段之後追加', '整合兩段之後，再比較可讀性。']),
  );
  expect(pkg.items.some((i) => i.content === text.trim())).toBe(false);
  expect(after.blocks.find((b) => b.id === firstMemo.id)).toEqual(firstMemo);
  expect(after.excerpts.find((e) => e.id === excerpt.id)?.source_content_hash).toBe(
    excerpt.source_content_hash,
  );
  await expect(
    page.locator(
      '.react-flow__node[data-id="' +
        before.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === excerpt.id)!.id +
        '"] .excerpt-memo',
    ),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/excerpt-memo-context.png' });
});
