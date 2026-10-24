import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DomainError } from '@acc/domain';
import { codexError } from './codex-errors';

export type RpcEvent = { method: string; params: Record<string, unknown> };
export type HostToolHandler = (params: Record<string, unknown>) => Promise<unknown>;
export interface CodexConnection {
  request<T>(method: string, params: object): Promise<T>;
  subscribe(listener: (event: RpcEvent) => void): () => void;
  close(): void | Promise<void>;
}
const unavailable = () =>
  new DomainError(
    'codex_unavailable',
    'Codex 連線失敗或逾時，請重試並確認後端可連接 OpenAI。',
    503,
  );

// Fixed application policy, never taken from browser input. Each generation is
// ephemeral, with no workspace environment or external tools attached.
export const CODEX_CONFIG: Record<string, unknown> = {
  forced_login_method: 'chatgpt',
  cli_auth_credentials_store: 'file',
  web_search: 'disabled',
  project_doc_max_bytes: 0,
  'skills.include_instructions': false,
  'features.shell_tool': false,
  'features.unified_exec': false,
  'features.apply_patch_freeform': false,
  'features.view_image': false,
  'features.image_generation': false,
  'features.apps': false,
  'features.plugins': false,
  'features.hooks': false,
  'features.codex_hooks': false,
  'features.memories': false,
  'features.memory_tool': false,
  'features.multi_agent': false,
  'features.js_repl': false,
  'features.browser_use': false,
  'features.computer_use': false,
  'features.search_tool': false,
  'features.skip_host_skill_discovery': true,
  'features.code_mode': false,
  'features.tool_search': false,
  'features.tool_suggest': false,
  'analytics.enabled': false,
};

export class CodexRpc implements CodexConnection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private directory = '';
  private nextId = 0;
  private listeners = new Set<(event: RpcEvent) => void>();
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly home: string,
    private readonly hostTool?: HostToolHandler,
  ) {}

  private start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const home = resolve(this.home);
      mkdirSync(home, { recursive: true, mode: 0o700 });
      this.directory = mkdtempSync(join(tmpdir(), 'canvas-codex-'));
      const require = createRequire(import.meta.url);
      const codexRequire = createRequire(require.resolve('@openai/codex/package.json'));
      const targets: Record<string, string> = {
        'linux-x64': 'x86_64-unknown-linux-musl',
        'linux-arm64': 'aarch64-unknown-linux-musl',
        'darwin-x64': 'x86_64-apple-darwin',
        'darwin-arm64': 'aarch64-apple-darwin',
        'win32-x64': 'x86_64-pc-windows-msvc',
        'win32-arm64': 'aarch64-pc-windows-msvc',
      };
      const platform = `${process.platform}-${process.arch}`;
      const target = targets[platform];
      if (!target) throw unavailable();
      const nativePackage = codexRequire.resolve(`@openai/codex-${platform}/package.json`);
      const binary = join(
        dirname(nativePackage),
        'vendor',
        target,
        'bin',
        process.platform === 'win32' ? 'codex.exe' : 'codex',
      );
      const args = ['app-server', '--listen', 'stdio://'];
      for (const [key, value] of Object.entries(CODEX_CONFIG))
        args.push('-c', `${key}=${JSON.stringify(value)}`);
      // Do not inherit API keys, platform authentication, or a user's Codex home.
      const env: NodeJS.ProcessEnv = {};
      for (const name of [
        'PATH',
        'Path',
        'SYSTEMROOT',
        'SystemRoot',
        'WINDIR',
        'COMSPEC',
        'PATHEXT',
        'TEMP',
        'TMP',
        'TMPDIR',
        'HTTPS_PROXY',
        'HTTP_PROXY',
        'ALL_PROXY',
        'NO_PROXY',
        'NODE_USE_ENV_PROXY',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
        'NODE_EXTRA_CA_CERTS',
      ]) {
        if (process.env[name]) env[name] = process.env[name];
      }
      env.CODEX_HOME = home;
      env.HOME = this.directory;
      env.USERPROFILE = this.directory;
      const child = spawn(binary, args, {
        cwd: this.directory,
        env,
        windowsHide: true,
        shell: false,
        stdio: 'pipe',
      });
      this.child = child;
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 2_000_000) {
          this.close();
          return;
        }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          try {
            this.receive(JSON.parse(line));
          } catch {
            this.close();
            return;
          }
        }
      });
      // Drain diagnostics without logging private provider payloads or auth URLs.
      child.stderr.resume();
      child.stdin.on('error', () => this.close());
      child.on('error', () => this.close());
      child.on('exit', () => {
        if (this.child === child) this.close();
      });
      await this.send('initialize', {
        clientInfo: { name: 'context_canvas', title: 'Context Canvas', version: '0.2.0' },
        capabilities: { experimentalApi: true },
      });
      this.write({ method: 'initialized', params: {} });
    })().catch(() => {
      this.close();
      throw unavailable();
    });
    return this.ready;
  }
  private write(value: object) {
    if (!this.child || this.child.stdin.destroyed) throw unavailable();
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private receive(message: {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: unknown;
  }) {
    if (message.method) {
      // No approval or tool execution is granted by the host application.
      if (message.id !== undefined) {
        if (message.method === 'item/tool/call' && this.hostTool) {
          const child = this.child;
          void this.hostTool(message.params || {})
            .then(
              (result) => {
                if (child === this.child) this.write({ id: message.id, result });
              },
              () => {
                if (child === this.child)
                  this.write({
                    id: message.id,
                    error: { code: -32603, message: 'Local tool failed.' },
                  });
              },
            )
            .catch(() => this.close());
          return;
        }
        this.write({
          id: message.id,
          error: { code: -32601, message: 'Host tools and approvals are disabled.' },
        });
        return;
      }
      for (const listener of this.listeners)
        listener({ method: message.method, params: message.params || {} });
      return;
    }
    const pending = this.pending.get(message.id as number);
    if (!pending) return;
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(codexError(message.error));
    else pending.resolve(message.result);
  }
  private send<T>(method: string, params: object): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unavailable());
        // One slow request must not disconnect other active threads.
        if (method === 'initialize') void this.close();
      }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        this.close();
      }
    });
  }
  async request<T>(method: string, params: object): Promise<T> {
    await this.start();
    return this.send<T>(method, params);
  }
  subscribe(listener: (event: RpcEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  close(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.ready = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(unavailable());
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'canvas/disconnected', params: {} });
    const directory = this.directory;
    this.directory = '';
    const exited = new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
    return exited.then(async () => {
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
          () => {},
        );
    });
  }
}
