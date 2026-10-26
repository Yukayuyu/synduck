import { test, expect, type Page } from '@playwright/test';

async function manage(page: Page) {
  await page.getByRole('button', { name: '切换画布', exact: true }).click();
  return page.getByRole('dialog', { name: '画布管理', exact: true });
}
async function switchTo(page: Page, name: string) {
  const dialog = await manage(page);
  await dialog
    .getByRole('navigation', { name: '画布列表' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(name);
}
test('creates and renames canvases, preserves separate drafts through switching/reload, and keeps the focused input stable', async ({
  page,
  request,
}) => {
  const { primary_id } = await (await request.get('/api/canvases')).json();
  const originalName = '主项目·独立草稿';
  await request.patch('/api/canvases/' + primary_id, { data: { name: originalName } });
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '主画布里的问题', position: { x: -112000, y: -112000 } },
    })
  ).json();
  await request.patch('/api/workspace', { data: { viewport: { x: 112030, y: 112120, zoom: 1 } } });
  await page.goto('/');
  let card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  await card.getByLabel('你的问题', { exact: true }).fill('这是主画布的草稿，先保留。');
  let dialog = await manage(page);
  await dialog.getByRole('button', { name: '新建画布', exact: true }).click();
  await dialog.getByLabel('画布名称', { exact: true }).fill('第二张·设计草稿');
  await dialog.getByRole('button', { name: '创建画布', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(
    '第二张·设计草稿',
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: '開始第一段對話', exact: true }).click();
  await page.getByLabel('给这段对话起个名字').fill('只属于第二张');
  await page.getByRole('button', { name: '创建对话', exact: true }).click();
  const secondInput = page.getByLabel('你的问题', { exact: true });
  await secondInput.fill('第二份独立草稿。');
  await switchTo(page, originalName);
  card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  const input = card.getByLabel('你的问题', { exact: true });
  await expect(input).toHaveValue('这是主画布的草稿，先保留。');
  await expect(page.locator('.card-title').filter({ hasText: '只属于第二张' })).toHaveCount(0);
  await input.focus();
  await input.evaluate((element) => Reflect.set(window, 'multiCanvasEditor', element));
  await input.press('Comma');
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element) => element === Reflect.get(window, 'multiCanvasEditor')),
  ).toBe(true);
  await switchTo(page, '第二张·设计草稿');
  await expect(page.getByLabel('你的问题', { exact: true })).toHaveValue('第二份独立草稿。');
  dialog = await manage(page);
  await dialog.getByRole('button', { name: '重命名当前画布', exact: true }).click();
  await dialog.getByLabel('画布名称', { exact: true }).fill('设计项目·已改名');
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭画布管理', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(
    '设计项目·已改名',
  );
  await page.getByRole('button', { name: '對話', exact: true }).click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: '只属于第二张', exact: true })
    .click();
  await expect(page.getByLabel('你的问题', { exact: true })).toHaveValue('第二份独立草稿。');
  await manage(page);
  await page.screenshot({ path: 'test-results/multiple-canvases.png' });
});

