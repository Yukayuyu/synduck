import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalExecutor, type LocalTask } from '../packages/local-runtime/src/executor';
import type {
  CodexConnection,
  HostToolHandler,
  RpcEvent,
} from '../packages/model-gateway/src/codex-rpc';
import { CodexRpc } from '../packages/model-gateway/src/codex-rpc';
import { Store } from '@acc/db';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const wait = async (condition: () => boolean, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};
async function fixture(factory?: (handler: HostToolHandler) => CodexConnection) {
  const home = await mkdtemp(join(tmpdir(), 'canvas-local-test-'));
  const project = join(home, 'project'),
    history = join(home, 'history');
  await mkdir(project);
  await writeFile(join(project, 'README.md'), 'Project requirements\n');
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const executor = new LocalExecutor(
    history,
    () => ({ model: 'test-model', effort: 'high', connected: async () => true }),
    factory,
  );
  await executor.initialize();
  await executor.configure(true, project);
  cleanup.push(() => executor.close());
  return { home, project, history, executor };
}
async function finished(executor: LocalExecutor, task: LocalTask, timeout = 5000) {
  await wait(() => !executor.busy, timeout);
  return executor.task(task.id);
}
async function waiting(executor: LocalExecutor, task: LocalTask) {
  await wait(() => task.actions.some((action) => action.status === 'waiting'));
  return executor.task(task.id).actions.find((action) => action.status === 'waiting')!;
}

