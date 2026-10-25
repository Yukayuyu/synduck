import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

async function create(request: APIRequestContext, title: string, x: number, y = x) {
  const result = await request.post('/api/conversations', { data: { title, position: { x, y } } });
  expect(result.ok()).toBe(true);
  return (await result.json()) as {
    node: { id: string; x: number; y: number };
    conversation: { id: string };
  };
}
async function view(request: APIRequestContext, x: number, y: number) {
  await request.patch('/api/workspace', { data: { viewport: { x: 30 - x, y: 120 - y, zoom: 1 } } });
}
async function open(page: Page, title: string) {
  await page.getByRole('button', { name: '對話', exact: true }).click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: title, exact: true })
    .click();
}
async function select(block: Locator, exact: string) {
  await block.evaluate((element, exact) => {
    const start = element.textContent!.indexOf(exact);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0,
      found = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = offset + node.textContent!.length;
      if (!found && start <= end) {
        range.setStart(node, start - offset);
        found = true;
      }
      if (start + exact.length <= end) {
        range.setEnd(node, start + exact.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, exact);
}

test('keeps equal-height conversations in distinct islands and persists explicit folding', async ({
  page,
  request,
}) => {
  const a = await create(request, '产品方向·主线', -81000);
  const b = await create(request, '实现方案·主线', -80400, a.node.y);
  await view(request, a.node.x, a.node.y);
  await page.goto('/');
  const card = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(card(a.node.id).getByText('主线', { exact: true })).toBeVisible();
  await expect(card(b.node.id).getByText('主线', { exact: true })).toBeVisible();
  await card(a.node.id).locator('.card-title').click();
  await card(a.node.id).getByLabel('你的问题', { exact: true }).fill('保留未发送的文字，继续。');
  await card(a.node.id).getByRole('button', { name: '折叠对话', exact: true }).click();
  await expect(card(a.node.id).locator('.canvas-card')).toHaveClass(/collapsed/);
  await page.reload();
  await expect(card(a.node.id).locator('.canvas-card')).toHaveClass(/collapsed/);
  await card(a.node.id).locator('.card-title').click();
  await expect(card(a.node.id).getByLabel('你的问题', { exact: true })).toBeVisible();
  await expect(card(a.node.id).locator('.canvas-card')).not.toHaveClass(/collapsed/);
});

test('splits one composer into independently answered tasks, with an index on the main thread', async ({
  page,
  request,
}) => {
  const root = await create(request, '一次输入多个任务', -83000);
  await view(request, root.node.x, root.node.y);
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  const input = card.getByLabel('你的问题', { exact: true });
  await input.fill('继续产品方向。\n/fork');
  await input.press('Enter');
  await expect(card.getByLabel('分支问题 1', { exact: true })).toBeFocused();
  await card.getByLabel('分支问题 1', { exact: true }).fill('独立讨论界面，保留主线。');
  await card.getByLabel('添加分支问题', { exact: true }).click();
  await card.getByRole('button', { name: '顺手问 /btw', exact: true }).click();
  await card.getByLabel('分支问题 2', { exact: true }).fill('独立检查公开发布。');
  await input.evaluate((element) => Reflect.set(window, 'thoughtMainEditor', element));
  const sent: object[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/send', async (route) => {
    sent.push(route.request().postDataJSON());
    const response = await route.fetch();
    await hold;
    await route.fulfill({ response });
  });
  await card.getByRole('button', { name: '分别发送 3', exact: true }).click();
  try {
    await expect.poll(() => sent.length).toBe(3);
    await expect(input).toHaveAttribute('readonly', '');
    expect(
      await input.evaluate((element) => element === Reflect.get(window, 'thoughtMainEditor')),
    ).toBe(true);
  } finally {
    release();
  }
  await expect(input).not.toHaveAttribute('readonly', '');
  await expect(card.locator('.thread-branch-index summary')).toHaveText('2 个分支 · 0 待答');
  const state: ClientState = await (await request.get('/api/state')).json();
  const children = state.conversations.filter(
    (c) => c.fork_origin?.conversation_id === root.conversation.id,
  );
  expect(children.map((c) => c.fork_origin!.mode).sort()).toEqual(['btw', 'fork']);
  for (const child of children) {
    const turns = state.turns.filter((t) => t.conversation_id === child.id);
    expect(turns.filter((t) => t.actor === 'human')).toHaveLength(1);
    expect(turns.filter((t) => t.actor === 'assistant' && t.status === 'complete')).toHaveLength(1);
    const pkg = state.packages.find(
      (p) => p.context_set_id === turns.find((t) => t.actor === 'assistant')!.input_context_set_id,
    )!;
    expect(pkg.current_prompt).toBe(child.fork_origin!.initial_prompt);
    expect(pkg.items).toHaveLength(0);
  }
  await input.fill('继续，标点不会触发分叉。');
  await input.press('Comma');
  await expect(input).toBeFocused();
  await page.screenshot({ path: 'test-results/thought-branches.png' });
  const folded = state.nodes.find(
    (n) =>
      n.ref_type === 'conversation' &&
      n.ref_id === children.find((c) => c.fork_origin?.mode === 'btw')!.id,
  )!;
  await request.patch('/api/nodes/' + folded.id, {
    data: { collapsed: true, y: root.node.y + 700 },
  });
  const zoom = 0.85;
  await request.patch('/api/workspace', {
    data: {
      viewport: {
        x: 150 - root.node.x * zoom,
        y: 130 - root.node.y * zoom,
        zoom,
      },
    },
  });
  await page.reload();
  await expect(page.locator(`.react-flow__node[data-id="${folded.id}"] .canvas-card`)).toHaveClass(
    /collapsed/,
  );
  await page.screenshot({ path: 'test-results/thought-islands-overview.png' });
});

test('can ask a new branch while the main answer is still generating', async ({
  page,
  request,
}) => {
  const root = await create(request, '主线生成时顺手问', -85000);
  await view(request, root.node.x, root.node.y);
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  const input = card.getByLabel('你的问题', { exact: true });
  await input.fill('先回答主线。');
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/send', async (route) => {
    const body = route.request().postDataJSON();
    const response = await route.fetch();
    if (body.conversation_id === root.conversation.id) await hold;
    await route.fulfill({ response });
  });
  await card.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(input).toHaveAttribute('readonly', '');
  try {
    await card.getByLabel('添加分支问题', { exact: true }).click();
    await card.getByRole('button', { name: '顺手问 /btw', exact: true }).click();
    const branchInput = card.getByLabel('分支问题 1', { exact: true });
    await expect(branchInput).not.toHaveAttribute('readonly', '');
    await branchInput.fill('顺便单独讨论更新。');
    await card.getByRole('button', { name: '分别发送 1', exact: true }).click();
    await expect(card.locator('.thread-branch-index summary')).toHaveText('1 个分支 · 0 待答');
    await expect(input).toHaveAttribute('readonly', '');
  } finally {
    release();
  }
  await expect(input).not.toHaveAttribute('readonly', '');
  const state: ClientState = await (await request.get('/api/state')).json();
  expect(
    state.turns.filter((t) => t.conversation_id === root.conversation.id && t.actor === 'human'),
  ).toHaveLength(1);
});