test('keeps an answer running in its own canvas while another canvas receives normal input', async ({
  page,
  request,
}) => {
  const catalog = await (await request.get('/api/canvases')).json();
  const a = catalog.primary_id;
  const aName = catalog.canvases.find((entry: { id: string }) => entry.id === a).name;
  const b = await (
    await request.post('/api/canvases', { data: { name: '后台任务与输入隔离' } })
  ).json();
  const make = async (id: string, title: string) =>
    (
      await request.post('/api/conversations', {
        headers: { 'x-canvas-id': id },
        data: { title, position: { x: -113000, y: -113000 } },
      })
    ).json();
  const first = await make(a, '留在后台的回答');
  const second = await make(b.id, '另一张画布的输入');
  for (const id of [a, b.id])
    await request.patch('/api/workspace', {
      headers: { 'x-canvas-id': id },
      data: { viewport: { x: 113030, y: 113120, zoom: 1 } },
    });
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${first.node.id}"]`);
  await card.locator('.card-title').click();
  await card.getByLabel('你的问题', { exact: true }).fill('A 的独立任务。');
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owners: string[] = [];
  await page.route('**/api/send', async (route) => {
    const owner = route.request().headers()['x-canvas-id'];
    owners.push(owner);
    const response = await route.fetch();
    if (owner === a) await hold;
    await route.fulfill({ response });
  });
  await card.getByRole('button', { name: '傳送', exact: true }).click();
  await expect(card.getByLabel('你的问题', { exact: true })).toHaveAttribute('readonly', '');
  try {
    await switchTo(page, b.name);
    const other = page.locator(`.react-flow__node[data-id="${second.node.id}"]`);
    await other.locator('.card-title').click();
    const editor = other.getByLabel('你的问题', { exact: true });
    await editor.fill('B 的文字，继续正常输入。');
    await editor.evaluate((element: HTMLTextAreaElement) => {
      Reflect.set(window, 'backgroundCanvasEditor', element);
      element.setSelectionRange(5, 5);
    });
    await expect(page.getByRole('button', { name: '模型與登入', exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: '模型與登入', exact: true })).toBeEnabled();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('B 的文字，继续正常输入。');
    expect(await editor.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(5);
    expect(
      await editor.evaluate((element) => element === Reflect.get(window, 'backgroundCanvasEditor')),
    ).toBe(true);
    await other.getByRole('button', { name: '傳送', exact: true }).click();
    await expect(editor).toHaveValue('');
    await expect(other.getByTestId('turn-assistant')).toContainText('本地演示');
    expect(owners).toEqual([a, b.id]);
    await switchTo(page, aName);
    await expect(
      page.locator(`.react-flow__node[data-id="${first.node.id}"]`).getByTestId('turn-assistant'),
    ).toContainText('本地演示');
  } finally {
    release();
  }
});

test('references just the selected fragment into another canvas and jumps back to the original source', async ({
  page,
  request,
}) => {
  const catalog = await (await request.get('/api/canvases')).json();
  const a = catalog.primary_id;
  const aName = catalog.canvases.find((entry: { id: string }) => entry.id === a).name;
  const b = await (
    await request.post('/api/canvases', { data: { name: '跨画布引用目标' } })
  ).json();
  const root = await (
    await request.post('/api/conversations', {
      data: { title: '带有可追溯原文的对话', position: { x: -114000, y: -114000 } },
    })
  ).json();
  const text = '前文不带走。选择 🌱 这一段。私密尾部也不带走。';
  await request.post('/api/send', {
    data: {
      conversation_id: root.conversation.id,
      request_id: crypto.randomUUID(),
      prompt: text,
      selected_node_ids: [],
    },
  });
  await request.patch('/api/workspace', { data: { viewport: { x: 114030, y: 114120, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${root.node.id}"]`);
  await card.locator('.card-title').click();
  const exact = '🌱 这一段';
  await card
    .getByTestId('turn-human')
    .getByTestId('content-block')
    .evaluate((element, exact) => {
      const start = element.textContent!.indexOf(exact);
      const range = document.createRange();
      range.setStart(element.firstChild!, start);
      range.setEnd(element.firstChild!, start + exact.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, exact);
  await page
    .getByRole('toolbar', { name: '文字选区操作' })
    .getByRole('button', { name: '引用到其他画布', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '引用到其他画布', exact: true });
  await expect(dialog.locator('blockquote')).toHaveText(exact);
  await dialog.getByLabel('目标画布', { exact: true }).selectOption(b.id);
  await dialog.getByRole('button', { name: '引用并切换', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(b.name);
  const excerpt = page.locator('.canvas-card.excerpt.active');
  await expect(excerpt.locator('blockquote')).toHaveText(exact);
  await expect(page.locator('.message-text').filter({ hasText: '私密尾部' })).toHaveCount(0);
  await excerpt.getByRole('button', { name: '回到来源 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换画布', exact: true })).toContainText(aName);
  await expect(page.locator(`.react-flow__node[data-id="${root.node.id}"] mark`)).toHaveText(exact);
});