describe('local project executor', () => {
  it('RPC grants only the explicit dynamic-tool handler while other host requests remain rejected', async () => {
    const replies: { id: number; result?: unknown; error?: { code: number } }[] = [];
    const rpc = new CodexRpc('unused-test-home', async () => ({
      success: true,
      contentItems: [{ type: 'inputText', text: 'Approved dynamic tool' }],
    }));
    Reflect.set(rpc, 'child', {
      stdin: { destroyed: false, write: (text: string) => replies.push(JSON.parse(text)) },
    });
    const receive = Reflect.get(rpc, 'receive') as (message: object) => void;
    receive.call(rpc, { id: 1, method: 'item/tool/call', params: { tool: 'expected' } });
    receive.call(rpc, { id: 2, method: 'item/commandExecution/requestApproval', params: {} });
    await wait(() => replies.length === 2);
    expect(replies.find((reply) => reply.id === 1)?.result).toMatchObject({ success: true });
    expect(replies.find((reply) => reply.id === 2)?.error?.code).toBe(-32601);
    Reflect.set(rpc, 'child', null);
    await rpc.close();
  });
  it('reads a real project file and retains its outcome across restart', async () => {
    const { executor, history } = await fixture();
    const task = await executor.manual('canvas_read_file', { path: 'README.md' });
    const result = await finished(executor, task);
    expect(JSON.parse(result.actions[0].output)).toMatchObject({
      content: 'Project requirements\n',
      truncated: false,
    });
    expect(result.status).toBe('complete');
    const restarted = new LocalExecutor(history);
    await restarted.initialize();
    cleanup.push(() => restarted.close());
    expect(restarted.task(task.id)).toEqual(result);
    expect(restarted.snapshot().enabled).toBe(true);
  });
  it('rejects traversal, credential files and directory symlinks', async () => {
    const { executor, project, home } = await fixture();
    await writeFile(join(project, '.env'), 'secret-value');
    const outside = join(home, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.txt'), 'private');
    await symlink(
      outside,
      join(project, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    for (const path of ['../outside/private.txt', '.env', 'linked/private.txt']) {
      const result = await finished(executor, await executor.manual('canvas_read_file', { path }));
      expect(result.actions[0].success).toBe(false);
      expect(result.actions[0].output).not.toMatch(/secret-value|^private$/);
    }
  });
  it('does not write until exact content is approved and rejects stale approvals', async () => {
    const { executor, project } = await fixture();
    const task = await executor.manual('canvas_write_file', {
      path: 'README.md',
      content: 'Approved replacement',
    });
    const action = await waiting(executor, task);
    expect(await readFile(join(project, 'README.md'), 'utf8')).toBe('Project requirements\n');
    expect(action.before).toBe('Project requirements\n');
    await executor.approve(task.id, action.id, true);
    await finished(executor, task);
    expect(await readFile(join(project, 'README.md'), 'utf8')).toBe('Approved replacement');
    await expect(executor.approve(task.id, action.id, true)).rejects.toMatchObject({
      code: 'local_approval_expired',
    });
  });
  it('does not overwrite a file changed while approval is pending', async () => {
    const { executor, project } = await fixture();
    const task = await executor.manual('canvas_write_file', {
      path: 'README.md',
      content: 'Proposed',
    });
    const action = await waiting(executor, task);
    await writeFile(join(project, 'README.md'), 'External edit');
    await executor.approve(task.id, action.id, true);
    const result = await finished(executor, task);
    expect(result.actions[0].success).toBe(false);
    expect(await readFile(join(project, 'README.md'), 'utf8')).toBe('External edit');
  });
  it('executes a real command only after approval, with actual exit status', async () => {
    const { executor } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node --version',
      timeout_seconds: 10,
    });
    const action = await waiting(executor, task);
    expect(action.output).toBe('');
    await executor.approve(task.id, action.id, true);
    // The command itself is bounded at 10 seconds; let that result arrive
    // before the test harness deadline on a cold Windows PowerShell process.
    const result = await finished(executor, task, 12_000);
    expect(JSON.parse(result.actions[0].output)).toMatchObject({ exit_code: 0, timed_out: false });
    expect(JSON.parse(result.actions[0].output).stdout).toMatch(/^v24\./);
  }, 15_000);
  it('rejection and cancellation perform no pending write', async () => {
    const { executor, project } = await fixture();
    for (const approve of [false, null]) {
      const task = await executor.manual('canvas_write_file', {
        path: 'not-created.txt',
        content: 'Never write',
      });
      const action = await waiting(executor, task);
      if (approve === null) await executor.cancel(task.id);
      else await executor.approve(task.id, action.id, false);
      await finished(executor, task);
      await expect(readFile(join(project, 'not-created.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  });
  it('times out a real long-running child and does not report success', async () => {
    const { executor } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node -e "setTimeout(()=>{},30000)"',
      timeout_seconds: 1,
    });
    const action = await waiting(executor, task);
    await executor.approve(task.id, action.id, true);
    const result = await finished(executor, task);
    expect(JSON.parse(result.actions[0].output).timed_out).toBe(true);
    expect(result.actions[0].success).toBe(false);
  });
  it('records a nonzero shell status as failure', async () => {
    const { executor } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node -e "process.exit(7)"',
      timeout_seconds: 10,
    });
    const action = await waiting(executor, task);
    await executor.approve(task.id, action.id, true);
    // The command itself is bounded at 10 seconds; let that result arrive
    // before the test harness deadline on a cold Windows PowerShell process.
    const result = await finished(executor, task, 12_000);
    const outcome = JSON.parse(result.actions[0].output);
    expect(outcome).toMatchObject({ timed_out: false, cancelled: false });
    expect(outcome.exit_code).not.toBe(0);
    expect(result.status).toBe('failed');
  }, 15_000);
  it('cancels an already running child and finishes its audit record before shutdown', async () => {
    const { executor } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node -e "setTimeout(()=>{},30000)"',
      timeout_seconds: 60,
    });
    const action = await waiting(executor, task);
    await executor.approve(task.id, action.id, true);
    await wait(() => action.status === 'running');
    await executor.cancel(task.id);
    await executor.close();
    expect(task.status).toBe('cancelled');
    expect(JSON.parse(task.actions[0].output).cancelled).toBe(true);
    expect(executor.busy).toBe(false);
  });
  it('does not resume a pending operation after restart', async () => {
    const { executor, history } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node --version',
      timeout_seconds: 10,
    });
    await waiting(executor, task);
    const restarted = new LocalExecutor(history);
    await restarted.initialize();
    cleanup.push(() => restarted.close());
    expect(restarted.task(task.id).status).toBe('interrupted');
    expect(restarted.busy).toBe(false);
    await executor.cancel(task.id);
    await finished(executor, task);
  });
  it('enforces single active task and prevents project changes during execution', async () => {
    const { executor, project } = await fixture();
    const task = await executor.manual('canvas_run_command', {
      command: 'node --version',
      timeout_seconds: 10,
    });
    await waiting(executor, task);
    await expect(executor.manual('canvas_list_files', { path: '.' })).rejects.toMatchObject({
      code: 'local_task_active',
    });
    await expect(executor.configure(false, project)).rejects.toMatchObject({
      code: 'local_task_active',
    });
    await executor.cancel(task.id);
    await finished(executor, task);
  });
  it('completes the Codex dynamic-tool loop with an actual file write after approval', async () => {
    let host!: HostToolHandler;
    const events = new Set<(event: RpcEvent) => void>();
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const factory = (handler: HostToolHandler): CodexConnection => {
      host = handler;
      return {
        request: async <T>(method: string, params: object) => {
          calls.push({ method, params: params as Record<string, unknown> });
          if (method === 'thread/start')
            return { thread: { id: 'local-thread' }, model: 'test-model' } as T;
          if (method === 'turn/start')
            void (async () => {
              const read = await host({
                threadId: 'local-thread',
                turnId: 'turn',
                callId: 'read',
                tool: 'canvas_read_file',
                arguments: { path: 'README.md' },
              });
              expect(read).toMatchObject({ success: true });
              const write = await host({
                threadId: 'local-thread',
                turnId: 'turn',
                callId: 'write',
                tool: 'canvas_write_file',
                arguments: { path: 'result.txt', content: 'Tool result verified' },
              });
              expect(write).toMatchObject({ success: true });
              for (const listener of events)
                listener({
                  method: 'turn/completed',
                  params: {
                    threadId: 'local-thread',
                    turn: {
                      status: 'completed',
                      items: [
                        { type: 'userMessage' },
                        { type: 'dynamicToolCall' },
                        {
                          type: 'agentMessage',
                          text: 'Created result.txt using approved tool output.',
                        },
                      ],
                    },
                  },
                });
            })();
          return {} as T;
        },
        subscribe: (listener) => {
          events.add(listener);
          return () => {
            events.delete(listener);
          };
        },
        close: async () => {},
      };
    };
    const { executor, project } = await fixture(factory);
    const task = await executor.start('Read requirements and create result.txt');
    const action = await waiting(executor, task);
    await executor.approve(task.id, action.id, true);
    await finished(executor, task);
    expect(await readFile(join(project, 'result.txt'), 'utf8')).toBe('Tool result verified');
    expect(task.answer).toContain('approved tool output');
    expect(calls[0].params).toMatchObject({ environments: [], sandbox: 'read-only' });
    expect((calls[0].params.dynamicTools as { name: string }[]).map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'canvas_list_files',
        'canvas_read_file',
        'canvas_write_file',
        'canvas_run_command',
        'canvas_mcp_tools',
        'canvas_mcp_call',
        'canvas_desktop',
      ]),
    );
    expect(calls.find((call) => call.method === 'turn/start')?.params.effort).toBe('high');
    expect(
      await host({
        threadId: 'different-thread',
        tool: 'canvas_list_files',
        arguments: { path: '.' },
      }),
    ).toMatchObject({ success: false });
  });
  it('API preserves workspace authentication and rejects invalid local operations', async () => {
    const { executor } = await fixture();
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider(), {
      local: executor,
      access: { password: 'a-secure-local-password' },
    });
    cleanup.push(async () => {
      await app.close();
      store.close();
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/local/actions',
          payload: { tool: 'canvas_run_command', arguments: { command: 'node --version' } },
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { password: 'a-secure-local-password' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const response = await app.inject({
      method: 'POST',
      url: '/api/local/actions',
      headers: { cookie },
      payload: { tool: 'canvas_read_file', arguments: { path: 123 } },
    });
    expect(response.statusCode).toBe(400);
    expect((await app.inject({ url: '/api/local', headers: { cookie } })).statusCode).toBe(200);
  });
});
