import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@acc/domain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { McpAuthorization, type ConnectionState } from './mcp-oauth';

export const connectionPresets = [
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    description: '连接笔记与知识库',
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    description: '连接项目与任务',
  },
  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp', description: '连接设计文件' },
  { id: 'browser', name: '网页浏览', description: '使用这台电脑上已安装的 Chrome' },
] as const;

const environmentName = z.string().regex(/^MCP_[A-Z0-9_]+$/);
export const McpServerSchema = z.discriminatedUnion('transport', [
  z
    .object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
      name: z.string().min(1).max(100),
      enabled: z.boolean(),
      transport: z.literal('stdio'),
      command: z.string().min(1).max(1000),
      args: z.array(z.string().max(2000)).max(40),
      env_keys: z.array(environmentName).max(20),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
      name: z.string().min(1).max(100),
      enabled: z.boolean(),
      transport: z.literal('http'),
      url: z
        .string()
        .max(2000)
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === 'https:' ||
              (url.protocol === 'http:' &&
                ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
          );
        }, 'HTTP MCP 使用 HTTPS 或本機 loopback，URL 不可包含密鑰。'),
      token_env: environmentName.optional(),
    })
    .strict(),
]);
export const McpSettingsSchema = z
  .array(McpServerSchema)
  .max(10)
  .refine((servers) => new Set(servers.map((s) => s.id)).size === servers.length);
