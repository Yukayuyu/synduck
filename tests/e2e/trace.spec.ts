import { test, expect } from '@playwright/test';
test('visual desktop trace shows approval, annotated before/after, persistent canvas layout and downloadable provenance', async ({
  page,
  request,
}) => {
  await request.patch('/api/workspace', { data: { viewport: { x: -14000, y: -14000, zoom: 1 } } });
  await request.post('/api/local/desktop/configure', { data: { enabled: true, window_id: '123' } });
  const task = await (
    await request.post('/api/local/actions', {
      data: { tool: 'canvas_desktop', arguments: { operation: 'capture' } },
    })
  ).json();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/local/tasks/' + task.id)).json()).actions[0]?.status,
    )
    .toBe('waiting');
  let record = await (await request.get('/api/local/tasks/' + task.id)).json();
  await request.post('/api/local/tasks/' + task.id + '/approve', {
    data: { action_id: record.actions[0].id, approved: true },
  });
  await expect
    .poll(async () => (await (await request.get('/api/local/tasks/' + task.id)).json()).status)
    .toBe('complete');
  record = await (await request.get('/api/local/tasks/' + task.id)).json();
  const frame = record.actions[0].desktop.before;
  await request.post('/api/local/canvas', {
    data: { task_id: task.id, pinned: true, x: 14100, y: 14100 },
  });
  await request.post('/api/local/actions', {
    data: {
      tool: 'canvas_desktop',
      continuation_id: task.id,
      arguments: { operation: 'click', capture_id: frame.capture_id, x: 220, y: 110 },
    },
  });
  await page.goto('/');
  const card = page.locator('.react-flow__node[data-id="trace:' + task.id + '"]');
  await expect(card.getByRole('button', { name: '查看並確認', exact: true })).toBeVisible();
  await card.getByRole('button', { name: '查看並確認', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '操作回看', exact: true });
  await expect(dialog.getByText('等待確認這一次操作', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('操作座標 220, 110')).toBeVisible();
  await dialog.getByRole('button', { name: '確認這次操作', exact: true }).click();
  await expect(dialog.locator('.trace-step-heading')).toContainText('已完成');
  await expect(dialog.locator('.trace-images.compare img')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/desktop-trace-review.png', fullPage: true });
  await expect(dialog.locator('.trace-target')).toContainText('輸入已送出');
  await dialog.getByRole('button', { name: '操作後', exact: true }).click();
  await expect(dialog.locator('.trace-images img')).toHaveCount(1);
  await dialog.getByText('參數、實際結果與來源', { exact: true }).click();
  await expect(dialog.locator('.trace-provenance')).toContainText(task.id);
  await expect(dialog.locator('.trace-hash').first()).toContainText('SHA-256');
  const download = page.waitForEvent('download');
  await dialog.getByRole('link', { name: '匯出紀錄與圖片' }).click();
  expect((await download).suggestedFilename()).toBe('canvas-task-' + task.id + '.zip');
  await dialog.getByRole('button', { name: '關閉操作回看' }).click();
  const handle = card.locator('.trace-drag');
  const before = await handle.boundingBox();
  expect(before).toBeTruthy();
  await page.mouse.move(before!.x + 35, before!.y + 8);
  await page.mouse.down();
  await page.mouse.move(before!.x + 125, before!.y + 68, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/local/canvas')).json()).traces.find(
          (trace: { task_id: string }) => trace.task_id === task.id,
        ).x,
    )
    .not.toBe(14100);
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="trace:' + task.id + '"] .trace-thumbnail img'),
  ).toBeVisible();
});
test('configures and discovers a real MCP server through the interface', async ({
  page,
  request,
}) => {
  // This server is installed from a test-only config fixture through the protected API.
  const module = await import('node:module'),
    url = await import('node:url');
  const require = module.createRequire(import.meta.url);
  const args = [
    '--import',
    url.pathToFileURL(require.resolve('tsx')).href,
    url.fileURLToPath(new URL('../fixtures/mcp-server.ts', import.meta.url)),
    '--stdio',
  ];
  await page.goto('/');
  await page.getByRole('button', { name: '本地任務', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
  await dialog.getByRole('tab', { name: '整合設定' }).click();
  await dialog.getByRole('button', { name: '新增 MCP', exact: true }).click();
  await dialog.getByLabel('MCP 服務名稱 1').fill('瀏覽器測試 MCP');
  await dialog.getByLabel('MCP 啟動程式 1').fill(process.execPath);
  await dialog.getByLabel('MCP 啟動參數 1').fill(JSON.stringify(args));
  await dialog.locator('.mcp-server').first().getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '保存 MCP 設定', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/api/local/integrations')).json()).mcp.length)
    .toBe(1);
  const service = (await (await request.get('/api/local/integrations')).json()).mcp[0];
  await dialog.getByRole('button', { name: '提出連接與探索工具' }).first().click();
  await dialog.getByRole('button', { name: '確認這次操作', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/local/integrations')).json()).mcp.find(
          (server: { id: string }) => server.id === service.id,
        ).connected,
    )
    .toBe(true);
  await dialog.getByRole('tab', { name: '手動測試' }).click();
  await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
  await dialog.getByLabel('MCP 測試服務').selectOption(service.id);
  await dialog.getByLabel('MCP 測試工具').selectOption('echo');
  await dialog.getByLabel('MCP 工具參數').fill('{"text":"Browser MCP round trip"}');
  await dialog.getByRole('button', { name: '提出 MCP 呼叫' }).click();
  await dialog.getByRole('button', { name: '確認這次操作', exact: true }).click();
  await expect(dialog.locator('.trace-step-heading')).toContainText('已完成');
  await expect(dialog.locator('.trace-frame img').first()).toBeVisible();
  await dialog.getByText('參數、實際結果與來源', { exact: true }).click();
  await expect(dialog.locator('.trace-review')).toContainText('Browser MCP round trip');
});
