import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

test('shows the context chain of a fork in the inspector and saves it with the answer', async ({
  page,
  request,
}) => {
  const title = `脉络主线 ${Date.now()}`;
  const created = await request.post('/api/conversations', {
    data: { title, position: { x: -91000, y: -91000 } },
  });
  const root = (await created.json()) as { node: { id: string }; conversation: { id: string } };
  const sent = await request.post('/api/send', {
    data: {
      conversation_id: root.conversation.id,
      prompt: '主线决定：先做本地优先。',
      selected_node_ids: [],
      request_id: randomUUID(),
    },
  });
  expect(sent.ok()).toBe(true);
  await sent.body();
  const forked = await request.post('/api/forks', {
    data: {
      conversation_id: root.conversation.id,
      branches: [{ request_id: randomUUID(), mode: 'fork', prompt: '脉络分支：检查存储方案' }],
    },
  });
  expect(forked.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: '對話', exact: true }).click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: '脉络分支：检查存储方案', exact: true })
    .click();
  await page.getByLabel('你的问题', { exact: true }).fill('沿着主线，下一步是什么？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  const chain = page.getByRole('list', { name: '脉络链' }).getByRole('listitem');
  await expect(chain).toHaveCount(2);
  await expect(chain.nth(0)).toContainText('上一层 · 经分支');
  await expect(chain.nth(0)).toContainText(title);
  await expect(chain.nth(1)).toContainText('当前对话');
  await expect(page.locator('.context-item .item-thread').first()).toContainText(title);
  await page.screenshot({ path: 'test-results/context-chain.png' });
  await page.getByRole('button', { name: '发送此上下文' }).click();
  const saved = async () => {
    const state: ClientState = await (await request.get('/api/state')).json();
    const child = state.conversations.find(
      (c) => c.fork_origin?.conversation_id === root.conversation.id,
    )!;
    const answer = state.turns.find(
      (t) => t.conversation_id === child.id && t.actor === 'assistant' && t.status === 'complete',
    );
    const pkg = state.packages.find((p) => p.context_set_id === answer?.input_context_set_id);
    return pkg?.threads?.map((t) => [
      t.thread_id === root.conversation.id ? 'root' : t.thread_id === child.id ? 'child' : 'other',
      t.relation,
      t.depth,
      t.via,
    ]);
  };
  await expect.poll(saved).toEqual([
    ['root', 'ancestor', 1, 'fork'],
    ['child', 'current', null, null],
  ]);
});
