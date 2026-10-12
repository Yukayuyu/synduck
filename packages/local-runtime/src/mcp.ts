import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@acc/domain';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

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
  constructor(private readonly directory: string) {}
  async initialize() {
    try {
      this.servers = McpSettingsSchema.parse(
        JSON.parse(await fs.readFile(join(this.directory, 'mcp.json'), 'utf8')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw fail('mcp_settings_invalid', 'MCP 設定無效，請先修復設定檔。');
    }
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
  async configure(input: unknown) {
    const servers = McpSettingsSchema.parse(input);
    await this.close();
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, 'mcp-' + randomUUID() + '.tmp');
    await fs.writeFile(temporary, JSON.stringify(servers, null, 2), { mode: 0o600 });
    await fs.rename(temporary, join(this.directory, 'mcp.json'));
    this.servers = servers;
    return this.status();
  }
  private config(id: string) {
    const config = this.servers.find((server) => server.id === id && server.enabled);
    if (!config) throw fail('mcp_disabled', '請先設定並啟用這個 MCP 服務。');
    return config;
  }
  destination(id: string) {
    return this.config(id);
  }
  async list(id: string, root: string, signal: AbortSignal) {
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
    const transport =
      config.transport === 'stdio'
        ? new StdioClientTransport({
            command: config.command,
            args: config.args,
            cwd: root,
            env,
            stderr: 'ignore',
            maxBufferSize: 12 * 1024 * 1024,
          })
        : new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: config.token_env
              ? { headers: { Authorization: 'Bearer ' + process.env[config.token_env] } }
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
      await client.connect(transport, { signal, timeout: 20000 });
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
      this.connected.set(id, { client, tools });
      client.onclose = () => this.connected.delete(id);
      return tools;
    } catch (e) {
      await client.close().catch(() => {});
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
    await Promise.allSettled([...this.connected.values()].map((entry) => entry.client.close()));
    this.connected.clear();
  }
}
