import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { ClientState } from '../../apps/web/src/api';

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

test('jots a note, links it to a conversation the AI then sees, and brainstorms idea cards', async ({
  page,
  request,
}) => {
  // Unique words per run: other tests and repeats share this server.
  const run = Date.now().toString(36);
  const created = await request.post('/api/conversations', {
    data: { title: '留存分析', position: { x: -170000, y: -170000 } },
  });
  const talk = (await created.json()) as { node: { id: string }; conversation: { id: string } };
  const sent = await request.post('/api/send', {
    data: {
      conversation_id: talk.conversation.id,
      prompt: '用戶為什麼在第二週流失？',
      selected_node_ids: [],
      request_id: randomUUID(),
    },
  });
  await sent.body();
  await request.patch('/api/workspace', {
    data: { viewport: { x: 170000 + 120, y: 170000 + 120, zoom: 1 } },
  });
  await page.goto('/');

  // 1. A note: no question, no answer.
  await page.getByRole('button', { name: '新增筆記', exact: true }).click();
  const noteDialog = page.getByRole('dialog', { name: '新增筆記' });
  await noteDialog.getByLabel('筆記內容').fill(`線索${run}：流失集中在沒有完成引導的用戶`);
  await noteDialog.getByRole('radio', { name: '粉' }).click();
  await noteDialog.getByLabel('筆記內容').press('Enter');
  await expect(noteDialog).toHaveCount(0);
  const note = page
    .locator('.canvas-card.note')
    .filter({ hasText: `線索${run}：流失集中在沒有完成引導` });
  await expect(note).toHaveClass(/note-pink/);
  let state: ClientState = await (await request.get('/api/state')).json();
  const noteNode = state.nodes.find((n) => n.title.startsWith(`線索${run}：`))!;
  // The note's own conversation holds the words and no answer.
  const noteTurn = state.turns.find((t) => t.id === noteNode.ref_id)!;
  expect(
    state.turns.filter((t) => t.conversation_id === noteTurn.conversation_id).map((t) => t.actor),
  ).toEqual(['human']);

  // Show both cards: other tests share this server, so positions vary.
  const talkNode = state.nodes.find((n) => n.id === talk.node.id)!;
  const zoom = 0.6;
  const left = Math.min(talkNode.x, noteNode.x);
  const top = Math.min(talkNode.y, noteNode.y);
  await request.patch('/api/workspace', {
    data: { viewport: { x: -left * zoom + 80, y: -top * zoom + 100, zoom } },
  });
  await page.reload();
  expect(Math.abs(talkNode.x - noteNode.x) * zoom).toBeLessThan(1100);
  expect(Math.abs(talkNode.y - noteNode.y) * zoom).toBeLessThan(500);

  // 2. Link the note to the conversation as a counterpoint.
  await page
    .locator(`.react-flow__node[data-id="${noteNode.id}"]`)
    .getByRole('button', { name: '卡片操作：' + noteNode.title, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '連結到…', exact: true }).click();
  await expect(page.locator('.link-banner')).toBeVisible();
  const talkCard = page.locator(`.react-flow__node[data-id="${talk.node.id}"]`);
  await talkCard.locator('.card-title').click();
  await page.getByRole('menuitem', { name: '反對', exact: true }).click();
  await expect(page.locator('.react-flow__edge-text').filter({ hasText: '反對' })).toBeVisible();

  // The AI receives the linked note, labelled with the relation.
  await talkCard.locator('.card-title').click();
  const input = talkCard.getByLabel('你的问题', { exact: true });
  await input.fill('下一步做什麼？');
  await talkCard.getByLabel('提问选项', { exact: true }).click();
  const compiled = page.waitForResponse((r) => r.url().endsWith('/api/compile'));
  await talkCard.getByRole('button', { name: '预览上下文', exact: true }).click();
  const pkg = (await (await compiled).json()).package;
  const linked = pkg.items.find((i: { node_id: string }) => i.node_id === noteNode.id);
  expect(linked.link).toEqual({ type: 'contradicts', direction: 'to_current' });
  await expect(
    page.locator('.context-item').filter({ hasText: `線索${run}：流失集中在沒有完成引導` }),
  ).toBeVisible();
  await page.getByRole('button', { name: '關閉面板', exact: true }).click();

  // 3. Brainstorm from a passage of the answer and keep two directions.
  const answer = talkCard.getByTestId('turn-assistant').last().getByTestId('content-block');
  await select(answer, '让上下文可见');
  await page.getByRole('button', { name: '從選取文字腦力激盪', exact: true }).click();
  const brainstorm = page.getByRole('dialog', { name: /让上下文可见/ });
  await brainstorm.getByRole('button', { name: '3', exact: true }).click();
  const ideas = brainstorm.getByRole('list', { name: '方向' }).getByRole('checkbox');
  await expect(ideas).toHaveCount(3);
  await ideas.nth(1).uncheck();
  await page.screenshot({ path: 'test-results/brainstorm.png' });
  const before = new Set(
    ((await (await request.get('/api/state')).json()) as ClientState).nodes.map((n) => n.id),
  );
  await brainstorm.getByRole('button', { name: '加入 2 張', exact: true }).click();
  await expect(brainstorm).toHaveCount(0);
  state = await (await request.get('/api/state')).json();
  const ideaNodes = state.nodes.filter((n) => n.created_by === 'ai' && !before.has(n.id));
  expect(ideaNodes).toHaveLength(2);
  expect(
    state.edges.filter(
      (e) => e.type === 'generated_from' && ideaNodes.some((n) => n.id === e.target_node_id),
    ),
  ).toHaveLength(2);
  await page.screenshot({ path: 'test-results/thinking-tools.png' });

  // The view shows the source with its new ideas.
  for (const node of ideaNodes)
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"]`)).toBeInViewport();
  await page.screenshot({ path: 'test-results/ideas-revealed.png' });
  await request.patch('/api/workspace', {
    data: { viewport: { x: -noteNode.x + 200, y: -noteNode.y + 200, zoom: 1 } },
  });
  await page.reload();
  // 4. Edit the note; the card keeps its place and shows the new words.
  await page
    .locator(`.react-flow__node[data-id="${noteNode.id}"]`)
    .getByRole('button', { name: '卡片操作：' + noteNode.title, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '編輯筆記', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '編輯筆記' });
  await expect(edit.getByLabel('筆記內容')).toHaveValue(`線索${run}：流失集中在沒有完成引導的用戶`);
  await edit.getByLabel('筆記內容').fill(`線索${run}：流失集中在跳過引導的新用戶`);
  await edit.getByRole('button', { name: '保存筆記' }).click();
  await expect(
    page.locator('.canvas-card.note').filter({ hasText: `線索${run}：流失集中在跳過引導` }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/note-card.png' });

  // 5. Retype the link from the line itself, then remove it.
  await page.locator('.react-flow__edge.relation-contradicts').dispatchEvent('click');
  await page.getByRole('menuitem', { name: '支持', exact: true }).click();
  await expect(page.locator('.react-flow__edge-text').filter({ hasText: '支持' })).toBeVisible();
  await page.locator('.react-flow__edge.relation-supports').dispatchEvent('click');
  await page.getByRole('menuitem', { name: '移除連結', exact: true }).click();
  await expect(page.locator('.react-flow__edge.relation-supports')).toHaveCount(0);
  await page.reload();
  for (const node of ideaNodes)
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"]`)).toHaveCount(1);

  // 6. Expanding an idea opens a conversation with its question ready to send.
  const idea = ideaNodes[0];
  const ideaPrompt = (await (await request.get('/api/state')).json()).blocks.find(
    (b: { turn_id: string }) => b.turn_id === idea.ref_id,
  ).text_content;
  await request.patch('/api/workspace', {
    data: { viewport: { x: -idea.x + 200, y: -idea.y + 200, zoom: 1 } },
  });
  await page.reload();
  await page
    .locator(`.react-flow__node[data-id="${idea.id}"]`)
    .getByRole('button', { name: '卡片操作：' + idea.title, exact: true })
    .click();
  await page.getByRole('menuitem', { name: '以此提問', exact: true }).click();
  await expect(page.locator('.focus-panel[data-active="true"]').getByLabel('你的问题')).toHaveValue(
    ideaPrompt,
  );
});
