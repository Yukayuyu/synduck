import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '@acc/db';
import { createApp } from '../apps/api/src/app';
import { CanvasRegistry } from '../apps/api/src/canvases';
import { LocalExecutor } from '../packages/local-runtime/src/executor';
import { CodexProvider } from '../packages/model-gateway/src/codex';
import { CodexRpc } from '../packages/model-gateway/src/codex-rpc';
import { ConversationCodex } from './helpers/conversation-codex';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'canvas-auto-tools-'));
  const project = join(home, 'project');
  await mkdir(project);
  await writeFile(join(project, 'spec.txt'), 'Original project evidence.');
  const runtime = join(home, 'runtime');
  const local = new LocalExecutor(runtime, () => ({
    model: 'test-model',
    effort: 'high',
    connected: async () => true,
  }));
  await local.initialize();
  await local.configure(true, project);
  const store = new Store(join(home, 'canvas.sqlite'));
  const rpc = new ConversationCodex();
  const provider = new CodexProvider(rpc, 'test-model', 'high');
  const canvases = new CanvasRegistry(store);
  const app = createApp(store, provider, { local, canvases });
  await app.ready();
  cleanup.push(async () => {
    await local.close();
    await provider.close();
    await app.close();
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const send = async (prompt: string, canvasId?: string) => {
    const headers = canvasId ? { 'x-canvas-id': canvasId } : {};
    const root = (
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        headers,
        payload: { title: prompt },
      })
    ).json();
    const response = app
      .inject({
        method: 'POST',
        url: '/api/send',
        headers,
        payload: {
          conversation_id: root.conversation.id,
          request_id: crypto.randomUUID(),
          prompt,
          selected_node_ids: [],
        },
      })
      .then((r) => r);
    return { root, response };
  };
  return { home, project, runtime, local, store, rpc, app, send, canvases };
}
it('automatically reads from a normal send, validates the answer and retains tool provenance across restart', async () => {
  const { send, app, rpc, local, store, runtime } = await fixture();
  const { root, response } = await send('读取项目并解释');
  const result = await response;
  expect(result.body).toContain('"type":"complete"');
  const turn = store
    .snapshot()
    .turns.find(
      (turn) => turn.conversation_id === root.conversation.id && turn.actor === 'assistant',
    )!;
  expect(turn.status).toBe('complete');
  const tasks = (await app.inject({ url: '/api/local/turns/' + turn.id })).json().tasks;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({
    conversation_turn_id: turn.id,
    context_package_id: store.snapshot().packages[0].package_id,
    status: 'complete',
    reasoning_effort: 'high',
  });
  expect(JSON.parse(tasks[0].actions[0].output).content).toBe('Original project evidence.');
  expect(tasks[0].actions[0].model_output).toContain(tasks[0].actions[0].id);
  const start = rpc.calls.find((call) => call.method === 'thread/start')!.params;
  expect((start.dynamicTools as unknown[]).length).toBe(7);
  expect(start.baseInstructions).not.toContain('has no filesystem');
  expect(rpc.calls.find((call) => call.method === 'turn/start')!.params.effort).toBe('high');
  expect(rpc.handlers.size).toBe(0);
  expect(local.busy).toBe(false);
  await local.close();
  const restored = new LocalExecutor(runtime);
  await restored.initialize();
  cleanup.push(() => restored.close());
  expect(await restored.tasksForTurn(turn.id)).toEqual(tasks);
});
it('waits for exact write approval inside the answer while another text conversation completes', async () => {
  const { send, app, local, project, store } = await fixture();
  const writing = await send('读取项目并确认写入');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
  const pure = await send('只讨论一个想法');
  expect((await pure.response).body).toContain('"type":"complete"');
  expect(local.snapshot().tasks).toHaveLength(1);
  const competing = await send('读取项目，另一个分支');
  expect((await competing.response).body).toContain('"type":"complete"');
  expect(local.snapshot().tasks).toHaveLength(1);
  const action = task.actions.find((action) => action.status === 'waiting')!;
  expect(action.arguments).toEqual({
    path: 'result.txt',
    content: 'Verified canvas tool write.\n',
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/local/tasks/${task.id}/approve`,
        payload: { action_id: action.id, approved: true },
      })
    ).statusCode,
  ).toBe(200);
  expect((await writing.response).body).toContain('"type":"complete"');
  expect(await readFile(join(project, 'result.txt'), 'utf8')).toBe('Verified canvas tool write.\n');
  expect(
    store
      .snapshot()
      .turns.filter((turn) => turn.actor === 'assistant')
      .every((turn) => turn.input_context_set_id),
  ).toBe(true);
});
it('rejects writes without modifying the file and isolates task traces from another canvas', async () => {
  const { send, app, local, project } = await fixture();
  const { response } = await send('确认写入，但需要先确认');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  const action = task.actions.find((action) => action.status === 'waiting')!;
  const other = (
    await app.inject({ method: 'POST', url: '/api/canvases', payload: { name: '另一个画布' } })
  ).json();
  const headers = { 'x-canvas-id': other.id };
  expect(
    (await app.inject({ url: '/api/local/turns/' + task.conversation_turn_id, headers }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/local/tasks/${task.id}/approve`,
        headers,
        payload: { action_id: action.id, approved: true },
      })
    ).statusCode,
  ).toBe(404);
  await app.inject({
    method: 'POST',
    url: `/api/local/tasks/${task.id}/approve`,
    payload: { action_id: action.id, approved: false },
  });
  expect((await response).body).toContain('"type":"complete"');
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
  expect(task.actions.at(-1)?.status).toBe('rejected');
});
it('stops pending operations with the answer and prevents replay of side effects on retry', async () => {
  const { send, app, local, project, rpc } = await fixture();
  const { response } = await send('确认写入');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  await app.inject({
    method: 'POST',
    url: `/api/answers/${task.conversation_turn_id}/cancel`,
    payload: {},
  });
  expect((await response).body).toContain('generation_cancelled');
  expect(local.busy).toBe(false);
  expect(task.status).toBe('cancelled');
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
  const calls = rpc.calls.filter((call) => call.method === 'turn/start').length;
  const retry = await app.inject({
    method: 'POST',
    url: '/api/retry',
    payload: { turn_id: task.conversation_turn_id },
  });
  expect(retry.json().error).toBe('tool_retry_requires_new_message');
  expect(rpc.calls.filter((call) => call.method === 'turn/start')).toHaveLength(calls);
});
it('routes shared RPC tool calls only to the registered thread and removes routes after completion', async () => {
  const replies: { id: number; result?: unknown; error?: unknown }[] = [];
  const rpc = new CodexRpc('unused');
  Reflect.set(rpc, 'child', {
    stdin: { destroyed: false, write: (value: string) => replies.push(JSON.parse(value)) },
  });
  const remove = rpc.registerTools('thread-a', async () => ({ thread: 'a' }));
  rpc.registerTools('thread-b', async () => ({ thread: 'b' }));
  const receive = Reflect.get(rpc, 'receive') as (message: object) => void;
  receive.call(rpc, { id: 1, method: 'item/tool/call', params: { threadId: 'thread-a' } });
  receive.call(rpc, { id: 2, method: 'item/tool/call', params: { threadId: 'thread-b' } });
  receive.call(rpc, { id: 3, method: 'item/tool/call', params: { threadId: 'unknown' } });
  await vi.waitFor(() => expect(replies).toHaveLength(3));
  expect(replies.find((reply) => reply.id === 1)?.result).toEqual({ thread: 'a' });
  expect(replies.find((reply) => reply.id === 2)?.result).toEqual({ thread: 'b' });
  expect(replies.find((reply) => reply.id === 3)?.error).toBeTruthy();
  remove();
  receive.call(rpc, { id: 4, method: 'item/tool/call', params: { threadId: 'thread-a' } });
  expect(replies.at(-1)?.error).toBeTruthy();
  Reflect.set(rpc, 'child', null);
  await rpc.close();
});

