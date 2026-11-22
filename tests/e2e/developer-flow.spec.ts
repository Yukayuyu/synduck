import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';

async function conversation(request: APIRequestContext, title: string, prompt: string, x: number) {
  const root = await (
    await request.post('/api/conversations', {
      data: { title, position: { x, y: x } },
    })
  ).json();
  if (prompt) {
    const response = await request.post('/api/send', {
      data: {
        request_id: crypto.randomUUID(),
        conversation_id: root.conversation.id,
        prompt,
        selected_node_ids: [],
      },
    });
    expect(response.ok()).toBe(true);
  }
  await request.patch('/api/workspace', {
    data: { viewport: { x: 80 - root.node.x, y: 90 - root.node.y, zoom: 1 } },
  });
  return root;
}

async function selectText(element: Locator, exact: string) {
  await element.evaluate((element, exact) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const start = element.textContent!.indexOf(exact);
    if (start < 0) throw new Error('Visible quote is missing');
    let offset = 0;
    let started = false;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const length = text.textContent!.length;
      if (!started && start < offset + length) {
        range.setStart(text, start - offset);
        started = true;
      }
      if (started && start + exact.length <= offset + length) {
        range.setEnd(text, start + exact.length - offset);
        break;
      }
      offset += length;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, exact);
}

test('renders Markdown while picks, original highlights and sealed input retain exact source identity', async ({
  page,
  request,
}) => {
  const markdown = [
    '格式预览：',
    '',
    '## 开发工作区',
    '',
    '**粗体🙂** 与 _斜体_，重复：粗体🙂。',
    '',
    '- [x] 检查源码',
    '- [链接](https://example.test/guide)',
    '',
    '~~~typescript',
    'const value = "**literal**";',
    '~~~',
    '',
    '| 名称 | 状态 |',
    '| --- | --- |',
    '| 编辑器 | 完成 |',
    '',
    '实体：&amp; 与 &#x1F642;',
    '',
    '[拒绝脚本](javascript:alert%281%29)',
    '',
    '<script>window.unexpectedMarkdownScript = true</script>',
    '',
    '![示意图](https://example.test/should-not-load.png)',
  ].join('\n');
  const root = await conversation(request, 'Markdown 原文与摘录', markdown, -31000);
  const before = await (await request.get('/api/state')).json();
  const assistant = before.turns.find(
    (turn: { actor: string; conversation_id: string }) =>
      turn.actor === 'assistant' && turn.conversation_id === root.conversation.id,
  );
  const original = before.blocks.find(
    (block: { turn_id: string }) => block.turn_id === assistant.id,
  );
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  await card.locator('.card-title').click();
  const block = card.getByTestId('turn-assistant').getByTestId('content-block');
  await expect(block.getByRole('heading', { name: '开发工作区', exact: true })).toHaveCount(1);
  await expect(block.locator('strong')).toHaveText('粗体🙂');
  await expect(block.locator('pre code')).toHaveText('const value = "**literal**";');
  await expect(block.getByRole('table')).toContainText('编辑器');
  await expect(block.locator('script,img')).toHaveCount(0);
  await expect(block.getByText('拒绝脚本', { exact: true })).not.toHaveAttribute('href');
  expect(
    await page.evaluate(() => Reflect.get(window, 'unexpectedMarkdownScript')),
  ).toBeUndefined();
  await selectText(block.locator('strong'), '粗体🙂');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  const picked = page.locator('.canvas-card.excerpt.active');
  await expect(picked.locator('blockquote')).toHaveText('粗体🙂');
  const after = await (await request.get('/api/state')).json();
  const excerpt = after.excerpts.find(
    (entry: { source_block_id: string }) => entry.source_block_id === original.id,
  );
  expect(excerpt.selector).toEqual({
    type: 'text_range',
    start_char: original.text_content.indexOf('粗体🙂'),
    end_char: original.text_content.indexOf('粗体🙂') + '粗体🙂'.length,
    exact: '粗体🙂',
  });
  expect(excerpt.source_content_hash).toBe(original.content_hash);
  expect(after.packages).toEqual(before.packages);
  expect(after.blocks.find((entry: { id: string }) => entry.id === original.id)).toEqual(original);
  await picked.getByRole('button', { name: '回到来源并高亮', exact: true }).click();
  await expect(block.locator('strong mark')).toHaveText('粗体🙂');
  await expect(card.locator('.pick-source-handle')).toHaveCount(1);
  await block.getByRole('heading', { name: '开发工作区', exact: true }).evaluate((element) => {
    const scroll = element.closest<HTMLElement>('.conversation-scroll')!;
    const scale = scroll.getBoundingClientRect().height / scroll.offsetHeight;
    scroll.scrollTop +=
      (element.getBoundingClientRect().top - scroll.getBoundingClientRect().top) / scale - 8;
  });
  await page.screenshot({ path: 'test-results/developer-markdown.png' });
  await selectText(block, '粗体🙂 与 斜体');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  await expect(picked.locator('blockquote')).toHaveText('粗体🙂** 与 _斜体');
  await picked.getByRole('button', { name: '回到来源并高亮', exact: true }).click();
  await selectText(block.locator('p').filter({ hasText: '实体：& 与 🙂' }), '& 与 🙂');
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '摘录', exact: true })
    .click();
  await expect(picked.locator('blockquote')).toHaveText('&amp; 与 &#x1F642;');
  await picked.getByRole('button', { name: '回到来源并高亮', exact: true }).click();
  expect((await block.locator('mark').allTextContents()).join('')).toBe('& 与 🙂');
  const formatted = await (await request.get('/api/state')).json();
  expect(formatted.packages).toEqual(before.packages);
  expect(formatted.blocks.find((entry: { id: string }) => entry.id === original.id)).toEqual(
    original,
  );
  await page.reload();
  await expect(block.locator('strong')).toHaveText('粗体🙂');
});

