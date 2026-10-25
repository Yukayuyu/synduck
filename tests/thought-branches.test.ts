import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now, exportProject, validateProject } from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import { DEFAULT_BUDGET, type ContextSet, type ContentBlock } from '@acc/domain';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
import { projectChecksum } from '../packages/db/src/project';

function input(store: Store, conversationId: string, selected: string[] = []): ContextSet {
  return {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: conversationId,
    current_node_id: store
      .snapshot()
      .nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === conversationId)!.id,
    target_turn_id: null,
    prompt_text: 'Continue only this question',
    selected_node_ids: selected,
    pinned_node_ids: [],
    excluded_node_ids: [],
    budget: DEFAULT_BUDGET,
    policy_version: 'context-policy-0.1',
    graph_snapshot_version: store.workspace().revision,
    status: 'compiled',
    created_at: now(),
  };
}
function quote(block: ContentBlock, exact = block.text_content!) {
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
function source(store: Store, text: string) {
  const conversation = store.createConversation(text);
  const turn = store.appendTurn(conversation.conversation.id, 'human', text);
  return { ...conversation, block: store.snapshot().blocks.find((b) => b.turn_id === turn.id)! };
}

describe('thought branches and multi-source picks', () => {
  it('creates a fork during a real streaming parent turn without inheriting its later output', () => {
    const store = new Store(':memory:');
    try {
      const parent = source(store, 'Existing background');
      const set = input(store, parent.conversation.id);
      const pkg = compileContext(store.snapshot(), set);
      store.saveContext(set, pkg);
      const streaming = store.beginAnswer(set.id, 'demo', 'demo-model');
      expect(streaming.turn.status).toBe('streaming');
      const child = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [{ request_id: id(), mode: 'btw', prompt: 'Ask in parallel' }],
      })[0];
      const before = compileContext(store.snapshot(), input(store, child.conversation.id));
      expect(before.items.map((i) => i.content).sort()).toEqual(
        ['Existing background', set.prompt_text].sort(),
      );
      store.finishAnswer(streaming.turn.id, {
        answer: 'Later parent output',
        used_source_ids: pkg.items.map((i) => i.source_id),
        suggested_graph_updates: [],
      });
      const after = compileContext(store.snapshot(), input(store, child.conversation.id));
      expect(after.items).toEqual(before.items);
      expect(JSON.stringify(after)).not.toContain('Later parent output');
    } finally {
      store.close();
    }
  });
  it('freezes fork background, isolates sibling questions, and retains ancestor background in a nested fork', () => {
    const store = new Store(':memory:');
    try {
      const parent = source(store, 'Shared instruction: keep the scope small.');
      const branches = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [
          { request_id: id(), mode: 'fork', prompt: 'Explore UI only.' },
          { request_id: id(), mode: 'btw', prompt: 'Check release only.' },
        ],
      });
      store.appendTurn(parent.conversation.id, 'human', 'LATER PARENT DETAIL');
      store.appendTurn(branches[1].conversation.id, 'human', 'SIBLING DETAIL');
      const a = compileContext(store.snapshot(), input(store, branches[0].conversation.id));
      expect(a.items.map((i) => i.content)).toEqual(['Shared instruction: keep the scope small.']);
      expect(JSON.stringify(a)).not.toContain('LATER PARENT DETAIL');
      expect(JSON.stringify(a)).not.toContain('SIBLING DETAIL');
      store.appendTurn(branches[0].conversation.id, 'human', 'Nested parent detail.');
      const nested = store.createForks({
        conversation_id: branches[0].conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'A smaller question' }],
      })[0];
      expect(
        compileContext(store.snapshot(), input(store, nested.conversation.id))
          .items.map((i) => i.content)
          .sort(),
      ).toEqual(['Nested parent detail.', 'Shared instruction: keep the scope small.'].sort());
      const excluded = compileContext(store.snapshot(), {
        ...input(store, branches[0].conversation.id),
        excluded_node_ids: [parent.node.id],
      });
      expect(excluded.items.some((i) => i.content.includes('Shared instruction'))).toBe(false);
      expect(validateProject(exportProject(store)).project.snapshot.conversations).toHaveLength(4);
    } finally {
      store.close();
    }
  });

  it('prepares batches transactionally, reuses request IDs and rejects conflicting retries', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const parent = source(store, 'Background');
      const first = { request_id: id(), mode: 'fork' as const, prompt: 'UI question' };
      const second = { request_id: id(), mode: 'btw' as const, prompt: 'Release question' };
      const post = (branches: object[]) =>
        app.inject({
          method: 'POST',
          url: '/api/forks',
          payload: { conversation_id: parent.conversation.id, branches },
        });
      const a = await post([first, second]);
      expect(a.statusCode).toBe(200);
      const b = await post([first, second]);
      expect(b.json()).toEqual(a.json());
      expect(store.snapshot().conversations).toHaveLength(3);
      // Creating a new first entry must roll back if a later entry conflicts.
      expect(
        (
          await post([
            { ...first, request_id: id() },
            { ...second, prompt: 'Changed' },
          ])
        ).statusCode,
      ).toBe(409);
      expect(store.snapshot().conversations).toHaveLength(3);
      expect((await post([first, first])).statusCode).toBe(400);
      const child = a.json().branches[0].conversation.id;
      const sent = await app.inject({
        method: 'POST',
        url: '/api/send',
        payload: {
          request_id: first.request_id,
          conversation_id: child,
          prompt: first.prompt,
          selected_node_ids: [],
        },
      });
      expect(sent.body).toContain('"type":"complete"');
      expect(
        store
          .snapshot()
          .turns.filter((t) => t.conversation_id === child && t.actor === 'assistant'),
      ).toHaveLength(1);
    } finally {
      await app.close();
      store.close();
    }
  });

  it('collects exact picks, allows removing the anchor quote, and never rewrites a used input', () => {
    const store = new Store(':memory:');
    try {
      const first = source(store, 'Keep the main line. Unpicked private detail.');
      const second = source(store, 'Keep source links. Other unpicked detail.');
      const third = source(store, 'Catch side thoughts.');
      const root = store.createExcerpt(quote(first.block, 'Keep the main line.'));
      store.addToCollection(root.excerpt.id, quote(second.block, 'Keep source links.'));
      const branch = store.branchExcerpt(root.excerpt.id);
      const set = input(store, branch.conversation.id);
      const pkg = compileContext(store.snapshot(), set);
      expect(pkg.items.map((i) => i.content).sort()).toEqual(
        ['Keep the main line.', 'Keep source links.'].sort(),
      );
      expect(JSON.stringify(pkg)).not.toContain('Unpicked');
      store.saveContext(set, pkg);
      const started = store.beginAnswer(set.id, 'demo', 'demo-model');
      store.finishAnswer(started.turn.id, {
        answer: 'Two sources',
        used_source_ids: pkg.items.map((i) => i.source_id),
        suggested_graph_updates: [],
      });
      const saved = structuredClone(store.snapshot().packages[0]);
      store.addToCollection(root.excerpt.id, quote(third.block));
      store.removeCollectionSource(root.excerpt.id, root.excerpt.id);
      const next = compileContext(store.snapshot(), input(store, branch.conversation.id));
      expect(
        next.items
          .filter((i) => i.source_type === 'excerpt')
          .map((i) => i.content)
          .sort(),
      ).toEqual(['Keep source links.', 'Catch side thoughts.'].sort());
      expect(store.snapshot().packages[0]).toEqual(saved);
      expect(store.snapshot().excerpts.find((e) => e.id === root.excerpt.id)!.snapshot_text).toBe(
        'Keep the main line.',
      );
      const count = store.snapshot().excerpts.length;
      store.addToCollection(root.excerpt.id, quote(third.block));
      expect(store.snapshot().excerpts).toHaveLength(count);
      const member = store
        .snapshot()
        .excerpts.find((e) => e.snapshot_text === 'Keep source links.')!;
      store.removeCollectionSource(root.excerpt.id, member.id);
      expect(() =>
        store.removeCollectionSource(
          root.excerpt.id,
          store.snapshot().excerpts.find((e) => e.snapshot_text === 'Catch side thoughts.')!.id,
        ),
      ).toThrow('至少保留');
      expect(validateProject(exportProject(store)).project.snapshot.packages[0]).toEqual(saved);
    } finally {
      store.close();
    }
  });

  it('applies collection-wide budget controls and exclusions to each source without importing source conversations', () => {
    const store = new Store(':memory:');
    try {
      const a = source(store, 'AAA unpicked A'),
        b = source(store, 'BBB unpicked B');
      const root = store.createExcerpt(quote(a.block, 'AAA'));
      store.addToCollection(root.excerpt.id, quote(b.block, 'BBB'));
      const branch = store.branchExcerpt(root.excerpt.id);
      const set = input(store, branch.conversation.id, [root.node.id]);
      expect(
        compileContext(store.snapshot(), {
          ...set,
          budget: { ...DEFAULT_BUDGET, target_context_tokens: 4 },
        }).sendable,
      ).toBe(false);
      // A collection used as branch origin must not silently lose members either.
      expect(
        compileContext(store.snapshot(), {
          ...input(store, branch.conversation.id),
          budget: { ...DEFAULT_BUDGET, target_context_tokens: 4 },
        }).sendable,
      ).toBe(false);
      const excluded = compileContext(store.snapshot(), {
        ...set,
        excluded_node_ids: [root.node.id],
      });
      expect(excluded.items).toEqual([]);
      const hidden = store
        .snapshot()
        .nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id !== root.excerpt.id)!;
      store.setNodeDeleted(hidden.id, true);
      expect(compileContext(store.snapshot(), set).items.map((i) => i.content)).toEqual(['AAA']);
    } finally {
      store.close();
    }
  });

  it('persists collections and unstarted fork tasks across restart, validating native project references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-thoughts-'));
    let store = new Store(join(dir, 'canvas.sqlite'));
    try {
      const a = source(store, 'Alpha 🌱'),
        b = source(store, 'Beta');
      const root = store.createExcerpt(quote(a.block, '🌱'));
      store.addToCollection(root.excerpt.id, quote(b.block));
      store.createForks({
        conversation_id: a.conversation.id,
        branches: [{ request_id: id(), mode: 'btw', prompt: 'Remember this task after restart' }],
      });
      const before = exportProject(store);
      store.close();
      store = new Store(join(dir, 'canvas.sqlite'));
      expect(exportProject(store).snapshot).toEqual(before.snapshot);
      expect(validateProject(before).project.snapshot).toEqual(before.snapshot);
      const damaged = structuredClone(before);
      damaged.snapshot.excerpts
        .find((e) => e.id === root.excerpt.id)!
        .collection_source_ids!.push('missing-source');
      damaged.checksum = projectChecksum({
        format: damaged.format,
        format_version: damaged.format_version,
        exported_at: damaged.exported_at,
        snapshot: damaged.snapshot,
        assets: damaged.assets,
      });
      expect(() => validateProject(damaged)).toThrow();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
