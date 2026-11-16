import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

test('offers a background summary when older messages exceed the budget, uses it, and can discard it', async ({
  page,
  request,
}) => {
  const title = `长对话摘要 ${Date.now()}`;
  const created = await request.post('/api/conversations', {
    data: { title, position: { x: -97000, y: -97000 } },
  });
  const root = (await created.json()) as { conversation: { id: string } };
  for (const label of ['第一段', '第二段', '第三段']) {
    const sent = await request.post('/api/send', {
      data: {
        conversation_id: root.conversation.id,
        prompt: `${label}：${'需要记住的背景细节。'.repeat(60)}`,
        selected_node_ids: [],
        request_id: randomUUID(),
      },
    });
    expect(sent.ok()).toBe(true);
    await sent.body();
  }
  await page.goto('/');
  await page.getByRole('button', { name: '對話', exact: true }).click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await page.getByLabel('你的问题', { exact: true }).fill('根据前面的背景，下一步是什么？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  const offer = page.locator('.summary-offer');
  await expect(offer).toContainText('条较早的消息超出预算，没有发送');
  await expect(page.locator('.context-item.compressed')).toHaveCount(0);
  await offer.getByRole('button', { name: '生成背景摘要', exact: true }).click();
  const summary = page.locator('.context-item.compressed');
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('背景摘要');
  await expect(summary).toContainText('放不下的部分');
  await expect(offer).toHaveCount(0);
  await expect(
    page.locator('.excluded-item').filter({ hasText: '已由背景摘要代表' }).first(),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/summaries.png' });
  // The summary is not a message of the conversation it describes.
  const state: ClientState = await (await request.get('/api/state')).json();
  expect(state.turns.filter((t) => t.conversation_id === root.conversation.id)).toHaveLength(6);
  expect(
    state.conversations.find((c) => c.id === root.conversation.id)!.summary_block_id,
  ).not.toBeNull();
  await page.reload();
  await page.getByRole('button', { name: '對話', exact: true }).click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await page.getByLabel('你的问题', { exact: true }).fill('重启后摘要还在吗？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(summary).toHaveCount(1);
  await page.getByRole('button', { name: '停用这份摘要', exact: true }).click();
  await expect(summary).toHaveCount(0);
  await expect(offer).toHaveCount(1);
});
