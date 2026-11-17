import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, id, now, exportProject, validateProject, noteTitle } from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import { DEFAULT_BUDGET, modelInput, noteBlock, noteMetadata, type ContextSet } from '@acc/domain';
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
    prompt_text: 'What now?',
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

describe('note cards', () => {
  it('stores the person’s words without an answer, versions edits and survives restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'notes-'));
    const path = join(directory, 'canvas.sqlite');
    try {
      const store = new Store(path);
      const request_id = randomUUID();
      const { node, block } = store.createNote({
        request_id,
        text: '線索：用戶流失集中在第二週',
        position: { x: 10, y: 20 },
      });
      expect(node.ref_type).toBe('turn');
      expect(node.title).toBe(noteTitle('線索：用戶流失集中在第二週'));
      expect(noteMetadata(block)).toMatchObject({ kind: 'note', color: 'yellow', version: 1 });
      const snapshot = store.snapshot();
      // No assistant turn: a note never asks the model anything.
      expect(snapshot.turns.filter((t) => t.actor === 'assistant')).toHaveLength(0);
      expect(store.createNote({ request_id, text: '線索：用戶流失集中在第二週' }).node.id).toBe(
        node.id,
      );
      expect(() => store.createNote({ request_id, text: 'different' })).toThrow();
      const first = store.snapshot().excerpts.length;
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 2, exact: '線索' },
        branch: false,
      });
      const edited = store.editNote(node.id, {
        text: '線索：流失集中在第二週的新用戶',
        color: 'pink',
      });
      expect(edited.id).toBe(node.id);
      expect(edited.ref_id).not.toBe(node.ref_id);
      expect(edited.title).toBe(noteTitle('線索：流失集中在第二週的新用戶'));
      const after = store.snapshot();
      const current = noteBlock(after, edited)!;
      expect(current.text_content).toBe('線索：流失集中在第二週的新用戶');
      expect(noteMetadata(current)).toMatchObject({ version: 2, color: 'pink' });
      // The old text and the excerpt taken from it are untouched.
      expect(after.blocks.find((b) => b.id === block.id)!.text_content).toBe(
        '線索：用戶流失集中在第二週',
      );
      expect(after.excerpts).toHaveLength(first + 1);
      expect(validateProject(exportProject(store)).project.snapshot.blocks).toHaveLength(
        after.blocks.length,
      );
      store.close();
      const reopened = new Store(path);
      const restored = reopened.snapshot().nodes.find((n) => n.id === node.id)!;
      expect(noteBlock(reopened.snapshot(), restored)!.text_content).toContain('新用戶');
      expect(excerpt.excerpt.source_block_id).toBe(block.id);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('enters context only when selected or linked, and exclusion still wins', () => {
    const store = new Store(':memory:');
    try {
      const talk = store.createConversation('Retention');
      store.appendTurn(talk.conversation.id, 'human', 'Why do users leave?');
      const note = store.createNote({ request_id: randomUUID(), text: 'Churn peaks in week two.' });
      const plain = compileContext(store.snapshot(), input(store, talk.conversation.id));
      expect(modelInput(plain)).not.toContain('Churn peaks');
      const selected = compileContext(
        store.snapshot(),
        input(store, talk.conversation.id, { selected_node_ids: [note.node.id] }),
      );
      expect(selected.items.map((i) => i.content)).toContain('Churn peaks in week two.');
      store.createLink({
        source_node_id: note.node.id,
        target_node_id: talk.node.id,
        type: 'contradicts',
      });
      const linked = compileContext(store.snapshot(), input(store, talk.conversation.id));
      const item = linked.items.find((i) => i.content === 'Churn peaks in week two.')!;
      expect(item.link).toEqual({ type: 'contradicts', direction: 'to_current' });
      expect(item.role).toBe('related');
      expect(
        JSON.parse(modelInput(linked)).context.find(
          (c: { content: string }) => c.content === item.content,
        ).link,
      ).toEqual({
        type: 'contradicts',
        direction: 'to_current',
      });
      const excluded = compileContext(
        store.snapshot(),
        input(store, talk.conversation.id, { excluded_node_ids: [note.node.id] }),
      );
      expect(modelInput(excluded)).not.toContain('Churn peaks');
    } finally {
      store.close();
    }
  });
});

