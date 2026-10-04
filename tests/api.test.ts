import { describe, expect, it } from 'vitest';
import { Store } from '@acc/db';
import { DemoProvider, type ModelProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';

describe('application flow', () => {
  it('runs conversation → preview → answer → excerpt → branch and preserves exact input snapshots', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    try {
      const c = (await post('/api/conversations', { title: '研究' })).json();
      const p = (
        await post('/api/compile', {
          conversation_id: c.conversation.id,
          prompt: 'How does context work?',
          selected_node_ids: [],
        })
      ).json();
      const answer = await post('/api/answer', { context_set_id: p.context_set.id });
      expect(answer.statusCode).toBe(200);
      expect(answer.body).toContain('"type":"complete"');
      const s = store.snapshot();
      const turn = s.turns.find((t) => t.actor === 'assistant')!;
      expect(turn.input_context_set_id).toBe(p.context_set.id);
      expect(turn.status).toBe('complete');
      expect(s.turns.map((t) => t.sequence)).toEqual([1, 2]);
      expect(turn.parent_turn_id).toBe(s.turns[0].id);
      const block = s.blocks.find((b) => b.turn_id === turn.id)!;
      const range = block.text_content!.indexOf('让上下文可见');
      const e = (
        await post('/api/excerpts', {
          source_block_id: block.id,
          source_content_hash: block.content_hash,
          selector: {
            type: 'text_range',
            start_char: range,
            end_char: range + 6,
            exact: '让上下文可见',
          },
          branch: true,
        })
      ).json();
      const next = (
        await post('/api/compile', {
          conversation_id: e.branch.conversation.id,
          prompt: 'Elaborate',
          selected_node_ids: [],
        })
      ).json();
      expect(next.package.items.map((i: { content: string }) => i.content)).toEqual([
        '让上下文可见',
      ]);
      expect(
        store.snapshot().packages.find((pkg) => pkg.package_id === p.package.package_id),
      ).toEqual(p.package);
      expect((await post('/api/answer', { context_set_id: p.context_set.id })).statusCode).toBe(
        409,
      );
    } finally {
      await app.close();
      store.close();
    }
  });
  it('rejects stale previews and foreign origins', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const c = store.createConversation('test');
      const p = (
        await app.inject({
          method: 'POST',
          url: '/api/compile',
          payload: { conversation_id: c.conversation.id, prompt: 'hello', selected_node_ids: [] },
        })
      ).json();
      store.createConversation('another');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/answer',
            payload: { context_set_id: p.context_set.id },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/conversations',
            headers: { origin: 'https://untrusted.example' },
            payload: { title: 'bad' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/state',
            headers: { host: 'attacker.example' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
      store.close();
    }
  });
  it('does not persist invalid model output, and retries without duplicating the human turn', async () => {
    const store = new Store(':memory:');
    let bad = true;
    const provider: ModelProvider = {
      name: 'stub',
      model: 'stub-model',
      async generate() {
        if (bad)
          return {
            answer: 'bad citation',
            used_source_ids: ['invented'],
            suggested_graph_updates: [],
          };
        return { answer: 'valid answer', used_source_ids: [], suggested_graph_updates: [] };
      },
    };
    const app = createApp(store, provider);
    try {
      const c = store.createConversation('test');
      const p = (
        await app.inject({
          method: 'POST',
          url: '/api/compile',
          payload: { conversation_id: c.conversation.id, prompt: 'hello', selected_node_ids: [] },
        })
      ).json();
      const response = await app.inject({
        method: 'POST',
        url: '/api/answer',
        payload: { context_set_id: p.context_set.id },
      });
      expect(response.body).toContain('"type":"error"');
      const s = store.snapshot();
      expect(s.blocks).toHaveLength(1);
      expect(s.turns[1].status).toBe('error');
      bad = false;
      const retry = await app.inject({
        method: 'POST',
        url: '/api/retry',
        payload: { turn_id: s.turns[1].id },
      });
      expect(retry.body).toContain('"type":"complete"');
      expect(store.snapshot().turns).toHaveLength(2);
      expect(store.snapshot().blocks).toHaveLength(2);
    } finally {
      await app.close();
      store.close();
    }
  });
});
