import { describe, expect, it } from 'vitest';
import { Store, id, now } from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import { DEFAULT_BUDGET, modelInput, type ContextSet } from '@acc/domain';

function fixture() {
  const store = new Store(':memory:');
  const root = store.createConversation('原始研究');
  store.appendTurn(root.conversation.id, 'human', 'SQLite is local. Unrelated secret detail.');
  const b = store.snapshot().blocks[0];
  const excerpt = store.createExcerpt({
    source_block_id: b.id,
    source_content_hash: b.content_hash,
    selector: { type: 'text_range', start_char: 0, end_char: 16, exact: 'SQLite is local.' },
    branch: true,
  });
  const branch = excerpt.branch!;
  const set: ContextSet = {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: branch.conversation.id,
    target_turn_id: null,
    current_node_id: branch.node.id,
    prompt_text: 'Which database?',
    selected_node_ids: [],
    pinned_node_ids: [],
    excluded_node_ids: [],
    budget: DEFAULT_BUDGET,
    policy_version: 'context-policy-0.1',
    graph_snapshot_version: store.workspace().revision,
    status: 'compiled',
    created_at: now(),
  };
  return { store, set, root, excerpt, branch };
}

describe('deterministic context policy', () => {
  it('isolates branches and includes only the exact branch-origin excerpt', () => {
    const f = fixture();
    try {
      const a = compileContext(f.store.snapshot(), f.set);
      expect(a.items.map((i) => i.content)).toEqual(['SQLite is local.']);
      expect(modelInput(a)).not.toContain('Unrelated secret detail');
      expect(compileContext(f.store.snapshot(), f.set)).toEqual(a);
    } finally {
      f.store.close();
    }
  });
  it('exclude beats pin/select and blocks aliases reached through a parent conversation', () => {
    const f = fixture();
    try {
      const result = compileContext(f.store.snapshot(), {
        ...f.set,
        selected_node_ids: [f.root.node.id, f.excerpt.node.id],
        pinned_node_ids: [f.excerpt.node.id],
        excluded_node_ids: [f.excerpt.node.id],
      });
      expect(result.items).toHaveLength(0);
      expect(result.excluded.some((e) => e.reason.includes('overlaps'))).toBe(true);
      expect(modelInput(result)).not.toContain('SQLite');
    } finally {
      f.store.close();
    }
  });
  it('blocks sending when selected sources cannot fit instead of silently truncating', () => {
    const f = fixture();
    try {
      const result = compileContext(f.store.snapshot(), {
        ...f.set,
        selected_node_ids: [f.excerpt.node.id],
        budget: { ...DEFAULT_BUDGET, target_context_tokens: 4 },
      });
      expect(result.sendable).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    } finally {
      f.store.close();
    }
  });
  it('makes saved preview content immutable while allowing its used transition', () => {
    const f = fixture();
    try {
      const pkg = compileContext(f.store.snapshot(), f.set);
      f.store.saveContext(f.set, pkg);
      expect(() => f.store.saveContext({ ...f.set, prompt_text: 'different prompt' }, pkg)).toThrow(
        '不可修改',
      );
      expect(() =>
        f.store.saveContext(f.set, { ...pkg, current_prompt: 'different prompt' }),
      ).toThrow('不可修改');
      expect(() => f.store.beginAnswer(f.set.id, 'demo', 'demo-model')).not.toThrow();
    } finally {
      f.store.close();
    }
  });
  it('omits rejected sources unless explicit and labels superseded material historical', () => {
    const f = fixture();
    try {
      f.store.saveNode({ ...f.excerpt.node, context_state: 'rejected' });
      expect(compileContext(f.store.snapshot(), f.set).items).toHaveLength(0);
      const explicit = compileContext(f.store.snapshot(), {
        ...f.set,
        selected_node_ids: [f.excerpt.node.id],
      });
      expect(explicit.items[0].role).toBe('historical');
      f.store.saveNode({ ...f.excerpt.node, context_state: 'superseded' });
      expect(compileContext(f.store.snapshot(), f.set).items[0].role).toBe('historical');
    } finally {
      f.store.close();
    }
  });
  it('rejects stale provenance and reports missing explicit references', () => {
    const f = fixture();
    try {
      const b = f.store.snapshot().blocks[0];
      f.store.saveBlock({ ...b, text_content: 'changed text' });
      expect(compileContext(f.store.snapshot(), f.set).sendable).toBe(false);
      const missing = compileContext(f.store.snapshot(), {
        ...f.set,
        selected_node_ids: ['missing'],
      });
      expect(missing.conflicts.some((c) => c.type === 'missing_reference')).toBe(true);
      expect(missing.sendable).toBe(false);
    } finally {
      f.store.close();
    }
  });
  it('excludes answers derived from excluded sources, and their downstream answers', () => {
    const f = fixture();
    try {
      const pkg = compileContext(f.store.snapshot(), f.set);
      f.store.saveContext(f.set, pkg);
      const first = f.store.beginAnswer(f.set.id, 'demo', 'demo-model');
      f.store.finishAnswer(first.turn.id, {
        answer: 'A paraphrase of the source',
        used_source_ids: [],
        suggested_graph_updates: [],
      });
      const secondSet = {
        ...f.set,
        id: id(),
        graph_snapshot_version: f.store.workspace().revision,
        prompt_text: 'More detail',
      };
      f.store.saveContext(secondSet, compileContext(f.store.snapshot(), secondSet));
      const second = f.store.beginAnswer(secondSet.id, 'demo', 'demo-model');
      f.store.finishAnswer(second.turn.id, {
        answer: 'Another paraphrase',
        used_source_ids: [],
        suggested_graph_updates: [],
      });
      const next = compileContext(f.store.snapshot(), {
        ...secondSet,
        id: id(),
        excluded_node_ids: [f.excerpt.node.id],
      });
      expect(next.items.map((i) => i.actor)).toEqual(['human', 'human']);
      expect(
        next.excluded.filter((i) => i.reason === 'answer depends on an excluded source'),
      ).toHaveLength(2);
      expect(modelInput(next)).not.toContain('paraphrase');
    } finally {
      f.store.close();
    }
  });
});
