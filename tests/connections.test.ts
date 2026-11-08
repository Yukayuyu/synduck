import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { testGitHub } from './helpers/github';
import { oauthMcpFixture } from './helpers/oauth-mcp';
import { McpManager } from '../packages/local-runtime/src/mcp';
import { McpAuthorization } from '../packages/local-runtime/src/mcp-oauth';
import { LocalExecutor } from '../packages/local-runtime/src/executor';
import { Store } from '@acc/db';
import { createApp } from '../apps/api/src/app';
import { DemoProvider } from '@acc/model-gateway';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'synduck-connections-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
it('connects GitHub once without a project, keeps secrets private and restores it for subsequent canvases', async () => {
  const root = await directory();
  const { github, finish } = testGitHub(join(root, 'github'));
  await github.initialize();
  cleanup.push(() => github.close());
  vi.stubEnv('GH_TOKEN', 'ambient-publisher-must-not-leave');
  expect(github.start().phase).toBe('preparing');
  await vi.waitFor(() => expect(github.status().phase).toBe('waiting'));
  expect(github.status()).toMatchObject({
    verification_url: 'https://github.com/login/device',
    user_code: 'ABCD-1234',
  });
  finish();
  await vi.waitFor(() => expect(github.status().phase).toBe('connected'));
  const env = github.commandEnvironment();
  expect(env.GH_CONFIG_DIR).toBe(join(root, 'github'));
  expect(env.GH_TOKEN).toBeUndefined();
  expect(JSON.stringify(env)).not.toContain('fixture-private-credential');
  expect(env.GIT_CONFIG_VALUE_1).toContain('auth git-credential');
  expect(JSON.stringify(github.status())).not.toMatch(/fixture-private|publisher/);
  if (process.platform !== 'win32')
    expect((await stat(join(root, 'github', 'hosts.yml'))).mode & 0o777).toBe(0o600);
  const restored = testGitHub(join(root, 'github')).github;
  await restored.initialize();
  expect(restored.status()).toMatchObject({ phase: 'connected', login: 'canvas-user' });
  await restored.disconnect();
  expect(restored.commandEnvironment()).toEqual({});
  await expect(readFile(join(root, 'github', 'hosts.yml'))).rejects.toThrow();
});
it('does not save a GitHub login when it is cancelled', async () => {
  const root = await directory();
  const { github } = testGitHub(join(root, 'github'));
  await github.initialize();
  github.start();
  await vi.waitFor(() => expect(github.status().phase).toBe('waiting'));
  await github.disconnect();
  expect(github.status().phase).toBe('disconnected');
  expect(await readdir(join(root, 'github'))).toEqual([]);
});
it('runs a real MCP OAuth PKCE roundtrip, keeps credentials out of status and reuses the login after restart', async () => {
  const root = await directory();
  const server = await oauthMcpFixture();
  cleanup.push(() => server.close());
  const authorization = new McpAuthorization(
    join(root, 'credentials'),
    'http://127.0.0.1:3001/api/connections/callback',
  );
  const mcp = new McpManager(root, { authorization });
  await mcp.initialize();
  cleanup.push(() => mcp.close());
  const id = await mcp.addRemote('测试知识库', server.url);
  await mcp.connectService(id, root);
  await vi.waitFor(
    () => expect(mcp.connections().find((entry) => entry.id === id)?.phase).toBe('waiting'),
    { timeout: 5000 },
  );
  const link = mcp.connections().find((entry) => entry.id === id)!.authorization_url!;
  const auth = new URL(link);
  const state = auth.searchParams.get('state')!;
  await expect(authorization.callback('wrong-state', 'forged')).rejects.toThrow();
  const consent = await fetch(new URL('/allow?' + auth.searchParams, server.url), {
    redirect: 'manual',
  });
  const callback = new URL(consent.headers.get('location')!);
  await authorization.callback(state, callback.searchParams.get('code')!);
  await expect(authorization.callback(state, callback.searchParams.get('code')!)).rejects.toThrow();
  expect(JSON.stringify(mcp.connections())).not.toContain(server.token());
  expect(await mcp.list(id, root, new AbortController().signal)).toHaveLength(2);
  const result = await mcp.call(
    id,
    'echo',
    { text: '网页授权后调用' },
    new AbortController().signal,
  );
  expect(JSON.stringify(result)).toContain('网页授权后调用');
  const original = server.token();
  server.expire();
  expect(
    JSON.stringify(
      await mcp.call(id, 'echo', { text: '刷新后继续' }, new AbortController().signal),
    ),
  ).toContain('刷新后继续');
  expect(server.token()).not.toBe(original);
  expect(server.events.filter((event) => event.path === '/token')).toHaveLength(2);
  await mcp.close();
  const restored = new McpManager(root, {
    authorization: new McpAuthorization(
      join(root, 'credentials'),
      'http://127.0.0.1:3001/api/connections/callback',
    ),
  });
  await restored.initialize();
  cleanup.push(() => restored.close());
  expect(await restored.list(id, root, new AbortController().signal)).toHaveLength(2);
  expect(server.events.filter((entry) => entry.path === '/register')).toHaveLength(1);
  await restored.disconnect(id);
  expect(restored.connections().some((entry) => entry.id === id)).toBe(false);
  expect(await readdir(join(root, 'credentials'))).toEqual([]);
});
it('exposes login through the protected API without requiring a project or leaking tokens', async () => {
  const root = await directory();
  const { github, finish } = testGitHub(join(root, 'github'));
  const local = new LocalExecutor(join(root, 'runtime'), undefined, undefined, [], { github });
  await local.initialize();
  await local.configureMcp([
    {
      id: 'fixture',
      name: '测试工具',
      enabled: true,
      transport: 'stdio',
      command: process.execPath,
      args: [
        '--import',
        pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
        fileURLToPath(new URL('./fixtures/mcp-server.ts', import.meta.url)),
        '--stdio',
      ],
      env_keys: [],
    },
  ]);
  const store = new Store(join(root, 'db.sqlite'));
  const app = createApp(store, new DemoProvider(), { local });
  await app.ready();
  cleanup.push(async () => {
    await local.close();
    await app.close();
    store.close();
  });
  const start = await app.inject({
    method: 'POST',
    url: '/api/connections/github/start',
    payload: {},
  });
  expect(start.statusCode).toBe(200);
  expect(local.status().enabled).toBe(false);
  await vi.waitFor(() => expect(github.status().phase).toBe('waiting'));
  finish();
  await vi.waitFor(() => expect(github.status().phase).toBe('connected'));
  const status = await app.inject({ url: '/api/connections' });
  expect(status.json().github.login).toBe('canvas-user');
  expect(status.body).not.toContain('fixture-private');
  const task = await local.manual('canvas_mcp_tools', { server_id: 'fixture' });
  await vi.waitFor(() => expect(task.actions[0]?.status).toBe('waiting'));
  await local.approve(task.id, task.actions[0].id, true);
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(task.actions[0].status).toBe('complete');
  await local.manual(
    'canvas_mcp_call',
    {
      server_id: 'fixture',
      tool: 'echo',
      arguments: { text: '无需本地目录' },
      summary: '读取服务内容',
    },
    task.id,
  );
  await vi.waitFor(() => expect(task.actions[1]?.status).toBe('waiting'));
  await local.approve(task.id, task.actions[1].id, true);
  await vi.waitFor(() => expect(local.busy).toBe(false));
  expect(task.actions[1].success).toBe(true);
  expect(task.actions[1].output).toContain('无需本地目录');
  expect(local.status().enabled).toBe(false);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/connections/add',
        payload: { name: '恶意地址', url: 'http://external.example/mcp' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await app.inject({ url: '/api/connections/callback?state=forged&code=bad' })).statusCode,
  ).toBe(409);
});

