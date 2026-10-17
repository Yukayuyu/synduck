import { test, expect, type APIRequestContext } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

async function createConversation(request: APIRequestContext, title: string, x: number) {
  const response = await request.post('/api/conversations', {
    data: { title, position: { x, y: x } },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { node: { id: string }; conversation: { id: string } };
}

async function answer(request: APIRequestContext, conversationId: string, prompt: string) {
  const compiled = await request.post('/api/compile', {
    data: { conversation_id: conversationId, prompt, selected_node_ids: [] },
  });
  expect(compiled.ok()).toBe(true);
  const { context_set } = await compiled.json();
  const result = await request.post('/api/answer', { data: { context_set_id: context_set.id } });
  expect(result.ok()).toBe(true);
}

test('keeps paired input/output closer than exchanges and preserves cross-paragraph excerpt provenance', async ({
  page,
  request,
}) => {
  const root = await createConversation(request, '把問題與回應連成一條思路', -18000);
  const prompt = '先保留完整的問題。\n\n再把分塊維持在一起，讓閱讀繼續。';
  await answer(request, root.conversation.id, '我們如何把一段思路留在畫布上？');
  await answer(request, root.conversation.id, prompt);
  await request.patch('/api/workspace', { data: { viewport: { x: 18100, y: 18100, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  const groups = card.getByRole('group', { name: /第 \d+ 組問答/ });
  await expect(groups).toHaveCount(2);
  for (const group of await groups.all()) {
    await expect(group.getByTestId('turn-human')).toHaveCount(1);
    await expect(group.getByTestId('turn-assistant')).toHaveCount(1);
    const geometry = await group.evaluate((element) => {
      const input = element.querySelector('.turn.human')!;
      const output = element.querySelector('.turn.assistant')!;
      const a = input.getBoundingClientRect(),
        b = output.getBoundingClientRect();
      return {
        gap: b.top - a.bottom,
        alignment: b.left - a.left,
        sameBackground:
          getComputedStyle(input).backgroundColor === getComputedStyle(output).backgroundColor,
      };
    });
    expect(geometry.gap).toBeGreaterThan(0);
    expect(geometry.gap).toBeLessThanOrEqual(5);
    expect(Math.abs(geometry.alignment)).toBeLessThan(1);
    expect(geometry.sameBackground).toBe(false);
  }
  const between = await groups
    .first()
    .evaluate(
      (element) =>
        element.nextElementSibling!.getBoundingClientRect().top -
        element.getBoundingClientRect().bottom,
    );
  expect(between).toBeGreaterThanOrEqual(18);
  const block = groups.last().getByTestId('turn-human').getByTestId('content-block');
  expect(await block.textContent()).toBe(prompt);
  const exact = '完整的問題。\n\n再把分塊';
  const start = prompt.indexOf(exact);
  await block.evaluate(
    (element, { start, length }) => {
      const scroll = element.closest<HTMLElement>('.conversation-scroll')!;
      scroll.scrollTop +=
        element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20;
      const range = document.createRange();
      range.setStart(element.firstChild!, start);
      range.setEnd(element.firstChild!, start + length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { start, length: exact.length },
  );
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  const excerpt = page.locator('.canvas-card.excerpt.active');
  await expect(excerpt.locator('blockquote')).toHaveText(exact);
  expect(await excerpt.evaluate((element) => getComputedStyle(element).borderLeftStyle)).toBe(
    'solid',
  );
  expect(await excerpt.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    await card
      .locator('.canvas-card')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  const state: ClientState = await (await request.get('/api/state')).json();
  const sourceId = (await block.getAttribute('id'))!.slice('block-'.length);
  const saved = state.excerpts.find((e) => e.source_block_id === sourceId)!;
  expect(saved).toMatchObject({
    snapshot_text: exact,
    selector: { start_char: start, end_char: start + exact.length, exact },
    source_content_hash: state.blocks.find((b) => b.id === sourceId)!.content_hash,
  });
  const edge = page.locator('.relation-excerpt_from .react-flow__edge-path').last();
  await expect(edge).toHaveCSS('stroke-dasharray', '3px, 4px');
  await excerpt.getByRole('button', { name: '回到来源并高亮', exact: true }).click();
  await expect(block.locator('mark')).toHaveText(exact);
  const visible = await block.locator('mark').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const scroll = element.closest('.conversation-scroll')!.getBoundingClientRect();
    return bounds.top >= scroll.top && bounds.bottom <= scroll.bottom;
  });
  expect(visible).toBe(true);
  await card.getByRole('button', { name: '返回画布', exact: true }).click();
  await page.screenshot({ path: 'test-results/conversation-blocks-source.png' });
  await page.reload();
  await expect(groups).toHaveCount(2);
  expect(await block.textContent()).toBe(prompt);
});

test('shows the submitted input beside the live output and retains the same focused editor after saving', async ({
  page,
  request,
}) => {
  const root = await createConversation(request, '生成時也能看清問題', -19000);
  await request.patch('/api/workspace', { data: { viewport: { x: 19100, y: 19100, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  const prompt = '這是一段正在生成的問題，請保留輸入和輸出的關係。'.repeat(16);
  await editor.fill(prompt);
  await editor.evaluate((element) => Reflect.set(window, 'blockEditor', element));
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let stateRequested!: () => void;
  let releaseState!: () => void;
  const refreshed = new Promise<void>((resolve) => {
    stateRequested = resolve;
  });
  const holdState = new Promise<void>((resolve) => {
    releaseState = resolve;
  });
  await page.route('**/api/state', async (route) => {
    stateRequested();
    await holdState;
    await route.continue();
  });
  await page.route('**/api/answer', async (route) => {
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response });
  });
  await card
    .getByRole('button', { name: '傳送', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  let readingPosition = 0;
  try {
    const group = card.getByRole('group', { name: '第 1 組問答', exact: true });
    await expect(group.locator('.turn.human .message-text')).toHaveText(prompt);
    await expect(group.getByLabel('正在生成的輸出', { exact: true })).toBeVisible();
    await expect(group.getByLabel('正在生成的輸出', { exact: true })).toBeInViewport({
      ratio: 0.8,
    });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('readonly', '');
    readingPosition = await card
      .locator('.conversation-scroll')
      .evaluate((element) => element.scrollTop);
    expect(await editor.evaluate((element) => element === Reflect.get(window, 'blockEditor'))).toBe(
      true,
    );
  } finally {
    release();
  }
  try {
    await refreshed;
    // A slow canonical refresh must not erase the live pair or reset its scroll.
    await expect(editor).toHaveAttribute('readonly', '');
    // The long output can exceed one viewport; its visible portion must remain
    // in view without resetting to the beginning of the submitted question.
    await expect(card.getByLabel('正在生成的輸出', { exact: true })).toBeInViewport();
    expect(
      await card.locator('.conversation-scroll').evaluate((element) => element.scrollTop),
    ).toBeGreaterThanOrEqual(readingPosition - 1);
  } finally {
    releaseState();
  }
  await expect(editor).toHaveValue('');
  await expect(editor).toBeFocused();
  await expect(card.locator('.pending-exchange')).toHaveCount(0);
  const saved = card.getByRole('group', { name: '第 1 組問答', exact: true });
  await expect(saved.getByTestId('turn-human')).toContainText(prompt);
  await expect(saved.getByTestId('turn-assistant')).toContainText('本地演示');
  await expect(saved.getByTestId('turn-assistant')).toBeInViewport();
  expect(
    await card.locator('.conversation-scroll').evaluate((element) => element.scrollTop),
  ).toBeGreaterThanOrEqual(readingPosition - 1);
  await expect(card.getByRole('group', { name: /第 \d+ 組問答/ })).toHaveCount(1);
  expect(await editor.evaluate((element) => element === Reflect.get(window, 'blockEditor'))).toBe(
    true,
  );
});

test.describe('reading blocks on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('returns to the exact late paragraph at phone zoom instead of the beginning of a long block', async ({
    page,
    request,
  }) => {
    const root = await createConversation(request, '長文中的閱讀位置', -20000);
    const exact = '這是靠後的重點。\n\n把這段留在自己的思考路徑裡。';
    const prompt =
      Array.from(
        { length: 35 },
        (_, index) => `背景 ${index + 1}：先保留前面的資料，再延伸問題。`,
      ).join('\n\n') +
      '\n\n' +
      exact;
    await answer(request, root.conversation.id, prompt);
    await request.patch('/api/workspace', { data: { viewport: { x: 20100, y: 20100, zoom: 1 } } });
    await page.goto('/');
    await page
      .getByRole('navigation', { name: '工作區分頁' })
      .getByRole('button', { name: '對話', exact: true })
      .tap();
    await page
      .getByRole('navigation', { name: '对话列表' })
      .getByRole('button', { name: '長文中的閱讀位置', exact: true })
      .tap();
    const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
    const block = card.getByTestId('turn-human').getByTestId('content-block');
    await block.evaluate((element, exact) => {
      const text = element.firstChild!;
      const start = text.textContent!.indexOf(exact);
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + exact.length);
      const scroll = element.closest<HTMLElement>('.conversation-scroll')!;
      const scale = scroll.getBoundingClientRect().height / scroll.offsetHeight;
      scroll.scrollTop +=
        (range.getBoundingClientRect().top - scroll.getBoundingClientRect().top) / scale - 12;
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }, exact);
    await page
      .getByRole('toolbar', { name: '文字选区操作' })
      .getByRole('button', { name: '摘录', exact: true })
      .tap();
    const excerpt = page.locator('.canvas-card.excerpt.active');
    await expect(excerpt.locator('blockquote')).toHaveText(exact);
    await excerpt.getByRole('button', { name: '回到来源并高亮', exact: true }).tap();
    const mark = block.locator('mark');
    await expect(mark).toHaveText(exact);
    await expect
      .poll(() =>
        mark.evaluate((element) => {
          const mark = element.getBoundingClientRect();
          const scroll = element.closest('.conversation-scroll')!.getBoundingClientRect();
          return mark.top >= scroll.top - 1 && mark.bottom <= scroll.bottom + 1;
        }),
      )
      .toBe(true);
    await expect(card.locator('.canvas-card')).toBeInViewport({ ratio: 0.95 });
    expect(
      await card
        .locator('.conversation-scroll')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/conversation-blocks-phone.png' });
  });
});
