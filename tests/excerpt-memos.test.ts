import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now, exportProject, validateProject } from '@acc/db';
import { projectChecksum } from '../packages/db/src/project';
import { DEFAULT_BUDGET, type ContextSet, type ContentBlock } from '@acc/domain';
import { compileContext, excludedSources } from '@acc/context-compiler';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function fixture(path = ':memory:') {
  const store = new Store(path);
  cleanup.push(() => store.close());
  const source = store.createConversation('來源');
  const turn = store.appendTurn(source.conversation.id, 'human', '不可更改的原文，還有另一段。');
  const block = store.snapshot().blocks.find((b) => b.turn_id === turn.id)!;
  const excerpt = store.createExcerpt(quote(block, '不可更改的原文'));
  return { store, source, block, ...excerpt };
}
function quote(block: ContentBlock, exact: string) {
  const start = block.text_content!.indexOf(exact);
  return {
    source_block_id: block.id,
    source_content_hash: block.content_hash,
    selector: {
      type: 'text_range' as const,
      start_char: start,
      end_char: start + exact.length,
      exact,
    },
  };
}
function input(store: Store, conversationId: string, extra: Partial<ContextSet> = {}): ContextSet {
  return {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: conversationId,
    current_node_id: store
      .snapshot()
      .nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === conversationId)!.id,
    target_turn_id: null,
    prompt_text: '從摘錄與備註繼續',
    selected_node_ids: [],
    pinned_node_ids: [],
    excluded_node_ids: [],
    budget: DEFAULT_BUDGET,
    policy_version: 'context-policy-0.1',
    graph_snapshot_version: store.workspace().revision,
    status: 'compiled',
    created_at: now(),
    ...extra,
  };
}
it('saves human memos without an AI request, preserves quote provenance and survives a restart and backup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'excerpt-memo-'));
  cleanup.unshift(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'canvas.sqlite');
  const { store, excerpt, block } = fixture(path);
  const memo = store.saveExcerptMemo(excerpt.id, {
    text: '  暫時記下想法，稍後再問。  ',
    expected_block_id: null,
  });
  expect(memo.block?.text_content).toBe('暫時記下想法，稍後再問。');
  expect(store.snapshot().blocks.find((b) => b.id === block.id)).toEqual(block);
  expect(memo.excerpt).toEqual({ ...excerpt, memo_block_id: memo.block!.id });
  expect(store.snapshot().turns.find((t) => t.id === memo.block?.turn_id)).toMatchObject({
    actor: 'human',
    status: 'complete',
    input_context_set_id: null,
  });
  expect(store.snapshot().packages).toEqual([]);
  store.close();
  cleanup.pop();
  const restored = new Store(path);
  cleanup.push(() => restored.close());
  expect(restored.snapshot().excerpts.find((e) => e.id === excerpt.id)?.memo_block_id).toBe(
    memo.block?.id,
  );
  validateProject(exportProject(restored));
});
it('uses the latest memo in future branches while keeping prior answers, memo versions and sealed inputs intact', () => {
  const { store, excerpt, node } = fixture();
  const first = store.saveExcerptMemo(excerpt.id, {
    text: '先考慮可讀性。',
    expected_block_id: null,
  });
  const branch = store.branchExcerpt(excerpt.id);
  const set = input(store, branch.conversation.id);
  const old = compileContext(store.snapshot(), set);
  expect(old.items.find((i) => i.source_id === excerpt.id)?.content).toBe(excerpt.snapshot_text);
  expect(old.items.find((i) => i.source_id === first.block!.id)).toMatchObject({
    source_type: 'content_block',
    node_id: node.id,
    actor: 'human',
    content: '先考慮可讀性。',
  });
  store.saveContext(set, old);
  const answer = store.beginAnswer(set.id, 'demo', 'demo-model');
  store.finishAnswer(answer.turn.id, {
    answer: '已考慮原文和備註。',
    used_source_ids: [first.block!.id],
    suggested_graph_updates: [],
  });
  const sealed = store.snapshot().packages.find((p) => p.context_set_id === set.id)!;
  const second = store.saveExcerptMemo(excerpt.id, {
    text: '再補充手機上的操作。',
    expected_block_id: first.block!.id,
  });
  expect(second.block?.structured_data?.excerpt_memo).toEqual({
    excerpt_id: excerpt.id,
    version: 2,
  });
  const next = compileContext(store.snapshot(), input(store, branch.conversation.id));
  expect(next.items.some((i) => i.source_id === second.block!.id)).toBe(true);
  expect(next.items.some((i) => i.source_id === first.block!.id)).toBe(false);
  expect(store.snapshot().packages.find((p) => p.context_set_id === set.id)).toEqual(sealed);
  expect(store.snapshot().blocks.find((b) => b.id === first.block!.id)?.text_content).toBe(
    '先考慮可讀性。',
  );
  validateProject(exportProject(store));
  const conflict = () =>
    store.saveExcerptMemo(excerpt.id, {
      text: '過期視窗的文字',
      expected_block_id: first.block!.id,
    });
  expect(conflict).toThrow('其他地方更新');
  expect(store.snapshot().excerpts.find((e) => e.id === excerpt.id)?.memo_block_id).toBe(
    second.block!.id,
  );
  const excluded = excludedSources(store.snapshot(), [node.id]);
  expect(excluded.blocks.has(first.block!.id)).toBe(true);
  expect(excluded.blocks.has(second.block!.id)).toBe(true);
  const answerBlock = store.snapshot().blocks.find((b) => b.turn_id === answer.turn.id)!;
  expect(excluded.derivedBlocks.has(answerBlock.id)).toBe(true);
});
it('keeps collection notes after removing the anchor quote, respects exclusion and never silently drops an over-budget memo', () => {
  const { store, excerpt, node, block } = fixture();
  const first = store.saveExcerptMemo(excerpt.id, {
    text: '兩段文字的共同想法。',
    expected_block_id: null,
  });
  const hub = store.addToCollection(excerpt.id, quote(block, '另一段'));
  store.removeCollectionSource(excerpt.id, excerpt.id);
  const branch = store.branchExcerpt(excerpt.id);
  const pkg = compileContext(store.snapshot(), input(store, branch.conversation.id));
  expect(pkg.sendable).toBe(true);
  expect(pkg.items.map((i) => i.content).sort()).toEqual(['另一段', '兩段文字的共同想法。'].sort());
  const excluded = compileContext(
    store.snapshot(),
    input(store, branch.conversation.id, { excluded_node_ids: [node.id] }),
  );
  expect(excluded.items).toHaveLength(0);
  store.saveExcerptMemo(excerpt.id, {
    text: '備註'.repeat(7000),
    expected_block_id: first.block!.id,
  });
  const large = compileContext(
    store.snapshot(),
    input(store, branch.conversation.id, {
      budget: { ...DEFAULT_BUDGET, target_context_tokens: 1500 },
    }),
  );
  expect(large.sendable).toBe(false);
  const current = store.snapshot().excerpts.find((e) => e.id === hub.excerpt.id)!;
  store.saveExcerptMemo(excerpt.id, { text: '', expected_block_id: current.memo_block_id! });
  const cleared = compileContext(store.snapshot(), input(store, branch.conversation.id));
  expect(cleared.items.map((i) => i.content)).toEqual(['另一段']);
  validateProject(exportProject(store));
});
it('rejects a tampered memo pointer and applies memo API changes only to a live excerpt', async () => {
  const { store, excerpt, node, block } = fixture();
  const app = createApp(store, new DemoProvider());
  await app.ready();
  cleanup.push(() => app.close());
  const url = '/api/excerpts/' + excerpt.id + '/memo';
  const saved = await app.inject({
    method: 'PUT',
    url,
    payload: { text: '先寫備註', expected_block_id: null },
  });
  expect(saved.statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        payload: { text: '過期修改', expected_block_id: null },
      })
    ).statusCode,
  ).toBe(409);
  const project = exportProject(store);
  project.snapshot.excerpts.find((e) => e.id === excerpt.id)!.memo_block_id = block.id;
  const payload = { ...project };
  Reflect.deleteProperty(payload, 'checksum');
  project.checksum = projectChecksum(payload);
  expect(() => validateProject(project)).toThrow(/備註/);
  store.setNodeDeleted(node.id, true);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url,
        payload: { text: '不可更改', expected_block_id: saved.json().block.id },
      })
    ).statusCode,
  ).toBe(404);
});