test('resizes an automatic card freely from its edges and corners, keeps inputs stable and persists the result', async ({
  page,
  request,
}) => {
  const root = await conversation(request, '可调整的对话框', '检查尺寸与输入体验。', -35000);
  await page.goto('/');
  const wrapper = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  const card = wrapper.locator('.canvas-card');
  await wrapper.locator('.card-title').click();
  const editor = wrapper.getByLabel('你的问题', { exact: true });
  await editor.fill('普通输入，继续编辑。');
  await editor.evaluate((element) => Reflect.set(window, 'sameDeveloperEditor', element));
  const before = await card.evaluate((element: HTMLElement) => ({
    width: element.offsetWidth,
    height: element.offsetHeight,
  }));
  await wrapper.getByLabel('提问选项', { exact: true }).click();
  expect(
    await card.evaluate((element: HTMLElement) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    })),
  ).toEqual(before);
  await editor.click({ position: { x: 6, y: 6 } });
  const drag = async (selector: string, dx: number, dy: number) => {
    const box = await wrapper.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, {
      steps: 10,
    });
    await page.mouse.up();
  };
  // The first resize starts from automatic size, without a preset dialog.
  await drag('.card-resize-edge.right', 83, 0);
  const saved = async () =>
    (await (await request.get('/api/state')).json()).nodes.find(
      (n: { id: string }) => n.id === root.node.id,
    );
  await expect.poll(async () => Math.round((await saved()).width)).toBe(before.width + 83);
  expect(Math.round((await saved()).height)).toBe(before.height);
  expect((await saved()).x).toBe(root.node.x);
  await drag('.card-resize-edge.bottom', 0, 61);
  await expect.poll(async () => Math.round((await saved()).height)).toBe(before.height + 61);
  await expect(editor).toHaveValue('普通输入，继续编辑。');
  expect(
    await editor.evaluate((element) => element === Reflect.get(window, 'sameDeveloperEditor')),
  ).toBe(true);
  const dimensions = {
    width: Math.round((await saved()).width),
    height: Math.round((await saved()).height),
  };
  await page.reload();
  await expect
    .poll(() => wrapper.evaluate((e: HTMLElement) => e.offsetWidth))
    .toBe(dimensions.width);
  await expect
    .poll(() => wrapper.evaluate((e: HTMLElement) => e.offsetHeight))
    .toBe(dimensions.height);
  await wrapper.locator('.card-title').click();
  await wrapper.getByRole('button', { name: '卡片操作：可调整的对话框', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '调整对话框尺寸', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '恢復自動尺寸', exact: true }).click();
  await expect.poll(async () => (await saved()).size_mode).toBe('auto');
  await expect.poll(() => wrapper.evaluate((e: HTMLElement) => e.offsetWidth)).toBe(before.width);
  await wrapper.locator('.card-title').click();
  await drag('.card-resize-handle.bottom.right', -300, -600);
  await expect.poll(async () => Math.round((await saved()).width)).toBe(340);
  await expect.poll(async () => Math.round((await saved()).height)).toBe(360);
  for (let index = 0; index < 4; index++) {
    await wrapper.getByLabel('添加分支问题', { exact: true }).click();
    await wrapper.getByRole('button', { name: '分支 /fork', exact: true }).click();
    await wrapper.getByLabel('分支问题 ' + (index + 1), { exact: true }).fill('独立问题 ' + index);
  }
  await expect(wrapper.getByRole('button', { name: '分别发送 5', exact: true })).toBeVisible();
  const compact = await card.boundingBox(),
    composer = await wrapper.locator('.composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(compact!.y + compact!.height + 1);
  await page.screenshot({ path: 'test-results/free-resize.png' });
});

test('resizes a selected card from its corner at different canvas zoom levels without moving its origin', async ({
  page,
  request,
}) => {
  for (const [index, zoom] of [0.65, 1.25].entries()) {
    const root = await conversation(request, '縮放下調整大小 ' + index, '', -37000 - index * 2000);
    await request.patch('/api/nodes/' + root.node.id, {
      data: { width: 500, height: 440, size_mode: 'manual' },
    });
    await request.patch('/api/workspace', {
      data: { viewport: { x: 60 - root.node.x * zoom, y: 140 - root.node.y * zoom, zoom } },
    });
    await page.goto('/');
    const wrapper = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
    await wrapper.click({ position: { x: 20, y: 10 } });
    const handle = wrapper.locator('.card-resize-handle.bottom.right');
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80 * zoom, box.y + box.height / 2 + 40 * zoom, {
      steps: 10,
    });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const state = await (await request.get('/api/state')).json();
        const node = state.nodes.find((n: { id: string }) => n.id === root.node.id);
        return {
          width: Math.round(node.width),
          height: Math.round(node.height),
          x: node.x,
          y: node.y,
        };
      })
      .toEqual({ width: 580, height: 480, x: root.node.x, y: root.node.y });
    await expect(handle).toBeVisible();
  }
});
