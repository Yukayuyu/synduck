import { test, expect } from '@playwright/test';

test('normal canvas send uses real project tools and inline approval, persists trace and preserves input focus', async ({
  page,
  request,
}) => {
  const selected = await request.post('/api/models/select', {
    data: { provider: 'codex', model: 'test-model', reasoning_effort: 'high' },
  });
  expect(selected.ok()).toBe(true);
  try {
    const root = await (
      await request.post('/api/conversations', {
        data: { title: '自动工具对话', position: { x: -47000, y: -47000 } },
      })
    ).json();
    const zoom = page.viewportSize()!.width < 600 ? 0.8 : 1;
    await request.patch('/api/workspace', {
      data: { viewport: { x: 24 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
    });
    await page.goto('/');
    const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
    await card.locator('.card-title').click();
    const editor = card.getByLabel('你的问题', { exact: true });
    await expect(card.getByRole('button', { name: '交给本地任务', exact: true })).toHaveCount(0);
    await editor.fill('读取项目并确认写入');
    await card.getByRole('button', { name: '傳送', exact: true }).click();
    const tools = card.locator('.conversation-tools');
    await expect(tools.getByText('等待確認這一次操作', { exact: true })).toBeVisible();
    await expect(tools).toContainText('result.txt');
    await page.screenshot({ path: 'test-results/automatic-tools.png', animations: 'disabled' });
    await expect(page.getByRole('dialog', { name: '本地任務', exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: '停止這段回答' })).toBeVisible();
    await tools.getByRole('button', { name: '確認這次操作', exact: true }).click();
    await expect(card.getByRole('button', { name: '停止這段回答' })).toHaveCount(0);
    await expect(card.getByRole('heading', { name: '项目结果' })).toBeVisible();
    await editor.fill('继续编辑');
    await editor.focus();
    await editor.evaluate((element) => Reflect.set(window, 'automaticToolEditor', element));
    // Trace updates are independent of the composer and must not steal focus.
    await expect
      .poll(async () =>
        (await request.get('/api/local')).json().then((state) => state.tasks[0].status),
      )
      .toBe('complete');
    await editor.press('Comma');
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate((element) => Reflect.get(window, 'automaticToolEditor') === element),
    ).toBe(true);
    await page.reload();
    await expect(card.locator('.conversation-tools > summary')).toContainText('已完成');
    await card.locator('.conversation-tools > summary').click();
    await expect(
      card.locator('.conversation-tools').getByRole('link', { name: '匯出操作紀錄' }),
    ).toBeVisible();
    await card.locator('.card-title').click();
    await expect(card.getByLabel('你的问题', { exact: true })).toHaveValue('继续编辑,');
  } finally {
    await request.post('/api/models/select', { data: { provider: 'demo' } });
  }
});
