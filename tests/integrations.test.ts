import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { unzipSync } from 'fflate';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LocalExecutor, type LocalTask } from '../packages/local-runtime/src/executor';
import { McpManager } from '../packages/local-runtime/src/mcp';
import { EvidenceStore } from '../packages/local-runtime/src/evidence';
import { TestDesktopDriver, testPng } from './helpers/desktop';
import { testMcpServer } from './fixtures/mcp-server';
import { Store } from '@acc/db';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
import type {
  CodexConnection,
  HostToolHandler,
  RpcEvent,
} from '../packages/model-gateway/src/codex-rpc';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const wait = async (test: () => boolean) => {
  const deadline = Date.now() + 7000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((done) => setTimeout(done, 15));
  }
};
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'canvas-integration-')),
    project = join(home, 'project'),
    history = join(home, 'history');
  await mkdir(project);
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const driver = new TestDesktopDriver();
  const executor = new LocalExecutor(history, undefined, undefined, [], { desktop: driver });
  await executor.initialize();
  await executor.configure(true, project);
  await executor.configureDesktop(true, '123');
  cleanup.push(() => executor.close());
  return { home, history, project, driver, executor };
}
async function approve(executor: LocalExecutor, task: LocalTask, value = true) {
  await wait(() => task.actions.some((action) => action.status === 'waiting'));
  const action = task.actions.find((action) => action.status === 'waiting')!;
  await executor.approve(task.id, action.id, value);
  await wait(() => !executor.busy);
  return action;
}
const require = createRequire(import.meta.url);
const stdio = {
  id: 'test',
  name: '測試 MCP',
  transport: 'stdio' as const,
  enabled: true,
  command: process.execPath,
  args: [
    '--import',
    pathToFileURL(require.resolve('tsx')).href,
    fileURLToPath(new URL('./fixtures/mcp-server.ts', import.meta.url)),
    '--stdio',
  ],
  env_keys: [],
};
describe('MCP and visual desktop provenance', () => {
  it('retains evidence that input was sent if capturing the result fails', async () => {
    const { executor, driver } = await fixture();
    const task = await executor.manual('canvas_desktop', { operation: 'capture' });
    await approve(executor, task);
    const frame = task.actions[0].desktop!.before!;
    const original = driver.capture.bind(driver);
    driver.capture = async () => {
      if (driver.operations.length) throw new Error('Expected capture failure');
      return original();
    };
    await executor.manual(
      'canvas_desktop',
      { operation: 'click', capture_id: frame.capture_id, x: 100, y: 100 },
      task.id,
    );
    const action = await approve(executor, task);
    expect(action.status).toBe('failed');
    expect(action.desktop?.executed).toBe(true);
    expect(action.desktop?.execution_started).toBe(true);
    expect(action.images).toHaveLength(1);
    expect(action.desktop?.after).toBeUndefined();
    expect(driver.operations).toHaveLength(1);
  });
  it('reserves configuration before asynchronous window discovery so a task cannot race target changes', async () => {
    const { executor, driver } = await fixture();
    let release!: () => void;
    driver.windows = () =>
      new Promise((resolve) => {
        release = () => resolve([driver.window]);
      });
    const configuring = executor.configureDesktop(true, '123');
    expect(executor.busy).toBe(true);
    await expect(executor.manual('canvas_desktop', { operation: 'capture' })).rejects.toMatchObject(
      { code: 'local_task_active' },
    );
    release();
    await configuring;
    expect(executor.busy).toBe(false);
  });
  it('completes the model dynamic-tool loop with actual MCP and exactly recorded image input', async () => {
    const { history, project, executor: setup } = await fixture();
    await setup.configureMcp([stdio]);
    await setup.close();
    let host!: HostToolHandler;
    const listeners = new Set<(event: RpcEvent) => void>();
    const replies: {
      contentItems: { type: string; text?: string; imageUrl?: string }[];
      success: boolean;
    }[] = [];
    let error: unknown;
    const factory = (handler: HostToolHandler): CodexConnection => {
      host = handler;
      return {
        request: async <T>(method: string) => {
          if (method === 'thread/start')
            return { thread: { id: 'test-thread' }, model: 'test-model' } as T;
          if (method === 'turn/start') {
            void (async () => {
              const call = async (tool: string, args: unknown) => {
                const result = (await host({
                  threadId: 'test-thread',
                  tool,
                  arguments: args,
                  callId: 'call-' + replies.length,
                })) as (typeof replies)[number];
                replies.push(result);
                expect(result.success).toBe(true);
                return result;
              };
              await call('canvas_mcp_tools', { server_id: 'test' });
              await call('canvas_mcp_call', {
                server_id: 'test',
                tool: 'echo',
                arguments: { text: 'Model sees MCP evidence' },
              });
              for (let i = 0; i < 9; i++) await call('canvas_desktop', { operation: 'capture' });
              listeners.forEach((listener) =>
                listener({
                  method: 'turn/completed',
                  params: {
                    threadId: 'test-thread',
                    turn: {
                      status: 'completed',
                      items: [
                        {
                          type: 'agentMessage',
                          text: 'Observed the returned images; no unapproved input was sent.',
                        },
                      ],
                    },
                  },
                }),
              );
            })().catch((reason) => {
              error = reason;
              listeners.forEach((listener) =>
                listener({
                  method: 'error',
                  params: { threadId: 'test-thread', willRetry: false },
                }),
              );
            });
          }
          return {} as T;
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close: async () => {},
      };
    };
    const executor = new LocalExecutor(
      history,
      () => ({ model: 'test-model', effort: 'high', connected: async () => true }),
      factory,
      [],
      { desktop: new TestDesktopDriver() },
    );
    await executor.initialize();
    await executor.configure(true, project);
    await executor.configureDesktop(true, '123');
    cleanup.push(() => executor.close());
    const task = await executor.start('Inspect configured MCP and desktop evidence');
    const timer = setInterval(() => {
      const action = task.actions.find((action) => action.status === 'waiting');
      if (action) void executor.approve(task.id, action.id, true).catch(() => {});
    }, 15);
    try {
      await wait(() => !executor.busy);
    } finally {
      clearInterval(timer);
    }
    expect(error).toBeUndefined();
    expect(task.status).toBe('complete');
    const images = replies.flatMap((reply) =>
      reply.contentItems.filter((item) => item.type === 'inputImage'),
    );
    expect(images).toHaveLength(8);
    expect(images[0].imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(task.actions.flatMap((action) => action.model_images || [])).toHaveLength(8);
    expect(JSON.parse(replies.at(-1)!.contentItems[0].text!).images_omitted).toBe(true);
    expect(task.actions.at(-1)?.model_output).toBe(replies.at(-1)!.contentItems[0].text);
  });
  it('connects a real stdio MCP, discovers schemas and approves tool execution with image evidence', async () => {
    const { executor, history } = await fixture();
    await executor.configureMcp([stdio]);
    const discover = await executor.manual('canvas_mcp_tools', { server_id: 'test' });
    expect(executor.mcp.status()[0].connected).toBe(false);
    await approve(executor, discover);
    expect(executor.mcp.status()[0].tools.map((tool) => tool.name)).toContain('echo');
    const task = await executor.manual('canvas_mcp_call', {
      server_id: 'test',
      tool: 'echo',
      arguments: { text: 'Real protocol result' },
    });
    const action = await approve(executor, task);
    expect(action.status).toBe('complete');
    expect(action.approved_at).toBeTruthy();
    expect(JSON.parse(action.output)).toMatchObject({ is_error: false });
    expect(action.output).toContain('Real protocol result');
    expect(action.images?.[0]).toMatchObject({ width: 640, height: 360, mime: 'image/png' });
    expect(action.output).toContain('"model_key_inherited\\":false');
    await executor.pinTrace(task.id, true, 1200, 500);
    expect((await executor.canvasTraces())[0].steps[0].arguments).toMatchObject({
      tool: 'echo',
      server_id: 'test',
    });
    const original = await executor.image(task.id, action.images![0].sha256);
    const restarted = new LocalExecutor(history, undefined, undefined, [], {
      desktop: new TestDesktopDriver(),
    });
    await restarted.initialize();
    cleanup.push(() => restarted.close());
    expect((await restarted.canvasTraces())[0]).toMatchObject({
      task_id: task.id,
      x: 1200,
      y: 500,
    });
    expect((await restarted.image(task.id, action.images![0].sha256)).bytes).toEqual(
      original.bytes,
    );
    expect(restarted.desktop.status().enabled).toBe(false);
    const archive = unzipSync(await executor.exportTrace(task.id));
    expect(
      JSON.parse(Buffer.from(archive['task.json']).toString()).actions[0].destination.tool.name,
    ).toBe('echo');
    expect(Object.keys(archive).some((name) => name.startsWith('images/'))).toBe(true);
  });
  it('rejects invalid MCP parameters before approval and records remote failures without claiming success', async () => {
    const { executor } = await fixture();
    await executor.configureMcp([stdio]);
    await approve(executor, await executor.manual('canvas_mcp_tools', { server_id: 'test' }));
    const invalid = await executor.manual('canvas_mcp_call', {
      server_id: 'test',
      tool: 'echo',
      arguments: { text: 15 },
    });
    await wait(() => !executor.busy);
    expect(invalid.actions[0].status).toBe('failed');
    expect(invalid.actions[0].approved_at).toBeUndefined();
    const rejected = await executor.manual('canvas_mcp_call', {
      server_id: 'test',
      tool: 'echo',
      arguments: { text: 'Do not execute' },
    });
    await approve(executor, rejected, false);
    expect(rejected.actions[0].images).toBeUndefined();
    const failed = await executor.manual('canvas_mcp_call', {
      server_id: 'test',
      tool: 'failure',
      arguments: {},
    });
    await approve(executor, failed);
    expect(failed.status).toBe('failed');
    expect(failed.actions[0].output).toContain('Expected remote failure');
  });
  it('uses real Streamable HTTP transport and persists only backend secret references', async () => {
    const { history, project } = await fixture();
    let authorized = false;
    const http = createServer((request, response) => {
      authorized ||= request.headers.authorization === 'Bearer fake-test-token';
      void (async () => {
        const server = testMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        response.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(request, response);
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    cleanup.push(
      () =>
        new Promise<void>((done, reject) => {
          http.close((error) => (error ? reject(error) : done()));
          http.closeAllConnections();
        }),
    );
    const previous = process.env.MCP_TEST_SECRET;
    process.env.MCP_TEST_SECRET = 'fake-test-token';
    cleanup.push(async () => {
      if (previous === undefined) delete process.env.MCP_TEST_SECRET;
      else process.env.MCP_TEST_SECRET = previous;
    });
    const mcp = new McpManager(history);
    await mcp.initialize();
    cleanup.push(() => mcp.close());
    const port = (http.address() as { port: number }).port;
    await mcp.configure([
      {
        id: 'remote',
        name: 'HTTP test',
        enabled: true,
        transport: 'http',
        url: 'http://127.0.0.1:' + port + '/mcp',
        token_env: 'MCP_TEST_SECRET',
      },
    ]);
    await mcp.list('remote', project, new AbortController().signal);
    const result = await mcp.call(
      'remote',
      'echo',
      { text: 'HTTP result' },
      new AbortController().signal,
    );
    expect(authorized).toBe(true);
    expect(result.isError).not.toBe(true);
    expect(await readFile(join(history, 'mcp.json'), 'utf8')).not.toContain('fake-test-token');
  });
  it('captures, approves a coordinate action, records before/after and never replays it on restart', async () => {
    const { executor, driver, history } = await fixture();
    const task = await executor.manual('canvas_desktop', { operation: 'capture' });
    const captured = await approve(executor, task);
    const reference = captured.desktop!.before!;
    expect(driver.operations).toHaveLength(0);
    await executor.manual(
      'canvas_desktop',
      { operation: 'click', capture_id: reference.capture_id, x: 220, y: 110 },
      task.id,
    );
    await wait(() => task.actions.some((action) => action.status === 'waiting'));
    expect(driver.operations).toHaveLength(0);
    const clicked = await approve(executor, task);
    expect(driver.operations).toHaveLength(1);
    expect(clicked.desktop?.executed).toBe(true);
    expect(clicked.desktop?.before?.sha256).not.toBe(clicked.desktop?.after?.sha256);
    expect(clicked.desktop?.reference?.capture_id).toBe(reference.capture_id);
    const fresh = new LocalExecutor(history, undefined, undefined, [], { desktop: driver });
    await fresh.initialize();
    cleanup.push(() => fresh.close());
    expect(fresh.task(task.id).actions[1].desktop?.executed).toBe(true);
    expect(driver.operations).toHaveLength(1);
  });
  it('refuses expired/foreign frames and changed window bounds before sending input', async () => {
    const { executor, driver } = await fixture();
    const task = await executor.manual('canvas_desktop', { operation: 'capture' });
    await approve(executor, task);
    const reference = task.actions[0].desktop!.before!;
    driver.bounds.width = 1000;
    await executor.manual(
      'canvas_desktop',
      { operation: 'click', capture_id: reference.capture_id, x: 30, y: 30 },
      task.id,
    );
    const changed = await approve(executor, task);
    expect(changed.status).toBe('failed');
    expect(changed.images?.length).toBe(1);
    expect(driver.operations).toHaveLength(0);
    reference.captured_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await executor.manual(
      'canvas_desktop',
      { operation: 'key', capture_id: reference.capture_id, key: 'Enter' },
      task.id,
    );
    await wait(() => !executor.busy);
    expect(task.actions.at(-1)?.approved_at).toBeUndefined();
    expect(driver.operations).toHaveLength(0);
  });
  it('protects trace images/exports with workspace access, rejects unrelated images and detects tampering', async () => {
    const { executor, history } = await fixture();
    const task = await executor.manual('canvas_desktop', { operation: 'capture' });
    await approve(executor, task);
    const image = task.actions[0].images![0];
    const store = new Store(':memory:');
    cleanup.push(async () => store.close());
    const app = createApp(store, new DemoProvider(), {
      local: executor,
      access: { password: 'test-workspace-password' },
    });
    cleanup.push(() => app.close());
    const path = '/api/local/tasks/' + task.id + '/images/' + image.sha256;
    expect((await app.inject({ url: path })).statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/session/login',
      payload: { password: 'test-workspace-password' },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const response = await app.inject({ url: path, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(
      (await app.inject({ url: '/api/local/tasks/' + task.id + '/export', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/api/local/tasks/' + task.id + '/images/' + 'a'.repeat(64),
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
    await writeFile(join(history, 'evidence', image.sha256), 'tampered');
    await expect(executor.image(task.id, image.sha256)).rejects.toMatchObject({
      code: 'evidence_changed',
    });
  });
  it('keeps archived pinned tasks reachable beyond the recent history limit', async () => {
    const { executor, history } = await fixture();
    const task = await executor.manual('canvas_list_files', { path: '.' });
    await wait(() => !executor.busy);
    await executor.pinTrace(task.id, true);
    for (let i = 0; i < 51; i++) {
      await executor.manual('canvas_list_files', { path: '.' });
      await wait(() => !executor.busy);
    }
    expect(executor.snapshot().tasks.some((entry) => entry.id === task.id)).toBe(false);
    expect((await executor.canvasTraces())[0].task_id).toBe(task.id);
    const fresh = new LocalExecutor(history);
    await fresh.initialize();
    cleanup.push(() => fresh.close());
    expect((await fresh.readTask(task.id)).actions[0].status).toBe('complete');
  });
  it('accepts only bounded raster evidence', async () => {
    const { history } = await fixture();
    const evidence = new EvidenceStore(join(history, 'other-evidence'));
    await expect(
      evidence.put(Buffer.from('<svg>untrusted</svg>'), 'image/svg+xml', 'test'),
    ).rejects.toBeTruthy();
    const image = await evidence.put(testPng(), 'image/png', 'test');
    expect(image.width).toBe(640);
    expect(await evidence.read(image)).toEqual(testPng());
  });
});
