import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Store, exportProject, validateProject } from '@acc/db';
import type { Answer, ContextPackage } from '@acc/domain';
import type { ModelProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';

class ControlledProvider implements ModelProvider {
  name = 'controlled';
  model = 'controlled-model';
  pending: {
    pkg: ContextPackage;
    signal?: AbortSignal;
    draft?: (text: string) => void;
    resolve: (answer: Answer) => void;
  }[] = [];
  constructor(private cooperate = true) {}
  generate(pkg: ContextPackage, draft?: (text: string) => void, signal?: AbortSignal) {
    return new Promise<Answer>((resolve, reject) => {
      this.pending.push({ pkg, signal, draft, resolve });
      if (this.cooperate) {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }
    });
  }
  finish(index: number) {
    this.pending[index].resolve({
      answer: `Result: ${this.pending[index].pkg.current_prompt}`,
      used_source_ids: this.pending[index].pkg.items.map((i) => i.source_id),
      suggested_graph_updates: [],
    });
  }
}

describe('independent concurrent conversations', () => {
  it('starts two direct sends, isolates their context, cancels one and preserves the other through completion and backup', async () => {
    const store = new Store(':memory:');
    const provider = new ControlledProvider();
    const app = createApp(store, provider);
    const a = store.createConversation('A');
    const b = store.createConversation('B');
    store.appendTurn(a.conversation.id, 'human', 'Evidence A');
    store.appendTurn(b.conversation.id, 'human', 'Evidence B');
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    const input = (conversation_id: string, prompt: string) => ({
      request_id: randomUUID(),
      conversation_id,
      prompt,
      selected_node_ids: [],
    });
    const requestA = input(a.conversation.id, 'Question A');
    const requestB = input(b.conversation.id, 'Question B');
    let sendingA: ReturnType<typeof post> | Promise<Awaited<ReturnType<typeof post>>> | undefined;
    let sendingB: typeof sendingA;
    try {
      sendingA = post('/api/send', requestA).then((r) => r);
      await vi.waitFor(() => expect(provider.pending).toHaveLength(1));
      sendingB = post('/api/send', requestB).then((r) => r);
      await vi.waitFor(() => expect(provider.pending).toHaveLength(2));
      const snapshot = store.snapshot();
      expect(snapshot.turns.filter((t) => t.status === 'streaming')).toHaveLength(2);
      expect(provider.pending[0].pkg.current_prompt).toBe('Question A');
      expect(provider.pending[1].pkg.current_prompt).toBe('Question B');
      expect(provider.pending[0].pkg.items.map((i) => i.content)).toEqual(['Evidence A']);
      expect(provider.pending[1].pkg.items.map((i) => i.content)).toEqual(['Evidence B']);
      const sameConversation = await post('/api/send', input(a.conversation.id, 'Another A'));
      expect(sameConversation.statusCode).toBe(409);
      expect(store.snapshot().context_sets).toHaveLength(2); // Rejected preparation rolls back.
      expect(provider.pending).toHaveLength(2);
      expect(() => store.renameNode(a.node.id, 'Locked')).toThrow();
      expect(() => store.setNodeDeleted(a.node.id, true)).toThrow();
      const unused = store.createConversation('Unrelated');
      store.renameNode(unused.node.id, 'Still editable');
      store.setNodeDeleted(unused.node.id, true);
      provider.pending[0].draft?.('Only A draft');
      provider.pending[1].draft?.('Only B draft');
      const turnA = snapshot.turns.find(
        (t) => t.conversation_id === a.conversation.id && t.status === 'streaming',
      )!;
      const turnB = snapshot.turns.find(
        (t) => t.conversation_id === b.conversation.id && t.status === 'streaming',
      )!;
      expect((await post(`/api/answers/${turnA.id}/cancel`, {})).statusCode).toBe(200);
      const cancelled = await sendingA;
      expect(cancelled.body).toContain('generation_cancelled');
      expect(cancelled.body).not.toContain('Only B draft');
      expect(provider.pending[0].signal?.aborted).toBe(true);
      expect(provider.pending[1].signal?.aborted).toBe(false);
      expect(store.snapshot().turns.find((t) => t.id === turnB.id)?.status).toBe('streaming');
      provider.finish(1);
      const completed = await sendingB;
      expect(completed.body).toContain('"type":"complete"');
      expect(completed.body).not.toContain('Only A draft');
      const after = store.snapshot();
      expect(after.turns.find((t) => t.id === turnA.id)?.status).toBe('error');
      expect(after.turns.find((t) => t.id === turnB.id)?.status).toBe('complete');
      expect(after.blocks.filter((block) => block.turn_id === turnA.id)).toEqual([]);
      expect(after.packages).toEqual(snapshot.packages);
      expect(validateProject(exportProject(store)).project.snapshot.context_sets).toEqual(
        after.context_sets,
      );
      expect((await post('/api/send', requestB)).statusCode).toBe(409);
      expect((await post(`/api/answers/${turnB.id}/cancel`, {})).json()).toEqual({
        ok: true,
        already_finished: true,
      });
      expect(store.snapshot().turns).toEqual(after.turns);
      // The stopped answer can retry its exact sealed input, without another human turn.
      const retry = post('/api/retry', { turn_id: turnA.id }).then((r) => r);
      await vi.waitFor(() => expect(provider.pending).toHaveLength(3));
      expect(provider.pending[2].pkg).toEqual(provider.pending[0].pkg);
      provider.finish(2);
      expect((await retry).body).toContain('"type":"complete"');
      expect(store.snapshot().turns).toHaveLength(after.turns.length);
    } finally {
      provider.pending.forEach((_, i) => provider.finish(i));
      await Promise.allSettled([sendingA, sendingB]);
      await app.close();
      store.close();
    }
  });

  it('rejects a late successful result after cancellation even if a provider ignores abort', async () => {
    const store = new Store(':memory:');
    const provider = new ControlledProvider(false);
    const app = createApp(store, provider);
    let sending: Promise<unknown> | undefined;
    try {
      const c = store.createConversation('Late');
      sending = app
        .inject({
          method: 'POST',
          url: '/api/send',
          payload: {
            request_id: randomUUID(),
            conversation_id: c.conversation.id,
            prompt: 'Late answer',
            selected_node_ids: [],
          },
        })
        .then((r) => r);
      await vi.waitFor(() => expect(provider.pending).toHaveLength(1));
      const turn = store.snapshot().turns.find((t) => t.actor === 'assistant')!;
      await app.inject({ method: 'POST', url: `/api/answers/${turn.id}/cancel`, payload: {} });
      provider.finish(0);
      await sending;
      expect(store.snapshot().turns.find((t) => t.id === turn.id)?.status).toBe('error');
      expect(store.snapshot().blocks.filter((block) => block.turn_id === turn.id)).toEqual([]);
    } finally {
      provider.pending.forEach((_, i) => provider.finish(i));
      await sending;
      await app.close();
      store.close();
    }
  });
  it('cancels only the disconnected HTTP stream and allows the other connection to finish', async () => {
    const store = new Store(':memory:');
    const provider = new ControlledProvider();
    const app = createApp(store, provider);
    const controller = new AbortController();
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const start = (conversation_id: string, signal?: AbortSignal) =>
        fetch(`${address}/api/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: randomUUID(),
            conversation_id,
            prompt: conversation_id,
            selected_node_ids: [],
          }),
          signal,
        });
      const a = store.createConversation('HTTP A');
      const b = store.createConversation('HTTP B');
      const responseA = await start(a.conversation.id, controller.signal);
      const responseB = await start(b.conversation.id);
      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);
      await vi.waitFor(() => expect(provider.pending).toHaveLength(2));
      controller.abort();
      await vi.waitFor(() =>
        expect(
          store
            .snapshot()
            .turns.find((t) => t.conversation_id === a.conversation.id && t.actor === 'assistant')
            ?.status,
        ).toBe('error'),
      );
      expect(provider.pending[0].signal?.aborted).toBe(true);
      expect(provider.pending[1].signal?.aborted).toBe(false);
      provider.finish(1);
      expect(await responseB.text()).toContain('"type":"complete"');
      expect(
        store
          .snapshot()
          .turns.find((t) => t.conversation_id === b.conversation.id && t.actor === 'assistant')
          ?.status,
      ).toBe('complete');
    } finally {
      controller.abort();
      provider.pending.forEach((_, i) => provider.finish(i));
      app.server.closeAllConnections();
      await app.close();
      store.close();
    }
  });
});