export type McpServer = z.infer<typeof McpServerSchema>;
const fail = (code: string, message: string) => new DomainError(code, message, 409);
export class McpManager {
  private servers: McpServer[] = [];
  private connected = new Map<string, { client: Client; tools: Tool[] }>();
  readonly authorization: McpAuthorization;
  private connecting = new Map<string, Promise<void>>();
  private connectControllers = new Map<string, AbortController>();
  private configuring: Promise<unknown> = Promise.resolve();
  private connectionErrors = new Map<string, string>();
  constructor(
    private readonly directory: string,
    options: { authorization?: McpAuthorization } = {},
  ) {
    this.authorization =
      options.authorization ||
      new McpAuthorization(
        join(directory, 'connections', 'mcp'),
        (process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + (process.env.API_PORT || 3001)) +
          '/api/connections/callback',
      );
  }
  async initialize() {
    try {
      this.servers = McpSettingsSchema.parse(
        JSON.parse(await fs.readFile(join(this.directory, 'mcp.json'), 'utf8')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw fail('mcp_settings_invalid', 'MCP 設定無效，請先修復設定檔。');
    }
    for (const server of this.servers)
      if (server.transport === 'http' && !server.token_env)
        await this.authorization.entry(server.id, server.url, server.name);
  }
  status() {
    return this.servers.map((server) => ({
      ...server,
      connected: this.connected.has(server.id),
      tools:
        this.connected.get(server.id)?.tools.map((tool) => ({
          name: tool.name,
          description: tool.description?.slice(0, 500),
          inputSchema: tool.inputSchema,
        })) || [],
    }));
  }
  configure(input: unknown) {
    const servers = McpSettingsSchema.parse(input);
    return this.edit(() => servers);
  }
  private edit(update: (servers: McpServer[]) => McpServer[]) {
    const work = this.configuring
      .catch(() => {})
      .then(() => this.applyConfiguration(McpSettingsSchema.parse(update(this.servers))));
    this.configuring = work;
    return work;
  }
  private async applyConfiguration(servers: McpServer[]) {
    for (const old of this.servers)
      if (!servers.some((server) => JSON.stringify(server) === JSON.stringify(old))) {
        this.connectControllers.get(old.id)?.abort();
        await this.connecting.get(old.id);
        await this.connected.get(old.id)?.client.close();
        this.connected.delete(old.id);
      }
    for (const old of this.servers)
      if (
        old.transport === 'http' &&
        !servers.some(
          (server) => server.id === old.id && server.transport === 'http' && server.url === old.url,
        )
      )
        await this.authorization.forget(old.id, old.url);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, 'mcp-' + randomUUID() + '.tmp');
    await fs.writeFile(temporary, JSON.stringify(servers, null, 2), { mode: 0o600 });
    await fs.rename(temporary, join(this.directory, 'mcp.json'));
    this.servers = servers;
    for (const server of servers)
      if (server.transport === 'http' && !server.token_env)
        await this.authorization.entry(server.id, server.url, server.name);
    return this.status();
  }
  has(id: string) {
    return this.servers.some((server) => server.id === id);
  }
  connections(): (ConnectionState & { description?: string; url?: string })[] {
    const entries = new Map<string, ConnectionState & { description?: string; url?: string }>();
    for (const preset of connectionPresets)
      entries.set(preset.id, {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        phase: 'disconnected',
      });
    for (const server of this.servers) {
      const state =
        server.transport === 'http'
          ? this.authorization.status(server.id, server.url, server.name)
          : {
              id: server.id,
              name: server.name,
              phase: server.enabled ? ('connected' as const) : ('disconnected' as const),
            };
      const error = this.connectionErrors.get(server.id);
      entries.set(server.id, {
        ...entries.get(server.id),
        ...state,
        ...(server.transport === 'http' ? { url: server.url } : {}),
        phase: this.connecting.has(server.id)
          ? state.phase === 'waiting'
            ? 'waiting'
            : 'preparing'
          : error
            ? 'error'
            : this.connected.has(server.id)
              ? 'connected'
              : state.phase,
        message: error || state.message,
      });
    }
    return [...entries.values()];
  }
  async addRemote(name: string, url: string) {
    const id = 'service-' + randomUUID().slice(0, 8);
    const config = McpServerSchema.parse({ id, name, enabled: true, transport: 'http', url });
    await this.edit((servers) => [...servers, config]);
    return id;
  }
  async connectService(id: string, root: string) {
    if (this.connecting.has(id)) return;
    if (!this.has(id)) {
      const preset = connectionPresets.find((entry) => entry.id === id);
      if (!preset) throw fail('connection_missing', '找不到这个连接。');
      await this.edit((servers) =>
        servers.some((server) => server.id === id)
          ? servers
          : [
              ...servers,
              'url' in preset
                ? {
                    id,
                    name: preset.name,
                    enabled: true,
                    transport: 'http' as const,
                    url: preset.url,
                  }
                : {
                    id,
                    name: preset.name,
                    enabled: true,
                    transport: 'stdio' as const,
                    command: 'npx',
                    args: ['--yes', '@playwright/mcp@0.0.83', '--browser', 'chrome'],
                    env_keys: [],
                  },
            ],
      );
    }
    const config = this.servers.find((server) => server.id === id)!;
    if (!config.enabled)
      await this.edit((servers) =>
        servers.map((server) => (server.id === id ? { ...server, enabled: true } : server)),
      );
    this.connectionErrors.delete(id);
    const controller = new AbortController();
    this.connectControllers.set(id, controller);
    const work = (async () => {
      try {
        await this.list(id, root, controller.signal, true);
      } catch (error) {
        const state =
          config.transport === 'http'
            ? this.authorization.status(id, config.url, config.name)
            : undefined;
        if (state?.phase !== 'waiting')
          this.connectionErrors.set(id, '连接未完成。请检查网络或服务地址后重试。');
        if (error instanceof DomainError && error.code === 'connection_login_required') return;
      } finally {
        this.connecting.delete(id);
        this.connectControllers.delete(id);
      }
    })();
    this.connecting.set(id, work);
  }
  async waitConnection(id: string, signal: AbortSignal) {
    while (true) {
      signal.throwIfAborted();
      const state = this.connections().find((entry) => entry.id === id);
      if (state?.phase === 'connected') return state;
      if (state?.phase === 'error' || !state)
        throw fail('connection_failed', state?.message || '连接未完成。');
      await new Promise((done) => setTimeout(done, 200));
    }
  }
  async disconnect(id: string) {
    const config = this.servers.find((server) => server.id === id);
    if (!config) return;
    this.connectControllers.get(id)?.abort();
    await this.connecting.get(id);
    await this.connected.get(id)?.client.close();
    this.connected.delete(id);
    if (config.transport === 'http') await this.authorization.forget(id, config.url);
    this.connectionErrors.delete(id);
    await this.edit((servers) => servers.filter((server) => server.id !== id));
  }
  async setKey(id: string, key: string) {
    const config = this.config(id);
    if (config.transport !== 'http')
      throw fail('connection_key_unavailable', '这个连接不使用访问密钥。');
    await this.connected.get(id)?.client.close();
    this.connected.delete(id);
    await this.authorization.setKey(id, config.url, config.name, key);
    this.connectionErrors.delete(id);
  }
  private config(id: string) {
    const config = this.servers.find((server) => server.id === id && server.enabled);
    if (!config) throw fail('mcp_disabled', '請先設定並啟用這個 MCP 服務。');
    return config;
  }
  destination(id: string) {
    return this.config(id);
  }
  async list(id: string, root: string, signal: AbortSignal, setup = false) {
    const config = this.config(id);
    if (this.connected.has(id)) return this.connected.get(id)!.tools;
    const client = new Client({ name: 'context-canvas', version: '0.3.0' }, { capabilities: {} });
    // MCP permissions, prompts, elicitation and sampling are never granted by the host.
    const env: Record<string, string> = {};
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'TMPDIR',
      'COMSPEC',
      'PATHEXT',
    ])
      if (process.env[key]) env[key] = process.env[key]!;
    if (config.transport === 'stdio')
      for (const key of config.env_keys) {
        if (!process.env[key]) throw fail('mcp_secret_missing', '缺少後端環境變數：' + key);
        env[key] = process.env[key]!;
      }
    if (config.transport === 'http' && config.token_env && !process.env[config.token_env])
      throw fail('mcp_secret_missing', '缺少後端環境變數：' + config.token_env);
    const authorization =
      config.transport === 'http' && !config.token_env
        ? await this.authorization.entry(config.id, config.url, config.name)
        : undefined;
    let command = config.transport === 'stdio' ? config.command : '';
    let args = config.transport === 'stdio' ? config.args : [];
    if (config.id === 'browser' && command === 'npx') {
      for (const candidate of [
        join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
        resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js'),
        '/usr/share/nodejs/npm/bin/npx-cli.js',
      ]) {
        try {
          await fs.access(candidate);
          command = process.execPath;
          args = [candidate, ...args];
          break;
        } catch {
          /* Try the next native npm location. */
        }
      }
    }
    const transport =
      config.transport === 'stdio'
        ? new StdioClientTransport({
            command,
            args,
            cwd: root,
            env,
            stderr: 'ignore',
            maxBufferSize: 12 * 1024 * 1024,
          })
        : new StreamableHTTPClientTransport(new URL(config.url), {
            authProvider:
              authorization && !authorization.saved.api_key ? authorization.provider : undefined,
            requestInit:
              config.token_env || authorization?.saved.api_key
                ? {
                    headers: {
                      Authorization:
                        'Bearer ' +
                        (config.token_env
                          ? process.env[config.token_env]
                          : authorization!.saved.api_key),
                    },
                  }
                : {},
            fetch: async (url, init) => {
              // Authorization never follows an unexpected redirect to another host.
              const response = await fetch(url, { ...init, redirect: 'error' });
              if (!response.body) return response;
              const reader = response.body.getReader();
              let size = 0;
              const body = new ReadableStream<Uint8Array>({
                async pull(controller) {
                  try {
                    const part = await reader.read();
                    if (part.done) {
                      controller.close();
                      return;
                    }
                    size += part.value.byteLength;
                    if (size > 12 * 1024 * 1024) {
                      await reader.cancel();
                      controller.error(new Error('MCP message exceeds size limit'));
                      return;
                    }
                    controller.enqueue(part.value);
                  } catch (error) {
                    controller.error(error);
                  }
                },
                cancel: () => reader.cancel(),
              });
              return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            },
          });
    const cancel = () => {
      void client.close();
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      await client.connect(transport, { signal, timeout: setup ? 60000 : 20000 });
      const tools: Tool[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 20000 });
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (tools.length > 100 || (cursor && cursors.has(cursor)))
          throw fail('mcp_catalog_limit', 'MCP 工具目錄超過限制。');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      signal.throwIfAborted();
      if (!this.servers.some((server) => JSON.stringify(server) === JSON.stringify(config)))
        throw fail('connection_changed', '连接设置已改变，请重试。');
      this.connected.set(id, { client, tools });
      client.onclose = () => this.connected.delete(id);
      return tools;
    } catch (e) {
      await client.close().catch(() => {});
      if (
        e instanceof UnauthorizedError ||
        (config.transport === 'http' &&
          this.authorization.status(id, config.url, config.name).phase === 'waiting')
      )
        throw fail(
          'connection_login_required',
          '请点击「连接」完成这个服务的网页登录，之后可在所有画布使用。',
        );
      if (e instanceof DomainError) throw e;
      throw fail('mcp_connect_failed', 'MCP 連接失敗；請確認服務啟動方式、網址與後端授權。');
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  describe(id: string, name: string, args: Record<string, unknown>) {
    this.config(id);
    const tool = this.connected.get(id)?.tools.find((tool) => tool.name === name);
    if (!tool) throw fail('mcp_tool_missing', '請先探索 MCP 工具目錄，並選擇有效工具。');
    const result = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args);
    if (!result.valid) throw fail('mcp_arguments_invalid', '工具參數不符合 MCP 的 inputSchema。');
    return { server: this.destination(id), tool };
  }
  async call(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    this.describe(id, name, args);
    const entry = this.connected.get(id)!;
    try {
      return await entry.client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 60000,
      });
    } catch {
      if (signal.aborted) await entry.client.close().catch(() => {});
      throw fail('mcp_call_failed', 'MCP 呼叫中斷或失敗；外部副作用可能已發生，未自動重試。');
    }
  }
  async close() {
    for (const controller of this.connectControllers.values()) controller.abort();
    await Promise.allSettled(this.connecting.values());
    await Promise.allSettled([...this.connected.values()].map((entry) => entry.client.close()));
    this.connected.clear();
  }
}