test('adds picks from different conversations into an existing hub and follows its sources', async ({
  page,
  request,
}) => {
  const a = await create(request, '摘录来源 A', -87000);
  const b = await create(request, '摘录来源 B', -86400, a.node.y);
  for (const [conversation, prompt] of [
    [a.conversation.id, 'Alpha 保留主线。'],
    [b.conversation.id, 'Beta 保留出处。'],
  ]) {
    const response = await request.post('/api/send', {
      data: {
        conversation_id: conversation,
        request_id: crypto.randomUUID(),
        prompt,
        selected_node_ids: [],
      },
    });
    expect(response.ok()).toBe(true);
  }
  await view(request, a.node.x, a.node.y);
  await page.goto('/');
  await open(page, '摘录来源 A');
  const existingExcerptCards = await page.locator('.react-flow__node.node-excerpt').count();
  const cardA = page.locator(`.react-flow__node[data-id="${a.node.id}"]`);
  await select(cardA.getByTestId('turn-human').getByTestId('content-block'), '保留主线');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  await page
    .locator('.canvas-card.excerpt.active')
    .getByRole('button', { name: '收集更多摘录', exact: true })
    .click();
  await expect(page.locator('.collecting-bar')).toBeVisible();
  await open(page, '摘录来源 B');
  const cardB = page.locator(`.react-flow__node[data-id="${b.node.id}"]`);
  await select(cardB.getByTestId('turn-human').getByTestId('content-block'), '保留出处');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '加入汇合点', exact: true })
    .click();
  await page
    .locator('.collecting-bar')
    .getByRole('button', { name: '查看汇合点', exact: true })
    .click();
  const hub = page.locator('.canvas-card.excerpt.active');
  await expect(hub.locator('.collection-source')).toHaveCount(2);
  await expect(hub.locator('.collection-count')).toHaveText('2');
  await expect(page.locator('.react-flow__node.node-excerpt')).toHaveCount(
    existingExcerptCards + 1,
  );
  await hub.getByRole('button', { name: '移出摘录 1', exact: true }).click();
  await expect(hub.locator('.collection-source')).toHaveCount(1);
  await expect(hub.locator('blockquote')).toHaveText('保留出处');
  await hub.getByRole('button', { name: '从摘录开始分支', exact: true }).click();
  const branch = page.locator('.canvas-card.conversation.active');
  await branch.getByLabel('你的问题', { exact: true }).fill('综合摘录，接下来做什么？');
  await branch.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(branch.getByTestId('turn-assistant')).toContainText('本地演示');
  const state: ClientState = await (await request.get('/api/state')).json();
  const origin = state.excerpts.find((e) => e.collection_source_ids)!;
  const child = state.conversations.find((c) => c.branch_origin_excerpt_id === origin.id)!;
  const answer = state.turns.find(
    (t) => t.conversation_id === child.id && t.actor === 'assistant',
  )!;
  const pkg = state.packages.find((p) => p.context_set_id === answer.input_context_set_id)!;
  expect(pkg.items.map((i) => i.content)).toEqual(['保留出处']);
  await page.reload();
  await expect(page.locator('.react-flow__node.node-excerpt')).toHaveCount(
    existingExcerptCards + 1,
  );
});
