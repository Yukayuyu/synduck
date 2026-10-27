import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, exportProject, validateProject, previewProject, importProject } from '@acc/db';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';

describe('canvas card actions', () => {
  it('persists explicit card dimensions across restart and backup without invalidating input context', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-resize-'));
    const path = join(directory, 'workspace.sqlite');
    let store = new Store(path);
    let app = createApp(store, new DemoProvider());
    try {
      const root = store.createConversation('Size is presentation');
      const preview = (
        await app.inject({
          method: 'POST',
          url: '/api/compile',
          payload: {
            conversation_id: root.conversation.id,
            prompt: 'Use this input',
            selected_node_ids: [],
          },
        })
      ).json();
      const snapshot = store.snapshot();
      const resize = await app.inject({
        method: 'PATCH',
        url: '/api/nodes/' + root.node.id,
        payload: { width: 600, height: 700, size_mode: 'manual' },
      });
      expect(resize.statusCode).toBe(200);
      expect(store.workspace().revision).toBe(snapshot.workspace.revision);
      expect(store.snapshot().packages).toEqual(snapshot.packages);
      expect(store.snapshot().nodes.find((node) => node.id === root.node.id)).toMatchObject({
        width: 600,
        height: 700,
        size_mode: 'manual',
      });
      expect(validateProject(exportProject(store)).project.snapshot.nodes[0]).toMatchObject({
        width: 600,
        height: 700,
        size_mode: 'manual',
      });
      for (const payload of [
        { width: 0, height: 700, size_mode: 'manual' },
        { width: 600 },
        { width: 600, height: 700, size_mode: 'auto' },
        { width: 1700, height: 700, size_mode: 'manual' },
      ]) {
        expect(
          (await app.inject({ method: 'PATCH', url: '/api/nodes/' + root.node.id, payload }))
            .statusCode,
        ).toBe(400);
      }
      await app.close();
      store.close();
      store = new Store(path);
      app = createApp(store, new DemoProvider());
      expect(store.snapshot().nodes.find((node) => node.id === root.node.id)).toMatchObject({
        width: 600,
        height: 700,
        size_mode: 'manual',
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/answer',
            payload: { context_set_id: preview.context_set.id },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/nodes/' + root.node.id,
            payload: { size_mode: 'auto' },
          })
        ).statusCode,
      ).toBe(200);
      expect(store.snapshot().nodes.find((node) => node.id === root.node.id)?.size_mode).toBe(
        'auto',
      );
    } finally {
      await app.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('rejects retrying a historical package through an alias of a deleted source until restored', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const root = store.createConversation('retry source');
      store.appendTurn(root.conversation.id, 'human', 'Source evidence');
      const block = store.snapshot().blocks[0];
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 6, exact: 'Source' },
        branch: true,
      });
      const preview = (
        await app.inject({
          method: 'POST',
          url: '/api/compile',
          payload: {
            conversation_id: excerpt.branch!.conversation.id,
            prompt: 'Explain',
            selected_node_ids: [],
          },
        })
      ).json();
      const { turn } = store.beginAnswer(preview.context_set.id, 'demo', 'demo');
      store.failAnswer(turn.id, 'Expected failure');
      store.setNodeDeleted(root.node.id, true);
      const retry = await app.inject({
        method: 'POST',
        url: '/api/retry',
        payload: { turn_id: turn.id },
      });
      expect(retry.statusCode).toBe(409);
      expect(store.snapshot().turns.find((t) => t.id === turn.id)?.status).toBe('error');
      expect(
        store.snapshot().packages.find((p) => p.package_id === preview.package.package_id),
      ).toEqual(preview.package);
      store.setNodeDeleted(root.node.id, false);
      const restored = await app.inject({
        method: 'POST',
        url: '/api/retry',
        payload: { turn_id: turn.id },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.body).toContain('"type":"complete"');
    } finally {
      await app.close();
      store.close();
    }
  });
  it('deletes reversibly, excludes source aliases, preserves provenance and persists through backup/restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-deletion-'));
    const path = join(directory, 'workspace.sqlite');
    let store = new Store(path);
    let app = createApp(store, new DemoProvider());
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    try {
      const root = store.createConversation('source');
      store.appendTurn(root.conversation.id, 'human', 'Original evidence stays intact.');
      const block = store.snapshot().blocks[0];
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 8, exact: 'Original' },
        branch: true,
      });
      await post('/api/context-control', { node_id: root.node.id, action: 'pin' });
      const preview = (
        await post('/api/compile', {
          conversation_id: excerpt.branch!.conversation.id,
          prompt: 'Explain',
          selected_node_ids: [],
        })
      ).json();
      const before = store.snapshot();
      expect(
        (await app.inject({ method: 'DELETE', url: '/api/nodes/' + root.node.id, payload: {} }))
          .statusCode,
      ).toBe(200);
      const after = store.snapshot();
      for (const key of [
        'blocks',
        'turns',
        'excerpts',
        'edges',
        'context_sets',
        'packages',
      ] as const)
        expect(after[key]).toEqual(before[key]);
      expect(after.workspace.revision).toBe(before.workspace.revision + 1);
      expect(
        (await post('/api/answer', { context_set_id: preview.context_set.id })).statusCode,
      ).toBe(409);
      expect(
        (
          await post('/api/compile', {
            conversation_id: root.conversation.id,
            prompt: 'Hidden',
            selected_node_ids: [],
          })
        ).statusCode,
      ).toBe(409);
      const next = (
        await post('/api/compile', {
          conversation_id: excerpt.branch!.conversation.id,
          prompt: 'New package',
          selected_node_ids: [root.node.id, excerpt.node.id],
        })
      ).json();
      expect(next.package.items).toEqual([]);
      expect(next.package.excluded).toContainEqual({
        node_id: root.node.id,
        source_id: null,
        reason: 'deleted from canvas',
      });
      expect(
        store.snapshot().packages.find((p) => p.package_id === preview.package.package_id),
      ).toEqual(preview.package);
      const file = exportProject(store);
      expect(
        validateProject(file).project.snapshot.nodes.find((n) => n.id === root.node.id)?.visibility,
      ).toBe('hidden');
      const target = new Store(':memory:');
      try {
        importProject(target, file, previewProject(target, file).current);
        expect(target.snapshot().nodes).toEqual(store.snapshot().nodes);
        expect(target.snapshot().blocks).toEqual(before.blocks);
      } finally {
        target.close();
      }
      await app.close();
      store.close();
      store = new Store(path);
      app = createApp(store, new DemoProvider());
      expect(store.snapshot().nodes.find((n) => n.id === root.node.id)?.visibility).toBe('hidden');
      expect((await post('/api/nodes/' + root.node.id + '/restore', {})).statusCode).toBe(200);
      const restored = (
        await post('/api/compile', {
          conversation_id: excerpt.branch!.conversation.id,
          prompt: 'Restored',
          selected_node_ids: [],
        })
      ).json();
      expect(restored.package.items.length).toBeGreaterThan(0);
      expect(store.snapshot().blocks).toEqual(before.blocks);
    } finally {
      await app.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('removes a deleted excerpt from subsequent branch answers and rejects new branches until restored', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const root = store.createConversation('source');
      store.appendTurn(root.conversation.id, 'human', 'private source');
      const block = store.snapshot().blocks[0];
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 7, exact: 'private' },
        branch: true,
      });
      const compile = async () =>
        (
          await app.inject({
            method: 'POST',
            url: '/api/compile',
            payload: {
              conversation_id: excerpt.branch!.conversation.id,
              prompt: 'Explain',
              selected_node_ids: [],
            },
          })
        ).json();
      const initial = await compile();
      await app.inject({
        method: 'POST',
        url: '/api/answer',
        payload: { context_set_id: initial.context_set.id },
      });
      store.setNodeDeleted(excerpt.node.id, true);
      const next = await compile();
      expect(next.package.items.every((item: { actor: string }) => item.actor === 'human')).toBe(
        true,
      );
      expect(
        next.package.excluded.some(
          (item: { reason: string }) => item.reason === 'answer depends on an excluded source',
        ),
      ).toBe(true);
      expect(() => store.branchExcerpt(excerpt.excerpt.id)).toThrow('還原');
      store.setNodeDeleted(excerpt.node.id, false);
      expect(() => store.branchExcerpt(excerpt.excerpt.id)).not.toThrow();
    } finally {
      await app.close();
      store.close();
    }
  });
  it('frees deleted space and restores beside occupied cards without moving them', () => {
    const store = new Store(':memory:');
    try {
      const first = store.createConversation('first', undefined, { x: 100, y: 100 });
      store.setNodeDeleted(first.node.id, true);
      const second = store.createConversation('second', undefined, { x: 100, y: 100 });
      expect([second.node.x, second.node.y]).toEqual([100, 100]);
      const restored = store.setNodeDeleted(first.node.id, false);
      expect(restored.y).toBeGreaterThan(second.node.y + second.node.height);
      expect(store.snapshot().nodes.find((n) => n.id === second.node.id)).toEqual(second.node);
      const revision = store.workspace().revision;
      store.setNodeDeleted(first.node.id, false);
      expect(store.workspace().revision).toBe(revision);
    } finally {
      store.close();
    }
  });
  it('renames atomically without changing excerpt snapshots and rejects malformed, missing and streaming mutations', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    try {
      const root = store.createConversation('old title');
      const rename = (title: string) =>
        app.inject({
          method: 'POST',
          url: '/api/nodes/' + root.node.id + '/rename',
          payload: { title },
        });
      expect((await rename(' New title ')).statusCode).toBe(200);
      expect(store.snapshot().conversations[0].title).toBe('New title');
      expect(store.snapshot().nodes[0].title).toBe('New title');
      expect((await rename('   ')).statusCode).toBe(400);
      expect(
        (await app.inject({ method: 'DELETE', url: '/api/nodes/missing', payload: {} })).statusCode,
      ).toBe(404);
      store.appendTurn(root.conversation.id, 'human', 'immutable text');
      const block = store.snapshot().blocks[0];
      const excerpt = store.createExcerpt({
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 9, exact: 'immutable' },
        branch: false,
      });
      store.renameNode(excerpt.node.id, 'Label only');
      expect(store.snapshot().excerpts[0].snapshot_text).toBe('immutable');
      expect(store.snapshot().blocks[0]).toEqual(block);
      const preview = (
        await app.inject({
          method: 'POST',
          url: '/api/compile',
          payload: {
            conversation_id: root.conversation.id,
            prompt: 'Generate',
            selected_node_ids: [],
          },
        })
      ).json();
      store.beginAnswer(preview.context_set.id, 'demo', 'demo');
      const before = store.snapshot();
      expect(
        (await app.inject({ method: 'DELETE', url: '/api/nodes/' + root.node.id, payload: {} }))
          .statusCode,
      ).toBe(409);
      expect((await rename('during generation')).statusCode).toBe(409);
      expect(store.snapshot()).toEqual(before);
    } finally {
      await app.close();
      store.close();
    }
  });
});