it('keeps secondary-canvas ownership when the shared model callback arrives in the primary async scope', async () => {
  const { app, send, rpc, canvases, local } = await fixture();
  rpc.hostScope = (work) => canvases.run(canvases.primaryId, work);
  const other = (
    await app.inject({ method: 'POST', url: '/api/canvases', payload: { name: '工具所属画布' } })
  ).json();
  const { response } = await send('读取项目', other.id);
  expect((await response).body).toContain('"type":"complete"');
  const task = local.snapshot().tasks[0];
  expect(canvases.taskOwner(task.id)).toBe(other.id);
  expect((await app.inject({ url: '/api/local' })).json().tasks).toHaveLength(0);
  const headers = { 'x-canvas-id': other.id };
  expect(
    (await app.inject({ url: '/api/local/turns/' + task.conversation_turn_id, headers })).json()
      .tasks,
  ).toHaveLength(1);
});

it('withdraws pending approval immediately when the model fails without executing a write', async () => {
  const { app, send, rpc, local, project } = await fixture();
  const { response } = await send('确认写入');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  const action = task.actions.find((action) => action.status === 'waiting')!;
  const threadId = rpc.calls.find((call) => call.method === 'turn/start')!.params.threadId;
  rpc.emit('error', { threadId, error: { message: 'Model unavailable' }, willRetry: false });
  expect((await response).body).toContain('"type":"error"');
  expect(local.busy).toBe(false);
  expect(task.status).toBe('failed');
  expect(action.status).toBe('rejected');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/local/tasks/${task.id}/approve`,
        payload: { action_id: action.id, approved: true },
      })
    ).statusCode,
  ).toBe(409);
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
});
