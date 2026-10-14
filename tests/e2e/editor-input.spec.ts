import { test, expect } from '@playwright/test';
test('Shift-click keeps editor focus and releasing Shift clears the canvas modifier state', async ({
  page,
  request,
}) => {
  const created = await (
    await request.post('/api/conversations', {
      data: { title: 'Shift 文本选择', position: { x: -27000, y: -27000 } },
    })
  ).json();
  await request.patch('/api/workspace', { data: { viewport: { x: 27080, y: 27080, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + created.node.id + '"]');
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  await editor.fill('普通文字，继续编辑。');
  await editor.click();
  await page.keyboard.down('Shift');
  await editor.click({ position: { x: 18, y: 16 } });
  await page.keyboard.up('Shift');
  await expect(editor).toBeFocused();
  await expect(page.locator('.react-flow__nodesselection-rect:focus')).toHaveCount(0);
  await expect(editor).toHaveValue('普通文字，继续编辑。');
  // A modifier pressed before entering the editor must still be released.
  await page.getByRole('button', { name: '平移工具', exact: true }).click();
  await page.keyboard.down('Shift');
  await expect(page.locator('.react-flow__pane.selection')).toHaveCount(1);
  await editor.click({ position: { x: 18, y: 16 } });
  await expect(editor).toBeFocused();
  await page.keyboard.up('Shift');
  await expect(page.locator('.react-flow__pane.selection')).toHaveCount(0);
  await expect(editor).toHaveValue('普通文字，继续编辑。');
});
test('types punctuation, modified keys and IME composition without moving focus or intercepting editor keys', async ({
  page,
  request,
}) => {
  const created = await (
    await request.post('/api/conversations', {
      data: { title: '普通输入', position: { x: -25000, y: -25000 } },
    })
  ).json();
  await request.patch('/api/workspace', { data: { viewport: { x: 25080, y: 25080, zoom: 1 } } });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="' + created.node.id + '"]');
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  await editor.fill('');
  // Use real keyboard insertion; fill()/insertText() skip keyboard event paths.
  await expect(editor).toBeVisible();
  await editor.focus();
  await editor.evaluate((element) => {
    const log: { type: string; key?: string; prevented?: boolean }[] = [];
    Reflect.set(window, 'editorInputLog', log);
    Reflect.set(window, 'originalEditor', element);
    element.addEventListener('blur', () => log.push({ type: 'blur' }));
    window.addEventListener('keydown', (event) =>
      log.push({ type: 'canvas-keydown', key: event.key, prevented: event.defaultPrevented }),
    );
  });
  await page.keyboard.type('text,.;:!?[]{}()<>"/\\_+-=', { delay: 15 });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('text,.;:!?[]{}()<>"/\\_+-=');
  // The input must own Ctrl+A, Shift+arrows, Space and IME candidate keys.
  await page.keyboard.press('Control+A');
  await page.keyboard.type('normal, input');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Comma');
  await expect(editor).toHaveValue('normal, inpu,');
  await expect(editor).toBeFocused();
  await editor.dispatchEvent('compositionstart', { data: '' });
  await editor.dispatchEvent('keydown', {
    key: 'Process',
    code: 'Comma',
    keyCode: 229,
    isComposing: true,
  });
  await page.keyboard.insertText('中文，标点。');
  await editor.dispatchEvent('compositionupdate', { data: '中文，标点。' });
  await editor.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
    isComposing: true,
  });
  await editor.dispatchEvent('compositionend', { data: '中文，标点。' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('normal, inpu,中文，标点。');
  await page.keyboard.press('Enter');
  await page.keyboard.type('next line');
  await expect(editor).toHaveValue('normal, inpu,中文，标点。\nnext line');
  await page.keyboard.press('Shift+Comma');
  const finalText = 'normal, inpu,中文，标点。\nnext line<';
  await expect(editor).toHaveValue(finalText);
  await page.keyboard.press('Control+z');
  await expect(editor).not.toHaveValue(finalText);
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveValue(finalText);
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element) => element === Reflect.get(window, 'originalEditor')),
  ).toBe(true);
  const log = await page.evaluate(
    () =>
      Reflect.get(window, 'editorInputLog') as {
        type: string;
        key?: string;
        prevented?: boolean;
      }[],
  );
  expect(log.filter((event) => event.type === 'blur')).toEqual([]);
  expect(log.filter((event) => event.type === 'canvas-keydown')).toEqual([]);
  // Normal Tab navigation may leave the editor; it must not forcibly refocus.
  await page.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toBeFocused();
  const compiled = page.waitForResponse(
    (response) => response.url().endsWith('/api/compile') && response.request().method() === 'POST',
  );
  await card.getByRole('button', { name: '预览上下文', exact: true }).click();
  expect((await (await compiled).json()).package.current_prompt).toBe(finalText);
  await page.getByRole('button', { name: '關閉面板', exact: true }).click();
  await card.getByRole('button', { name: '发送此上下文', exact: true }).click();
  await expect(editor).toHaveValue('');
  await expect(card.getByTestId('turn-human').last()).toContainText(finalText);
});
