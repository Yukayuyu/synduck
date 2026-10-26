import { describe, expect, it, vi } from 'vitest';
import { Store, exportProject, validateProject } from '@acc/db';
import { DemoProvider, type ModelProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
import { DEFAULT_BUDGET, type ContextPackage } from '@acc/domain';
import { CanvasRegistry } from '../apps/api/src/canvases';
import { mkdtempSync, rmSync, existsSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalExecutor } from '../packages/local-runtime/src/executor';
import { TestDesktopDriver } from './helpers/desktop';

describe('isolated canvases', () => {
  it('recovers interrupted answers in every canvas without changing their sealed inputs', async () => {
    const store = new Store(':memory:');
    const registry = new CanvasRegistry(store);
    const app = createApp(store, new DemoProvider(), { canvases: registry });
    try {
      const second = registry.create('Interrupted second canvas');
      const ids = [registry.primaryId, second.id];
      const packages: ContextPackage[][] = [];
      for (const canvasId of ids) {
        const current = registry.get(canvasId);
        const conversation = current.createConversation('Pending task');
        const compiled = (
          await app.inject({
            method: 'POST',
            url: '/api/compile',
            headers: { 'x-canvas-id': canvasId },
            payload: {
              conversation_id: conversation.conversation.id,
              prompt: 'Keep this input',
              selected_node_ids: [],
            },
          })
        ).json();
        current.beginAnswer(compiled.context_set.id, 'demo', 'demo-model');
        packages.push(current.snapshot().packages);
      }
      registry.recoverInterrupted();
      const recovered = ids.map((id, index) => {
        const snapshot = registry.get(id).snapshot();
        expect(snapshot.turns.find((turn) => turn.actor === 'assistant')?.status).toBe('error');
        expect(snapshot.packages).toEqual(packages[index]);
        expect(validateProject(exportProject(registry.get(id))).project.snapshot.packages).toEqual(
          packages[index],
        );
        return snapshot;
      });
      registry.recoverInterrupted();
      expect(ids.map((id) => registry.get(id).snapshot())).toEqual(recovered);
    } finally {
      await app.close();
      store.close();
    }
  });
  it('uses an independent transport identity for legacy projects with non-ASCII workspace IDs', async () => {
    const store = new Store(':memory:');
    const original = store.workspace();
    store.db.exec('DELETE FROM workspaces');
    store.saveWorkspace({ ...original, id: '旧画布／自定义 ID' });
    const app = createApp(store, new DemoProvider());
    try {
      const catalog = (await app.inject('/api/canvases')).json();
      expect(catalog.primary_id).toMatch(/^[a-f0-9-]{36}$/);
      const state = await app.inject({
        url: '/api/state',
        headers: { 'x-canvas-id': catalog.primary_id },
      });
      expect(state.statusCode).toBe(200);
      expect(state.json().workspace.id).toBe('旧画布／自定义 ID');
    } finally {
      await app.close();
      store.close();
    }
  });
  it('keeps local tasks, approval, images, pinned traces and exports scoped to their owning canvas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-local-'));
    const project = join(dir, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'proof.txt'), 'Evidence');
    const local = new LocalExecutor(join(dir, 'runtime'), undefined, undefined, [], {
      desktop: new TestDesktopDriver(),
    });
    await local.initialize();
    await local.configure(true, project);
    await local.configureDesktop(true, '123');
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider(), { local });
    const post = (url: string, payload: object, canvas: string) =>
      app.inject({ method: 'POST', url, payload, headers: { 'x-canvas-id': canvas } });
    try {
      const a = (await app.inject('/api/canvases')).json().primary_id;
      const b = (await post('/api/canvases', { name: 'Other tasks' }, a)).json().id;
      const captured = await post(
        '/api/local/actions',
        { tool: 'canvas_desktop', arguments: { operation: 'capture' } },
        a,
      );
      expect(captured.statusCode).toBe(200);
      const captureId = captured.json().id;
      await vi.waitFor(
        async () => expect((await local.readTask(captureId)).status).toBe('waiting'),
        { timeout: 3000 },
      );
      const captureApproval = (await local.readTask(captureId)).actions.find(
        (action) => action.status === 'waiting',
      )!;
      expect(
        (
          await post(
            '/api/local/tasks/' + captureId + '/approve',
            { action_id: captureApproval.id, approved: true },
            a,
          )
        ).statusCode,
      ).toBe(200);
      await vi.waitFor(
        async () => expect((await local.readTask(captureId)).status).toBe('complete'),
        { timeout: 5000 },
      );
      const capture = await local.readTask(captureId);
      const image = capture.actions[0].images![0];
      const pending = (
        await post(
          '/api/local/actions',
          { tool: 'canvas_write_file', arguments: { path: 'draft.txt', content: 'A only' } },
          a,
        )
      ).json();
      await vi.waitFor(
        async () => expect((await local.readTask(pending.id)).status).toBe('waiting'),
        { timeout: 5000 },
      );
      const status = (
        await app.inject({ url: '/api/local/status', headers: { 'x-canvas-id': b } })
      ).json();
      expect(status).toMatchObject({ waiting: 0, other_canvas_busy: true });
      expect(
        (await app.inject({ url: '/api/local', headers: { 'x-canvas-id': b } })).json().tasks,
      ).toEqual([]);
      const pendingAction = (await local.readTask(pending.id)).actions.find(
        (action) => action.status === 'waiting',
      )!;
      expect(
        (
          await post(
            '/api/local/tasks/' + pending.id + '/approve',
            { action_id: pendingAction.id, approved: true },
            b,
          )
        ).statusCode,
      ).toBe(404);
      expect((await post('/api/local/tasks/' + pending.id + '/cancel', {}, b)).statusCode).toBe(
        404,
      );
      expect((await post('/api/local/tasks/' + pending.id + '/cancel', {}, a)).statusCode).toBe(
        200,
      );
      await vi.waitFor(() => expect(local.busy).toBe(false), { timeout: 5000 });
      expect(existsSync(join(project, 'draft.txt'))).toBe(false);
      const taskB = (
        await post(
          '/api/local/actions',
          { tool: 'canvas_read_file', arguments: { path: 'proof.txt' } },
          b,
        )
      ).json();
      await vi.waitFor(
        async () => expect((await local.readTask(taskB.id)).status).toBe('complete'),
        { timeout: 5000 },
      );
      expect(
        (await post('/api/local/canvas', { task_id: captureId, pinned: true }, a)).statusCode,
      ).toBe(200);
      expect(
        (await post('/api/local/canvas', { task_id: captureId, pinned: true }, b)).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ url: '/api/local/canvas', headers: { 'x-canvas-id': b } })).json()
          .traces,
      ).toEqual([]);
      expect(
        (
          await app.inject({
            url: `/api/local/tasks/${captureId}/images/${image.sha256}?canvas=${b}`,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            url: `/api/local/tasks/${captureId}/images/${image.sha256}?canvas=${a}`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: `/api/local/tasks/${captureId}/export?canvas=${b}` })).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ url: `/api/local/tasks/${captureId}/export?canvas=${a}` })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: '/api/local', headers: { 'x-canvas-id': b } }))
          .json()
          .tasks.map((task: { id: string }) => task.id),
      ).toEqual([taskB.id]);
    } finally {
      await local.close();
      await app.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('keeps frozen inputs and cancellation separate even after importing identical canonical IDs into two canvases', async () => {
    const store = new Store(':memory:');
    const calls: { signal: AbortSignal; finish: () => void }[] = [];
    const watchers: (() => void)[] = [];
    const provider: ModelProvider = {
      name: 'test',
      model: 'test-model',
      generate: async (_pkg, _draft, signal) =>
        new Promise((resolve, reject) => {
          calls.push({
            signal: signal!,
            finish: () =>
              resolve({ answer: 'B finished', used_source_ids: [], suggested_graph_updates: [] }),
          });
          signal!.addEventListener('abort', () => reject(new Error('Stopped')), { once: true });
          watchers.splice(0).forEach((notify) => notify());
        }),
    };
    const app = createApp(store, provider);
    const post = (url: string, payload: object, canvas?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload,
        headers: canvas ? { 'x-canvas-id': canvas } : {},
      });
    const waitCalls = async (count: number) => {
      while (calls.length < count) await new Promise<void>((resolve) => watchers.push(resolve));
    };
    try {
      const a = (await app.inject('/api/canvases')).json().primary_id;
      const conversation = store.createConversation('A original');
      const compiled = (
        await post(
          '/api/compile',
          {
            conversation_id: conversation.conversation.id,
            prompt: 'Keep the original context',
            selected_node_ids: [],
          },
          a,
        )
      ).json();
      const started = store.beginAnswer(compiled.context_set.id, 'test', 'test-model');
      store.failAnswer(started.turn.id, 'Retry this turn');
      const original = exportProject(store);
      const b = (await post('/api/canvases', { name: 'B clone' })).json().id;
      const preview = (await post('/api/project/validate', { project: original }, b)).json();
      expect(
        (
          await post(
            '/api/project/import',
            {
              project: original,
              confirm_replace: true,
              expected: {
                workspace_id: preview.current.workspace_id,
                revision: preview.current.revision,
                snapshot_hash: preview.current.snapshot_hash,
              },
            },
            b,
          )
        ).statusCode,
      ).toBe(200);
      const first = post('/api/retry', { turn_id: started.turn.id }, a);
      void first.then(() => {});
      await waitCalls(1);
      expect(
        (await app.inject('/api/canvases'))
          .json()
          .canvases.find((entry: { id: string }) => entry.id === a).busy,
      ).toBe(true);
      const second = post('/api/retry', { turn_id: started.turn.id }, b);
      void second.then(() => {});
      await waitCalls(2);
      expect((await post('/api/answers/' + started.turn.id + '/cancel', {}, a)).statusCode).toBe(
        200,
      );
      expect(calls[0].signal.aborted).toBe(true);
      expect(calls[1].signal.aborted).toBe(false);
      calls[1].finish();
      await Promise.all([first, second]);
      const stateA = (
        await app.inject({ url: '/api/state', headers: { 'x-canvas-id': a } })
      ).json();
      const stateB = (
        await app.inject({ url: '/api/state', headers: { 'x-canvas-id': b } })
      ).json();
      expect(stateA.turns.find((turn: { id: string }) => turn.id === started.turn.id).status).toBe(
        'error',
      );
      expect(stateB.turns.find((turn: { id: string }) => turn.id === started.turn.id).status).toBe(
        'complete',
      );
      expect(stateA.packages).toEqual(stateB.packages);
      expect(stateA.packages[0]).toEqual(original.snapshot.packages[0]);
    } finally {
      calls.forEach((entry) => entry.finish());
      await app.close();
      store.close();
    }
  });

  it('copies only selected text across canvases, preserves original UTF-16/hash provenance, and never changes the source graph', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider());
    const post = (url: string, payload: object, canvas?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload,
        headers: canvas ? { 'x-canvas-id': canvas } : {},
      });
    try {
      const a = (await app.inject('/api/canvases')).json().primary_id;
      const root = store.createConversation('Research');
      const text = 'private prefix. Pick 🌱 evidence only. private suffix.';
      const turn = store.appendTurn(root.conversation.id, 'human', text);
      const block = store.snapshot().blocks.find((b) => b.turn_id === turn.id)!;
      const before = store.snapshot();
      const b = (await post('/api/canvases', { name: 'B' })).json().id;
      const exact = '🌱 evidence';
      const start = text.indexOf(exact);
      const input = {
        request_id: crypto.randomUUID(),
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
      };
      const response = await post('/api/canvases/' + b + '/references', input, a);
      expect(response.statusCode).toBe(200);
      const imported = response.json();
      expect(imported.excerpt.external_origin).toMatchObject({
        canvas_id: a,
        workspace_id: before.workspace.id,
        source_block_id: block.id,
        source_content_hash: block.content_hash,
        selector: input.selector,
      });
      expect((await post('/api/canvases/' + b + '/references', input, a)).json().node.id).toBe(
        imported.node.id,
      );
      expect(store.snapshot()).toEqual(before);
      const branch = (await post('/api/branches', { excerpt_id: imported.excerpt.id }, b)).json();
      const compiled = (
        await post(
          '/api/compile',
          {
            conversation_id: branch.conversation.id,
            prompt: 'Use the picked evidence',
            selected_node_ids: [],
          },
          b,
        )
      ).json();
      expect(compiled.package.items.map((item: { content: string }) => item.content)).toEqual([
        exact,
      ]);
      expect(JSON.stringify(compiled.package)).not.toContain('private');
      expect(compiled.package.items[0].actor).toBe('tool');
      const tooSmall = (
        await post(
          '/api/compile',
          {
            conversation_id: branch.conversation.id,
            prompt: 'Use the reference',
            selected_node_ids: [],
            budget: { ...DEFAULT_BUDGET, target_context_tokens: 4 },
          },
          b,
        )
      ).json();
      expect(tooSmall.package.sendable).toBe(false);
      const exported = (
        await app.inject({ url: '/api/project/export', headers: { 'x-canvas-id': b } })
      ).json();
      expect(validateProject(exported).project.snapshot.excerpts[0].external_origin).toEqual(
        imported.excerpt.external_origin,
      );
      const c = (await post('/api/canvases', { name: 'C' })).json().id;
      const copyBlock = exported.snapshot.blocks[0];
      const sub = {
        request_id: crypto.randomUUID(),
        source_block_id: copyBlock.id,
        source_content_hash: copyBlock.content_hash,
        selector: { type: 'text_range', start_char: 0, end_char: 2, exact: '🌱' },
      };
      const final = (await post('/api/canvases/' + c + '/references', sub, b)).json();
      expect(final.excerpt.external_origin.canvas_id).toBe(a);
      expect(final.excerpt.external_origin.selector).toMatchObject({
        start_char: start,
        end_char: start + 2,
        exact: '🌱',
      });
      expect(
        (
          await post(
            '/api/canvases/' + c + '/references',
            {
              ...input,
              request_id: crypto.randomUUID(),
              source_content_hash: 'sha256:' + '0'.repeat(64),
            },
            a,
          )
        ).statusCode,
      ).toBe(409);
      expect(store.snapshot()).toEqual(before);
    } finally {
      await app.close();
      store.close();
    }
  });

  it('preserves each canvas and recovery history across restart; restoring one never replaces another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-registry-'));
    const path = join(dir, 'original.sqlite');
    let store = new Store(path);
    let app = createApp(store, new DemoProvider());
    try {
      const a = (await app.inject('/api/canvases')).json().primary_id;
      const b = (
        await app.inject({
          method: 'POST',
          url: '/api/canvases',
          payload: { name: 'Other project', request_id: crypto.randomUUID() },
        })
      ).json().id;
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { title: 'B kept' },
        headers: { 'x-canvas-id': b },
      });
      store.createConversation('A kept');
      const originalA = store.snapshot();
      const beforeB = (
        await app.inject({ url: '/api/state', headers: { 'x-canvas-id': b } })
      ).json();
      const backup = (
        await app.inject({ url: '/api/project/export', headers: { 'x-canvas-id': b } })
      ).json();
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { title: 'B later' },
        headers: { 'x-canvas-id': b },
      });
      const preview = (
        await app.inject({
          method: 'POST',
          url: '/api/project/validate',
          payload: { project: backup },
          headers: { 'x-canvas-id': b },
        })
      ).json();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/project/import',
            payload: {
              project: backup,
              confirm_replace: true,
              expected: {
                workspace_id: preview.current.workspace_id,
                revision: preview.current.revision,
                snapshot_hash: preview.current.snapshot_hash,
              },
            },
            headers: { 'x-canvas-id': b },
          })
        ).statusCode,
      ).toBe(200);
      expect(store.snapshot()).toEqual(originalA);
      await app.close();
      store.close();
      store = new Store(path);
      app = createApp(store, new DemoProvider());
      expect(
        (await app.inject('/api/canvases'))
          .json()
          .canvases.map((entry: { id: string }) => entry.id),
      ).toEqual([a, b]);
      const afterB = (
        await app.inject({ url: '/api/state', headers: { 'x-canvas-id': b } })
      ).json();
      expect(afterB.conversations).toEqual(beforeB.conversations);
      expect(store.snapshot()).toEqual(originalA);
      expect(
        (await app.inject({ url: '/api/project/recovery', headers: { 'x-canvas-id': b } })).json(),
      ).toHaveLength(1);
      expect((await app.inject('/api/project/recovery')).json()).toHaveLength(0);
    } finally {
      await app.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never creates an empty replacement for a missing canvas file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-missing-'));
    const path = join(dir, 'original.sqlite');
    const store = new Store(path);
    const registry = new CanvasRegistry(store);
    try {
      const entry = registry.create('Keep this data');
      registry.get(entry.id).createConversation('Preserved');
      registry.close();
      const file = join(path + '.canvases', entry.id + '.sqlite');
      renameSync(file, file + '.saved');
      expect(() => registry.recoverInterrupted()).not.toThrow();
      expect(() => registry.get(entry.id)).toThrow('数据文件不可用');
      expect(existsSync(file)).toBe(false);
      expect(registry.list().find((canvas) => canvas.id === entry.id)?.unavailable).toBe(true);
    } finally {
      registry.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('creates, renames and reads canvases without mixing nodes, pins or source IDs', async () => {
    const root = new Store(':memory:');
    const app = createApp(root, new DemoProvider());
    const send = (
      url: string,
      payload: object,
      canvas?: string,
      method: 'POST' | 'PATCH' = 'POST',
    ) => app.inject({ method, url, payload, headers: canvas ? { 'x-canvas-id': canvas } : {} });
    try {
      const first = (await app.inject('/api/canvases')).json().primary_id;
      const second = (await send('/api/canvases', { name: '第二个项目' })).json().id;
      const a = (await send('/api/conversations', { title: 'A only' }, first)).json();
      const b = (await send('/api/conversations', { title: 'B only' }, second)).json();
      const state = (canvas: string) =>
        app.inject({ url: '/api/state', headers: { 'x-canvas-id': canvas } });
      expect(
        (await state(first)).json().conversations.map((c: { title: string }) => c.title),
      ).toEqual(['A only']);
      expect(
        (await state(second)).json().conversations.map((c: { title: string }) => c.title),
      ).toEqual(['B only']);
      expect(
        (await send('/api/context-control', { node_id: a.node.id, action: 'pin' }, second))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await send(
            '/api/forks',
            {
              conversation_id: a.conversation.id,
              branches: [{ request_id: crypto.randomUUID(), mode: 'fork', prompt: 'foreign' }],
            },
            second,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await send('/api/canvases/' + second, { name: '改名后的画布' }, first, 'PATCH'))
          .statusCode,
      ).toBe(200);
      expect((await state(second)).json().workspace.name).toBe('改名后的画布');
      expect((await state(first)).json().nodes[0].id).toBe(a.node.id);
      expect((await state(second)).json().nodes[0].id).toBe(b.node.id);
      expect((await state('../outside')).statusCode).toBe(404);
    } finally {
      await app.close();
      root.close();
    }
  });
});
