import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  rm,
  symlink,
  realpath,
} from 'node:fs/promises';
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
async function fixture(enabled = true) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'canvas-auto-tools-')));
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
  if (enabled) await local.configure(true, project);
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
  expect((start.dynamicTools as unknown[]).length).toBe(8);
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

it('attaches bootstrap tools before project enablement and continues the same answer after a single task grant', async () => {
  const { send, app, local, project, rpc } = await fixture(false);
  const { response } = await send('授權專案:' + project + '\n命令測試');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  const action = task.actions[0];
  expect(action.tool).toBe('canvas_connect_project');
  expect(local.status().enabled).toBe(false);
  expect(task.actions).toHaveLength(1);
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
  const turn = rpc.calls.find((call) => call.method === 'turn/start')!.params;
  expect(JSON.parse((turn.input as { text: string }[])[0].text).execution.project_enabled).toBe(
    false,
  );
  const other = (
    await app.inject({
      method: 'POST',
      url: '/api/canvases',
      payload: { name: '不可授權其他畫布' },
    })
  ).json();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/local/tasks/${task.id}/approve`,
        headers: { 'x-canvas-id': other.id },
        payload: { action_id: action.id, approved: true, project_access: 'task' },
      })
    ).statusCode,
  ).toBe(404);
  expect(local.status().enabled).toBe(false);
  const decision = await app.inject({
    method: 'POST',
    url: `/api/local/tasks/${task.id}/approve`,
    payload: { action_id: action.id, approved: true, project_access: 'task' },
  });
  expect(decision.statusCode).toBe(200);
  expect((await response).body).toContain('"type":"complete"');
  expect(local.snapshot()).toMatchObject({ enabled: true, root: project, busy: false });
  expect(await readFile(join(project, 'result.txt'), 'utf8')).toBe('Verified canvas tool write.\n');
  expect(
    task.actions
      .filter(
        (action) => action.tool === 'canvas_write_file' || action.tool === 'canvas_run_command',
      )
      .map((entry) => entry.authorized_by),
  ).toEqual([action.id, action.id]);
  expect(task.actions.at(-1)?.output).toContain('12345');
  // A later answer gets no inherited automatic write permission.
  const next = await send('确认写入');
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const pending = local.snapshot().tasks[0];
  expect(pending.actions.at(-1)?.tool).toBe('canvas_write_file');
  await local.approve(pending.id, pending.actions.at(-1)!.id, false);
  await next.response;
}, 15000);

it('persists an approved project across restart while review mode still prompts before writing', async () => {
  const { send, local, project, runtime } = await fixture(false);
  const { response } = await send('授權專案:' + project);
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  const task = local.snapshot().tasks[0];
  await local.approve(task.id, task.actions[0].id, true, 'review');
  await vi.waitFor(() => expect(task.actions.at(-1)?.tool).toBe('canvas_write_file'));
  expect(task.actions.at(-1)?.status).toBe('waiting');
  expect(task.actions.at(-1)?.authorized_by).toBeUndefined();
  await expect(access(join(project, 'result.txt'))).rejects.toThrow();
  await local.approve(task.id, task.actions.at(-1)!.id, false);
  await response;
  await local.close();
  const restored = new LocalExecutor(runtime);
  await restored.initialize();
  cleanup.push(() => restored.close());
  expect(restored.snapshot()).toMatchObject({ enabled: true, root: project, busy: false });
  const next = await restored.manual('canvas_write_file', { path: 'restart.txt', content: 'wait' });
  await vi.waitFor(() => expect(restored.status().waiting).toBe(1));
  await expect(access(join(project, 'restart.txt'))).rejects.toThrow();
  await restored.approve(next.id, next.actions[0].id, false);
  await vi.waitFor(() => expect(restored.busy).toBe(false));
});

it('does not create a project through a symlink into protected runtime data', async () => {
  const { local, home, runtime } = await fixture(false);
  const link = join(home, 'runtime-link');
  await symlink(runtime, link, process.platform === 'win32' ? 'junction' : 'dir');
  const task = await local.manual('canvas_connect_project', {
    root: join(link, 'must-not-create'),
    create_if_missing: true,
  });
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await local.approve(task.id, task.actions[0].id, true, 'task');
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(task.actions[0].success).toBe(false);
  expect(local.status().enabled).toBe(false);
  await expect(access(join(runtime, 'must-not-create'))).rejects.toThrow();
});

it('protects runtime and future login locations when their configured parent is an alias', async () => {
  const { home } = await fixture(false);
  const alias = join(home, 'home-link');
  await symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const executor = new LocalExecutor(join(alias, 'protected-runtime'), undefined, undefined, [
    join(alias, 'future-login'),
  ]);
  await executor.initialize();
  cleanup.push(() => executor.close());
  await expect(executor.configure(true, join(home, 'protected-runtime'))).rejects.toMatchObject({
    code: 'local_root_invalid',
  });
  const creation = await executor.manual('canvas_connect_project', {
    root: join(home, 'future-login', 'nested'),
    create_if_missing: true,
  });
  await vi.waitFor(() => expect(executor.busy).toBe(false));
  expect(creation.actions[0].success).toBe(false);
  await expect(access(join(home, 'future-login'))).rejects.toThrow();
  await executor.configure(true, home);
  const reading = await executor.manual('canvas_list_files', { path: 'protected-runtime' });
  await vi.waitFor(() => expect(executor.busy).toBe(false));
  expect(reading.actions[0].success).toBe(false);
});

it('recognizes a project alias as the same root when requesting authorization after an existing read', async () => {
  const { local, project, home } = await fixture();
  const alias = join(home, 'project-link');
  await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const task = await local.manual('canvas_read_file', { path: 'spec.txt' });
  await vi.waitFor(() => expect(local.busy).toBe(false));
  await local.manual('canvas_connect_project', { root: alias }, task.id);
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await local.approve(task.id, task.actions.at(-1)!.id, true, 'review');
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(task.actions.at(-1)?.success).toBe(true);
  expect(task.project_root).toBe(project);
});

it('does not enable or create a directory when bootstrap authorization is rejected or the answer is stopped', async () => {
  const { send, app, local, home } = await fixture(false);
  for (const cancel of [false, true]) {
    const root = join(home, cancel ? 'cancelled-project' : 'rejected-project');
    const { response } = await send('授權專案:' + root + '\n建立目錄');
    await vi.waitFor(() => expect(local.status().waiting).toBe(1));
    const task = local.snapshot().tasks[0];
    if (cancel)
      await app.inject({
        method: 'POST',
        url: `/api/answers/${task.conversation_turn_id}/cancel`,
        payload: {},
      });
    else await local.approve(task.id, task.actions[0].id, false, 'task');
    await response;
    expect(local.status().enabled).toBe(false);
    await expect(access(root)).rejects.toThrow();
  }
});

it('creates a requested project only after approval and keeps root permission separate from GitHub authentication', async () => {
  const { local, home } = await fixture(false);
  const root = join(home, 'new', 'source');
  const task = await local.manual('canvas_connect_project', { root, create_if_missing: true });
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await expect(access(root)).rejects.toThrow();
  await local.approve(task.id, task.actions[0].id, true, 'task');
  await vi.waitFor(() => expect(local.busy).toBe(false));
  await access(root);
  expect(task.actions[0].output).toContain('GitHub');
  // An archived manual task cannot carry automatic permission into continuation.
  const continued = await local.manual(
    'canvas_write_file',
    { path: 'later.txt', content: 'review required' },
    task.id,
  );
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await expect(access(join(root, 'later.txt'))).rejects.toThrow();
  await local.approve(continued.id, continued.actions.at(-1)!.id, false);
  await vi.waitFor(() => expect(local.busy).toBe(false));
});

it('rejects protected roots and a rejected project switch cannot fall back to the previous project', async () => {
  const { local, project, runtime, home } = await fixture();
  const bad = await local.manual('canvas_connect_project', { root: runtime });
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(bad.actions[0].status).toBe('failed');
  expect(local.snapshot().root).toBe(project);
  const other = join(home, 'other');
  await mkdir(other);
  const task = await local.manual('canvas_connect_project', { root: other });
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await local.approve(task.id, task.actions[0].id, false);
  await vi.waitFor(() => expect(local.busy).toBe(false));
  const next = await local.manual(
    'canvas_write_file',
    { path: 'wrong-root.txt', content: 'must not write' },
    task.id,
  );
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(next.actions.at(-1)?.success).toBe(false);
  await expect(access(join(project, 'wrong-root.txt'))).rejects.toThrow();
});

it('publishes command output while the process is still running and supports nonsecret prompt input', async () => {
  const { local } = await fixture();
  const command =
    "node -e \"process.stdin.once('data',()=>{console.log('device authentication ready');setTimeout(()=>{},2200)})\"";
  const task = await local.manual('canvas_run_command', {
    command,
    timeout_seconds: 15,
    stdin: '\n',
  });
  await vi.waitFor(() => expect(local.status().waiting).toBe(1));
  await local.approve(task.id, task.actions[0].id, true);
  await vi.waitFor(() => expect(task.actions[0].output).toContain('device authentication ready'), {
    timeout: 5000,
  });
  expect(task.actions[0].status).toBe('running');
  await vi.waitFor(() => expect(local.busy).toBe(false), { timeout: 5000 });
  expect(task.actions[0].success).toBe(true);
}, 15000);
