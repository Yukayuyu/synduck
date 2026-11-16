import { describe, expect, it } from 'vitest';
import { Store, id, now, exportProject, validateProject } from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import {
  DEFAULT_BUDGET,
  ContextPackageSchema,
  modelInput,
  type ContextSet,
  type ContentBlock,
} from '@acc/domain';

function input(store: Store, conversationId: string, extra: Partial<ContextSet> = {}): ContextSet {
  return {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: conversationId,
    current_node_id: store
      .snapshot()
      .nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === conversationId)!.id,
    target_turn_id: null,
    prompt_text: 'What should we do next?',
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
function source(store: Store, title: string, text: string) {
  const conversation = store.createConversation(title);
  const turn = store.appendTurn(conversation.conversation.id, 'human', text);
  return { ...conversation, block: store.snapshot().blocks.find((b) => b.turn_id === turn.id)! };
}
const sent = (pkg: Parameters<typeof modelInput>[0]) =>
  JSON.parse(modelInput(pkg)) as {
    threads?: { thread_id: string; relation: string; depth: number | null; via: string | null }[];
    context: { thread_id?: string; content: string }[];
  };

describe('context chain', () => {
  it('orders nested fork ancestors from farthest to the current thread', () => {
    const store = new Store(':memory:');
    try {
      const root = source(store, 'Product plan', 'Root decision: stay local-first.');
      const middle = store.createForks({
        conversation_id: root.conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'Explore storage' }],
      })[0];
      store.appendTurn(middle.conversation.id, 'human', 'Middle finding: SQLite is enough.');
      const leaf = store.createForks({
        conversation_id: middle.conversation.id,
        branches: [{ request_id: id(), mode: 'btw', prompt: 'Check backups' }],
      })[0];
      store.appendTurn(leaf.conversation.id, 'human', 'Leaf note: export weekly.');
      const pkg = compileContext(store.snapshot(), input(store, leaf.conversation.id));
      expect(
        pkg.threads!.map(({ thread_id, relation, depth, via }) => [
          thread_id,
          relation,
          depth,
          via,
        ]),
      ).toEqual([
        [root.conversation.id, 'ancestor', 2, 'fork'],
        [middle.conversation.id, 'ancestor', 1, 'btw'],
        [leaf.conversation.id, 'current', null, null],
      ]);
      expect(pkg.threads![0].title).toBe('Product plan');
      // The live thread outranks inherited background when budgeting, but the
      // model reads background first and the live thread last.
      expect(pkg.items[0].content).toBe('Leaf note: export weekly.');
      const model = sent(pkg);
      expect(model.context.map((item) => item.content)).toEqual([
        'Root decision: stay local-first.',
        'Middle finding: SQLite is enough.',
        'Leaf note: export weekly.',
      ]);
      expect(model.context.map((item) => item.thread_id)).toEqual([
        root.conversation.id,
        middle.conversation.id,
        leaf.conversation.id,
      ]);
      expect(compileContext(store.snapshot(), input(store, leaf.conversation.id)).threads).toEqual(
        pkg.threads,
      );
    } finally {
      store.close();
    }
  });

  it('marks merged viewpoints and selected references without naming quote-only threads', () => {
    const store = new Store(':memory:');
    try {
      const a = source(store, 'Private title A', 'View A: ship early. Unpicked A detail.');
      const b = source(store, 'Private title B', 'View B: ship late. Unpicked B detail.');
      const c = source(store, 'Design notes', 'Reference: users want offline mode.');
      const root = store.createExcerpt({ ...quote(a.block, 'View A: ship early.'), branch: false });
      store.addToCollection(root.excerpt.id, quote(b.block, 'View B: ship late.'));
      const branch = store.branchExcerpt(root.excerpt.id);
      const pkg = compileContext(
        store.snapshot(),
        input(store, branch.conversation.id, { selected_node_ids: [c.node.id] }),
      );
      const model = sent(pkg);
      expect(model.threads!.map(({ relation, depth, via }) => [relation, depth, via])).toEqual([
        ['ancestor', 1, 'merge'],
        ['ancestor', 1, 'merge'],
        ['reference', null, null],
        ['current', null, null],
      ]);
      expect(new Set(model.threads!.slice(0, 2).map((t) => t.thread_id))).toEqual(
        new Set([a.conversation.id, b.conversation.id]),
      );
      expect(pkg.threads!.map((t) => t.title)).toEqual([null, null, 'Design notes', null]);
      expect(modelInput(pkg)).not.toContain('Private title');
      expect(modelInput(pkg)).not.toContain('Unpicked');
      // Budget accounting covers the chain metadata that is actually sent.
      expect(pkg.budget.estimated_input_tokens).toBeGreaterThan(
        Buffer.byteLength(modelInput(pkg), 'utf8'),
      );
    } finally {
      store.close();
    }
  });

  it('never lists a thread whose sources were excluded', () => {
    const store = new Store(':memory:');
    try {
      const parent = source(store, 'Secret parent', 'Confidential background.');
      const child = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'Continue' }],
      })[0];
      const pkg = compileContext(
        store.snapshot(),
        input(store, child.conversation.id, { excluded_node_ids: [parent.node.id] }),
      );
      expect(pkg.threads!.map((t) => t.relation)).toEqual(['current']);
      expect(modelInput(pkg)).not.toContain('Secret parent');
      expect(modelInput(pkg)).not.toContain(parent.conversation.id);
    } finally {
      store.close();
    }
  });

  it('keeps the original serialization for packages saved before chains and survives export', () => {
    const store = new Store(':memory:');
    try {
      const parent = source(store, 'Plan', 'Background.');
      const child = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'Continue' }],
      })[0];
      const set = input(store, child.conversation.id);
      const pkg = compileContext(store.snapshot(), set);
      const legacy = ContextPackageSchema.parse({
        ...pkg,
        threads: undefined,
        items: pkg.items.map(({ thread_id: _thread, ...item }) => item),
      });
      const old = JSON.parse(modelInput(legacy));
      expect(Object.keys(old)).toEqual(['current_prompt', 'context', 'conflicts']);
      expect(Object.keys(old.context[0])).not.toContain('thread_id');
      store.saveContext(set, pkg);
      const restored = validateProject(exportProject(store)).project.snapshot.packages[0];
      expect(restored.threads).toEqual(pkg.threads);
    } finally {
      store.close();
    }
  });
});