describe('links', () => {
  it('keeps one user link per pair, changes its type and deletes only user links', () => {
    const store = new Store(':memory:');
    try {
      const a = store.createNote({ request_id: randomUUID(), text: 'A' });
      const b = store.createNote({ request_id: randomUUID(), text: 'B' });
      const link = store.createLink({
        source_node_id: a.node.id,
        target_node_id: b.node.id,
        type: 'supports',
      });
      const again = store.createLink({
        source_node_id: b.node.id,
        target_node_id: a.node.id,
        type: 'alternative_to',
      });
      expect(again.id).toBe(link.id);
      expect(again.type).toBe('alternative_to');
      expect(store.snapshot().edges.filter((e) => e.edge_class === 'semantic')).toHaveLength(1);
      expect(() =>
        store.createLink({
          source_node_id: a.node.id,
          target_node_id: a.node.id,
          type: 'supports',
        }),
      ).toThrow();
      store.setNodeDeleted(b.node.id, true);
      expect(() =>
        store.createLink({
          source_node_id: a.node.id,
          target_node_id: b.node.id,
          type: 'supports',
        }),
      ).toThrow('回收桶');
      const talk = store.createConversation('Talk');
      const excerpt = store.snapshot().edges.find((e) => e.edge_class === 'structural');
      if (excerpt) expect(() => store.deleteLink(excerpt.id)).toThrow();
      store.deleteLink(link.id);
      expect(store.snapshot().edges.some((e) => e.id === link.id)).toBe(false);
      expect(talk.node).toBeTruthy();
    } finally {
      store.close();
    }
  });
});

describe('brainstorm', () => {
  it('proposes directions from an excerpt with its thread as background, then adds only accepted ones', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const talk = store.createConversation('Pricing');
      store.appendTurn(talk.conversation.id, 'human', 'Should we offer a free tier for students?');
      const block = store.snapshot().blocks[0];
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: {
          type: 'text_range',
          start_char: block.text_content!.indexOf('free tier'),
          end_char: block.text_content!.indexOf('free tier') + 9,
          exact: 'free tier',
        },
        branch: false,
      });
      const request_id = randomUUID();
      const response = await app.inject({
        method: 'POST',
        url: '/api/brainstorm',
        payload: { node_id: excerpt.node.id, request_id, count: 3 },
      });
      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.ideas).toHaveLength(3);
      expect(result.ideas[0]).toMatchObject({ index: 0, type: 'idea' });
      // Proposals only: nothing new on the canvas yet.
      const before = store.snapshot();
      expect(before.nodes).toHaveLength(2);
      const set = before.context_sets.find((c) => c.id === `brainstorm-${request_id}`)!;
      expect(set.current_node_id).toBe(talk.node.id);
      expect(set.selected_node_ids).toEqual([excerpt.node.id]);
      const pkg = before.packages.find((p) => p.context_set_id === set.id)!;
      expect(pkg.items.find((i) => i.role === 'selected')?.content).toBe('free tier');
      // The brainstorm is not a message in the source conversation.
      expect(before.turns.filter((t) => t.conversation_id === talk.conversation.id)).toHaveLength(
        1,
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/brainstorm',
            payload: { node_id: excerpt.node.id, request_id, count: 3 },
          })
        ).statusCode,
      ).toBe(409);
      const accept = await app.inject({
        method: 'POST',
        url: `/api/brainstorm/${result.turn_id}/accept`,
        payload: { indexes: [0, 2] },
      });
      expect(accept.statusCode).toBe(200);
      const created = accept.json().nodes;
      expect(created).toHaveLength(2);
      const after = store.snapshot();
      for (const node of created) {
        const meta = noteMetadata(noteBlock(after, node));
        expect(meta).toMatchObject({ kind: 'idea', idea: { brainstorm_turn_id: result.turn_id } });
        expect(node.created_by).toBe('ai');
        expect(
          after.edges.some(
            (e) =>
              e.type === 'generated_from' &&
              e.source_node_id === excerpt.node.id &&
              e.target_node_id === node.id,
          ),
        ).toBe(true);
      }
      // Accepting again does not duplicate cards.
      const repeat = await app.inject({
        method: 'POST',
        url: `/api/brainstorm/${result.turn_id}/accept`,
        payload: { indexes: [0, 1] },
      });
      expect(repeat.json().nodes.map((n: { id: string }) => n.id)).toContain(created[0].id);
      expect(store.snapshot().nodes).toHaveLength(5);
      // Idea cards do not enter other conversations' context unless chosen.
      expect(
        modelInput(compileContext(store.snapshot(), input(store, talk.conversation.id))),
      ).not.toContain(result.ideas[0].prompt);
      // Idea cards are named after the direction and hold its question.
      expect(created[0].title).toBe(result.ideas[0].title);
      expect(noteBlock(after, created[0])!.text_content).toBe(result.ideas[0].prompt);
      expect(validateProject(exportProject(store)).project.snapshot.nodes).toHaveLength(5);
      // A note can be brainstormed on its own.
      const note = store.createNote({ request_id: randomUUID(), text: 'Idea: referral codes' });
      const fromNote = await app.inject({
        method: 'POST',
        url: '/api/brainstorm',
        payload: { node_id: note.node.id, request_id: randomUUID(), count: 5 },
      });
      expect(fromNote.json().ideas).toHaveLength(5);
    } finally {
      await app.close();
      store.close();
    }
  });
});
