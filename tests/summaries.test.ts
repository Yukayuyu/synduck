import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store, id, now, exportProject, validateProject } from '@acc/db';
import { compileContext, compileSummaryInput } from '@acc/context-compiler';
import {
  DEFAULT_BUDGET,
  SUMMARY_PROMPT,
  conversationSummaries,
  modelInput,
  type ContextSet,
} from '@acc/domain';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';

function input(store: Store, conversationId: string, extra: Partial<ContextSet> = {}): ContextSet {
  return {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: conversationId,
    current_node_id: store
      .snapshot()
      .nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === conversationId)!.id,
    target_turn_id: null,
    prompt_text: 'Continue',
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
// Stores a summary exactly as the API does, with fixed text instead of a model.
function summarize(store: Store, conversationId: string, text: string) {
  const set = input(store, conversationId, {
    id: `summary-${randomUUID()}`,
    prompt_text: SUMMARY_PROMPT,
    budget: {
      max_input_tokens: 128000,
      reserved_output_tokens: 8000,
      target_context_tokens: 64000,
    },
  });
  const pkg = compileSummaryInput(store.snapshot(), set);
  const { turn } = store.beginSummary(set, pkg, 'demo', 'demo-model');
  return store.finishSummary(turn.id, {
    answer: text,
    used_source_ids: pkg.items.map((i) => i.source_id),
    suggested_graph_updates: [],
  });
}
const long = (label: string) => `${label} ${'detail '.repeat(120)}`;
function thread(store: Store, count = 6) {
  const conversation = store.createConversation('Long plan');
  for (let n = 1; n <= count; n++)
    store.appendTurn(conversation.conversation.id, 'human', long(`M${n}`));
  return conversation;
}
const tight = { ...DEFAULT_BUDGET, target_context_tokens: 2000 };

describe('conversation summaries', () => {
  it('keeps the latest messages under budget and lets a summary stand in for older ones', () => {
    const store = new Store(':memory:');
    try {
      const c = thread(store);
      const before = compileContext(
        store.snapshot(),
        input(store, c.conversation.id, { budget: tight }),
      );
      // Two ~850-byte messages fit: the newest two, not the oldest two.
      expect(before.items.map((i) => i.content.slice(0, 2)).sort()).toEqual(['M5', 'M6']);
      expect(before.items.some((i) => i.compressed)).toBe(false);

      const block = summarize(store, c.conversation.id, 'SUMMARY: M1 to M6 decided to stay local.');
      const pkg = compileContext(
        store.snapshot(),
        input(store, c.conversation.id, { budget: tight }),
      );
      const summary = pkg.items.find((i) => i.compressed)!;
      expect(summary.source_id).toBe(block.id);
      expect(summary.summarized_block_ids).toHaveLength(6);
      expect(summary.thread_id).toBe(c.conversation.id);
      expect(
        pkg.items
          .filter((i) => !i.compressed)
          .map((i) => i.content.slice(0, 2))
          .sort(),
      ).toEqual(['M5', 'M6']);
      expect(
        pkg.excluded.filter((e) => e.reason === 'represented by a conversation summary'),
      ).toHaveLength(4);
      expect(pkg.excluded.some((e) => e.reason === 'omitted to fit context budget')).toBe(false);
      // The model reads the summary first, marked as compressed, then the recent messages.
      const sent = JSON.parse(modelInput(pkg)).context as {
        compressed?: boolean;
        content: string;
      }[];
      expect(sent[0].compressed).toBe(true);
      expect(sent.slice(1).map((i) => i.content.slice(0, 2))).toEqual(['M5', 'M6']);
      expect(pkg.budget.used_context_tokens).toBeLessThanOrEqual(tight.target_context_tokens);
      // With room for everything the original text is used and the summary is not.
      const roomy = compileContext(
        store.snapshot(),
        input(store, c.conversation.id, {
          budget: { ...DEFAULT_BUDGET, target_context_tokens: 20000 },
        }),
      );
      expect(roomy.items).toHaveLength(6);
      expect(roomy.items.some((i) => i.compressed)).toBe(false);
      // The summary never appears as a message of the conversation it describes.
      expect(
        store.snapshot().turns.filter((t) => t.conversation_id === c.conversation.id),
      ).toHaveLength(6);
      expect(
        store.snapshot().conversations.find((x) => x.id === c.conversation.id)!.summary_block_id,
      ).toBe(block.id);
    } finally {
      store.close();
    }
  });

  it('never gives a fork a summary that covers parent messages written after the fork', () => {
    const store = new Store(':memory:');
    try {
      const parent = thread(store, 4);
      const early = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'Early branch' }],
      })[0];
      store.appendTurn(parent.conversation.id, 'human', long('LATER'));
      summarize(store, parent.conversation.id, 'SUMMARY including LATER parent detail.');
      const late = store.createForks({
        conversation_id: parent.conversation.id,
        branches: [{ request_id: id(), mode: 'fork', prompt: 'Late branch' }],
      })[0];
      const earlyPkg = compileContext(
        store.snapshot(),
        input(store, early.conversation.id, { budget: tight }),
      );
      expect(earlyPkg.items.some((i) => i.compressed)).toBe(false);
      expect(JSON.stringify(earlyPkg)).not.toContain('LATER');
      expect(earlyPkg.excluded.some((e) => e.reason === 'omitted to fit context budget')).toBe(
        true,
      );
      const latePkg = compileContext(
        store.snapshot(),
        input(store, late.conversation.id, { budget: tight }),
      );
      const summary = latePkg.items.find((i) => i.compressed)!;
      expect(summary.content).toContain('SUMMARY including LATER');
      expect(summary.role).toBe('branch_origin');
      expect(latePkg.threads!.map((t) => t.relation)).toEqual(['ancestor', 'current']);
    } finally {
      store.close();
    }
  });

  it('drops a summary when any summarized source is excluded, and when it is discarded', () => {
    const store = new Store(':memory:');
    try {
      const c = thread(store);
      const first = store.snapshot().blocks.find((b) => b.text_content!.startsWith('M1'))!;
      const quote = store.createExcerpt({
        source_block_id: first.id,
        source_content_hash: first.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 2, exact: 'M1' },
        branch: false,
      });
      const block = summarize(store, c.conversation.id, 'SUMMARY mentioning M1 secret.');
      const excluded = compileContext(
        store.snapshot(),
        input(store, c.conversation.id, { budget: tight, excluded_node_ids: [quote.node.id] }),
      );
      expect(excluded.items.some((i) => i.compressed)).toBe(false);
      expect(modelInput(excluded)).not.toContain('SUMMARY');
      // A partly excluded conversation cannot be summarized either.
      const blockedInput = compileSummaryInput(
        store.snapshot(),
        input(store, c.conversation.id, {
          excluded_node_ids: [quote.node.id],
          budget: { ...DEFAULT_BUDGET, max_input_tokens: 128000, target_context_tokens: 64000 },
        }),
      );
      expect(blockedInput.sendable).toBe(false);
      expect(modelInput(blockedInput)).not.toContain('M1 detail');

      store.discardSummary(block.id);
      const after = compileContext(
        store.snapshot(),
        input(store, c.conversation.id, { budget: tight }),
      );
      expect(after.items.some((i) => i.compressed)).toBe(false);
      expect(
        store.snapshot().conversations.find((x) => x.id === c.conversation.id)!.summary_block_id,
      ).toBe(null);
      expect(conversationSummaries(store.snapshot(), c.conversation.id)[0].summary.status).toBe(
        'discarded',
      );
    } finally {
      store.close();
    }
  });

  it('keeps explicitly selected conversations complete instead of summarizing them', () => {
    const store = new Store(':memory:');
    try {
      const c = thread(store);
      const other = store.createConversation('Asker');
      summarize(store, c.conversation.id, 'SUMMARY');
      const pkg = compileContext(
        store.snapshot(),
        input(store, other.conversation.id, { budget: tight, selected_node_ids: [c.node.id] }),
      );
      expect(pkg.sendable).toBe(false);
      expect(pkg.items.some((i) => i.compressed)).toBe(false);
    } finally {
      store.close();
    }
  });

  it('creates, reuses safely and discards summaries through the API, and survives export', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const c = thread(store, 3);
      const request_id = randomUUID();
      const created = await app.inject({
        method: 'POST',
        url: '/api/summaries',
        payload: { conversation_id: c.conversation.id, request_id },
      });
      expect(created.statusCode).toBe(200);
      const block = created.json().block;
      expect(block.structured_data.summary).toMatchObject({
        conversation_id: c.conversation.id,
        request_id,
        status: 'active',
      });
      expect(block.structured_data.summary.source_block_ids).toHaveLength(3);
      const turn = store.snapshot().turns.find((t) => t.id === block.turn_id)!;
      expect(turn.input_context_set_id).toBe(`summary-${request_id}`);
      const sealed = store
        .snapshot()
        .packages.find((p) => p.context_set_id === turn.input_context_set_id)!;
      expect(sealed.items.map((i) => i.source_block_id)).toEqual(
        block.structured_data.summary.source_block_ids,
      );
      const repeat = await app.inject({
        method: 'POST',
        url: '/api/summaries',
        payload: { conversation_id: c.conversation.id, request_id },
      });
      expect(repeat.statusCode).toBe(409);
      const empty = store.createConversation('Empty');
      const refused = await app.inject({
        method: 'POST',
        url: '/api/summaries',
        payload: { conversation_id: empty.conversation.id, request_id: randomUUID() },
      });
      expect(refused.statusCode).toBe(409);
      const restored = validateProject(exportProject(store)).project.snapshot;
      expect(conversationSummaries(restored, c.conversation.id)).toHaveLength(1);
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/summaries/${block.id}`,
        payload: {},
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().block.structured_data.summary.status).toBe('discarded');
    } finally {
      await app.close();
      store.close();
    }
  });
});
