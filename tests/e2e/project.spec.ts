import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('downloads a native backup, previews replacement, restores IDs and exposes a recovery point', async ({
  page,
  request,
}, testInfo) => {
  // This test creates its own provenance chain and can run by itself.
  const seed = await (
    await request.post('/api/conversations', { data: { title: '备份恢复来源' } })
  ).json();
  const compiled = await (
    await request.post('/api/compile', {
      data: {
        conversation_id: seed.conversation.id,
        prompt: '备份流程测试',
        selected_node_ids: [],
      },
    })
  ).json();
  const response = await request.post('/api/answer', {
    data: { context_set_id: compiled.context_set.id },
  });
  expect(await response.text()).toContain('"type":"complete"');
  const snapshot = await (await request.get('/api/state')).json();
  const assistant = snapshot.turns.find(
    (t: { conversation_id: string; actor: string }) =>
      t.conversation_id === seed.conversation.id && t.actor === 'assistant',
  );
  const source = snapshot.blocks.find((b: { turn_id: string }) => b.turn_id === assistant.id);
  const start = source.text_content.indexOf('让上下文可见');
  expect(
    (
      await request.post('/api/excerpts', {
        data: {
          source_block_id: source.id,
          source_content_hash: source.content_hash,
          branch: true,
          selector: {
            type: 'text_range',
            start_char: start,
            end_char: start + 6,
            exact: '让上下文可见',
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '备份与恢复', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目备份 下载原生 JSON 文件' }).click();
  const download = await downloading;
  const filePath = testInfo.outputPath('workspace-backup.json');
  await download.saveAs(filePath);
  const original = JSON.parse(await readFile(filePath, 'utf8'));
  expect(original.format).toBe('ai-context-canvas');
  expect(original.snapshot.excerpts.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: '关闭备份与恢复' }).click();

  const added = await request.post('/api/conversations', { data: { title: '备份之后的新对话' } });
  expect(added.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '备份与恢复', exact: true }).click();
  await page.getByLabel('选择项目备份文件').setInputFiles(filePath);
  await expect(page.getByText('格式、完整性及来源引用校验通过')).toBeVisible();
  const confirm = page.getByRole('button', { name: '确认导入并替换' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('checkbox', { name: '我确认用此备份替换当前工作区' }).check();
  await page.screenshot({ path: testInfo.outputPath('import-preview.png') });
  await confirm.click();
  await expect(page.getByRole('dialog', { name: '备份与恢复' })).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('navigation', { name: '工作區分頁' })
    .getByRole('button', { name: '對話', exact: true })
    .click();
  const restored = await (await request.get('/api/state')).json();
  expect(restored.excerpts).toEqual(original.snapshot.excerpts);
  expect(restored.packages).toEqual(original.snapshot.packages);
  expect(restored.nodes.map((n: { id: string }) => n.id).sort()).toEqual(
    original.snapshot.nodes.map((n: { id: string }) => n.id).sort(),
  );
  await expect(
    page
      .getByRole('navigation', { name: '对话列表' })
      .getByRole('button', { name: '备份之后的新对话' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('button', { name: '预览恢复' }).first().click();
  await expect(page.getByText('格式、完整性及来源引用校验通过')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认导入并替换' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '我确认用此备份替换当前工作区' }).check();
  await page.getByRole('button', { name: '确认导入并替换' }).click();
  await expect(page.getByRole('dialog', { name: '备份与恢复' })).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { name: '对话列表' })
      .getByRole('button', { name: '备份之后的新对话' }),
  ).toBeVisible();
});

test('rejects malformed files without offering replacement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '备份与恢复', exact: true }).click();
  await page.getByLabel('选择项目备份文件').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{broken'),
  });
  await expect(page.getByRole('alert')).toContainText('无法读取 JSON');
  await expect(page.getByRole('button', { name: '确认导入并替换' })).toHaveCount(0);
});
