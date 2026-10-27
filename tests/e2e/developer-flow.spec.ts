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

test('hands a draft and its inspected context to local tasks without starting an operation', async ({
  page,
  request,
}) => {
  const root = await conversation(request, '画布到开发任务', '原始需求：检查项目结构。', -33000);
  let localStarts = 0;
  let normalSends = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/local/tasks')) localStarts++;
    if (request.url().endsWith('/api/send')) normalSends++;
  });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  const draft = '请阅读 package.json 并检查测试命令，不修改任何文件。';
  await editor.fill(draft);
  await card.getByRole('button', { name: '交给本地任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
  await expect(dialog.getByLabel('本地 AI 任務')).toHaveValue(draft);
  await expect(dialog.getByLabel('附上目前已預覽的畫布上下文')).toBeChecked();
  await expect(dialog.getByText('当前问题和选定上下文已带入', { exact: false })).toBeVisible();
  expect(localStarts).toBe(0);
  expect(normalSends).toBe(0);
  const localRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/local/tasks'),
  );
  await dialog.getByRole('button', { name: '開始 AI 任務', exact: true }).click();
  const submitted = (await localRequest).postDataJSON();
  expect(submitted.prompt).toBe(draft);
  const state = await (await request.get('/api/state')).json();
  expect(
    state.packages.find(
      (pkg: { context_set_id: string }) => pkg.context_set_id === submitted.context_set_id,
    ).current_prompt,
  ).toBe(draft);
  // This isolated server uses Demo, so a paid Codex task cannot start.
  await expect(dialog.getByRole('alert')).toContainText('請先選擇 ChatGPT / Codex 模型');
  await dialog.getByRole('button', { name: '關閉本地任務', exact: true }).click();
  await expect(editor).toHaveValue(draft);
  await editor.fill('');
  await card.getByRole('button', { name: '交给本地任务', exact: true }).click();
  await expect(dialog.getByLabel('本地 AI 任務')).toHaveValue('原始需求：检查项目结构。');
  expect(normalSends).toBe(0);
});

test('keeps options out of the layout and persists pointer and numeric conversation resizing', async ({
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
  const opened = await card.evaluate((element: HTMLElement) => ({
    width: element.offsetWidth,
    height: element.offsetHeight,
  }));
  expect(opened).toEqual(before);
  await expect(wrapper.getByRole('button', { name: '傳送', exact: true })).toBeVisible();
  // Click outside the floating menu; its center intentionally overlays part
  // of the composer without resizing it.
  await editor.click({ position: { x: 6, y: 6 } });
  await expect(wrapper.locator('.composer-settings')).not.toHaveAttribute('open');
  await editor.press('End');
  await editor.press('Comma');
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) => element === Reflect.get(window, 'sameDeveloperEditor')),
  ).toBe(true);
  await wrapper.getByRole('button', { name: '卡片操作：可调整的对话框', exact: true }).click();
  await page.getByRole('menuitem', { name: '调整对话框尺寸', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整对话框尺寸', exact: true });
  await dialog.getByLabel('宽度', { exact: true }).fill('540');
  await dialog.getByLabel('高度', { exact: true }).fill('650');
  await dialog.getByRole('button', { name: '保存尺寸', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => wrapper.evaluate((element: HTMLElement) => Math.round(element.offsetWidth)))
    .toBe(540);
  await expect
    .poll(() => wrapper.evaluate((element: HTMLElement) => Math.round(element.offsetHeight)))
    .toBe(650);
  const grip = await wrapper.locator('.card-resize').boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2 + 60, grip!.y + grip!.height / 2 + 50, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = await (await request.get('/api/state')).json();
      return Math.round(state.nodes.find((node: { id: string }) => node.id === root.node.id).width);
    })
    .toBe(600);
  const resized = await (await request.get('/api/state')).json();
  expect(resized.nodes.find((node: { id: string }) => node.id === root.node.id)).toMatchObject({
    width: 600,
    height: 700,
    size_mode: 'manual',
  });
  await page.reload();
  await expect
    .poll(() => wrapper.evaluate((element: HTMLElement) => Math.round(element.offsetWidth)))
    .toBe(600);
  await expect
    .poll(() => wrapper.evaluate((element: HTMLElement) => Math.round(element.offsetHeight)))
    .toBe(700);
  await wrapper.getByRole('button', { name: '卡片操作：可调整的对话框', exact: true }).click();
  await page.getByRole('menuitem', { name: '调整对话框尺寸', exact: true }).click();
  await dialog.getByRole('button', { name: '恢复自动尺寸', exact: true }).click();
  await expect
    .poll(() => wrapper.evaluate((element: HTMLElement) => Math.round(element.offsetWidth)))
    .toBe(420);
  await wrapper.getByRole('button', { name: '卡片操作：可调整的对话框', exact: true }).click();
  await page.getByRole('menuitem', { name: '调整对话框尺寸', exact: true }).click();
  await dialog.getByLabel('宽度', { exact: true }).fill('420');
  await dialog.getByLabel('高度', { exact: true }).fill('360');
  await dialog.getByRole('button', { name: '保存尺寸', exact: true }).click();
  await wrapper.locator('.card-title').click();
  for (let index = 0; index < 4; index++) {
    await wrapper.getByLabel('添加分支问题', { exact: true }).click();
    await wrapper.getByRole('button', { name: '分支 /fork', exact: true }).click();
    await wrapper.getByLabel('分支问题 ' + (index + 1), { exact: true }).fill('独立问题 ' + index);
  }
  const compact = await card.boundingBox();
  const composer = await wrapper.locator('.composer').boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(compact!.y + compact!.height);
  await expect(wrapper.getByRole('button', { name: '分别发送 5', exact: true })).toBeVisible();
});