it('binds online credentials to the service and callback address and rejects writes after disconnect', async () => {
  const root = await directory();
  const path = join(root, 'credentials');
  const auth = new McpAuthorization(path, 'http://127.0.0.1:3001/api/connections/callback');
  const entry = await auth.entry('notes', 'https://notes.example/mcp', '笔记');
  await auth.setKey('notes', entry.url, entry.name, 'private-service-key');
  const elsewhere = await auth.entry('notes', 'https://other.example/mcp', '其他');
  expect(elsewhere.saved.api_key).toBeUndefined();
  const otherCallback = new McpAuthorization(
    path,
    'http://127.0.0.1:3002/api/connections/callback',
  );
  expect(
    (await otherCallback.entry(entry.id, entry.url, entry.name)).saved.api_key,
  ).toBeUndefined();
  await auth.forget(entry.id, entry.url);
  await expect(
    entry.provider.saveTokens({ access_token: 'late-private-token', token_type: 'Bearer' }),
  ).rejects.toThrow();
  expect(await readdir(path)).toEqual([]);
});

it('preserves simultaneous service additions and unrelated login state', async () => {
  const root = await directory();
  const mcp = new McpManager(root);
  await mcp.initialize();
  cleanup.push(() => mcp.close());
  const ids = await Promise.all([
    mcp.addRemote('一', 'https://one.example/mcp'),
    mcp.addRemote('二', 'https://two.example/mcp'),
  ]);
  await mcp.setKey(ids[0], 'private-key');
  await mcp.disconnect(ids[1]);
  expect(mcp.connections().find((entry) => entry.id === ids[0])?.phase).toBe('connected');
  expect(mcp.connections().some((entry) => entry.id === ids[1])).toBe(false);
  expect(JSON.stringify(mcp.connections())).not.toContain('private-key');
});
