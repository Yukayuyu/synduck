import { promises as fs } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DomainError } from '@acc/domain';

const version = '2.103.3';
const hashes: Record<string, string> = {
  'linux_amd64.tar.gz': '4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d',
  'linux_arm64.tar.gz': 'ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63',
  'macOS_amd64.zip': 'a2f86418f4350ae6e9ec60d5000bdf7665728436946a97fc27fe50e6ae752682',
  'macOS_arm64.zip': 'd700207eae9ae98fe2b89535c2c087c07823d4628c56364695a5a07ef311c062',
  'windows_amd64.zip': '98d0cfa794721665d7973dd728c78aff7bd836d58f10f6d7a03568eccb0a22e0',
  'windows_arm64.zip': '197211c98687d7770ac331fe8a3b6c198c389108c1536cdbedf659fe4703e484',
};
export type GitHubStatus = {
  phase: 'disconnected' | 'preparing' | 'waiting' | 'connected' | 'error';
  login?: string;
  name?: string;
  verification_url?: string;
  user_code?: string;
  message?: string;
};
export type GitHubRunner = (
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onOutput?: (text: string) => void,
) => Promise<{ code: number | null; output: string }>;
const fail = (message: string) => new DomainError('github_connection_failed', message, 409);
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const runner: GitHubRunner = (binary, args, env, signal, onOutput) =>
  new Promise((done, reject) => {
    const child = spawn(binary, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (part: Buffer) => {
      output = (output + part.toString()).slice(-64000);
      onOutput?.(output);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.stdin.on('error', () => {});
    child.stdin.end('\n');
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop);
      done({ code, output });
    });
    if (signal.aborted) stop();
  });

export class GitHubConnection {
  private state: GitHubStatus = { phase: 'disconnected' };
  private binary = '';
  private active?: AbortController;
  private work?: Promise<void>;
  constructor(
    readonly directory: string,
    private readonly options: {
      ensureBinary?: () => Promise<string>;
      run?: GitHubRunner;
      fetch?: typeof fetch;
    } = {},
  ) {}
  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const profile = JSON.parse(await fs.readFile(join(this.directory, 'profile.json'), 'utf8'));
      if (typeof profile.login === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(profile.login)) {
        await fs.access(join(this.directory, 'hosts.yml'));
        this.binary = this.options.ensureBinary
          ? await this.options.ensureBinary()
          : this.binaryPath();
        await fs.access(this.binary);
        this.state = {
          phase: 'connected',
          login: profile.login,
          name: typeof profile.name === 'string' ? profile.name.slice(0, 200) : undefined,
        };
      }
    } catch {
      /* No app-owned login yet. Never import ambient CLI credentials. */
    }
  }
  status() {
    return { ...this.state };
  }
  async prepareRuntime() {
    this.binary = await this.ensureBinary();
    return this.binary;
  }
  private binaryPath() {
    return join(
      dirname(this.directory),
      'tools',
      `gh-${version}`,
      process.platform + '-' + process.arch,
      process.platform === 'win32' ? 'gh.exe' : 'gh',
    );
  }
  private async ensureBinary(signal: AbortSignal = AbortSignal.timeout(180000)) {
    if (this.options.ensureBinary) return this.options.ensureBinary();
    const binary = this.binaryPath();
    try {
      await fs.access(binary);
      return binary;
    } catch {
      /* First connection. */
    }
    const platform =
      process.platform === 'darwin'
        ? 'macOS'
        : process.platform === 'win32'
          ? 'windows'
          : process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const suffix = `${platform}_${arch}.${platform === 'linux' ? 'tar.gz' : 'zip'}`;
    const expected = hashes[suffix];
    if (!expected) throw fail('这台电脑暂时不支持 GitHub 网页登录。');
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await (this.options.fetch || fetch)(
          `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_${suffix}`,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) },
        );
        if (response.ok) break;
        const retry = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        if (!retry || attempt === 2) {
          const error = fail('无法下载 GitHub 登录组件，请检查网络后重试。');
          Object.defineProperty(error, 'cause', {
            value: new Error('Download HTTP ' + response.status),
          });
          throw error;
        }
      } catch (error) {
        if (error instanceof DomainError || signal.aborted || attempt === 2) throw error;
      }
      await new Promise((done) =>
        setTimeout(
          done,
          Math.min(30000, Math.max(1000, Number(response?.headers.get('retry-after') || 0) * 1000)),
        ),
      );
      signal.throwIfAborted();
    }
    if (!response?.ok || Number(response.headers.get('content-length')) > 40 * 1024 * 1024)
      throw fail('无法下载 GitHub 登录组件，请检查网络后重试。');
    const reader = response.body?.getReader();
    if (!reader) throw fail('GitHub 登录组件下载失败。');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if ((bytes += part.value.length) > 40 * 1024 * 1024) {
        await reader.cancel();
        throw fail('GitHub 登录组件大小异常。');
      }
      chunks.push(part.value);
    }
    const archive = Buffer.concat(chunks);
    if (createHash('sha256').update(archive).digest('hex') !== expected)
      throw fail('GitHub 登录组件校验失败，未执行下载内容。');
    await fs.mkdir(dirname(binary), { recursive: true, mode: 0o700 });
    let content: Uint8Array;
    if (suffix.endsWith('.zip')) {
      let total = 0;
      const entries = unzipSync(archive, {
        filter: (entry) => {
          if ((total += entry.originalSize) > 200 * 1024 * 1024)
            throw fail('GitHub 登录组件展开过大。');
          return /(?:^|\/)bin\/gh(?:\.exe)?$/.test(entry.name);
        },
      });
      const binaries = Object.values(entries);
      if (binaries.length !== 1) throw fail('GitHub 登录组件不完整。');
      content = binaries[0];
    } else {
      const temporary = join(dirname(binary), randomUUID() + '.tar.gz');
      try {
        await fs.writeFile(temporary, archive, { mode: 0o600 });
        content = execFileSync(
          'tar',
          ['-xOzf', temporary, `gh_${version}_${platform}_${arch}/bin/gh`],
          { maxBuffer: 100 * 1024 * 1024, timeout: 30000 },
        );
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    signal.throwIfAborted();
    const temporary = binary + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporary, content, { mode: 0o755 });
    await fs.rename(temporary, binary);
    return binary;
  }
  private environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'TMPDIR',
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'COMSPEC',
      'PATHEXT',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
      'NODE_EXTRA_CA_CERTS',
      'SSL_CERT_FILE',
    ])
      if (process.env[key]) env[key] = process.env[key];
    return {
      ...env,
      GH_CONFIG_DIR: this.directory,
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
      GH_BROWSER: quote(process.execPath) + ' ' + quote(join(this.directory, 'no-browser.cjs')),
    };
  }
  start() {
    if (this.work) return this.status();
    this.active = new AbortController();
    const active = this.active;
    this.state = { phase: 'preparing', message: '正在准备 GitHub 官方登录…' };
    this.work = (async () => {
      try {
        this.binary = await this.ensureBinary(active.signal);
        active.signal.throwIfAborted();
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        await fs.writeFile(join(this.directory, 'no-browser.cjs'), 'process.exit(0);\n', {
          mode: 0o600,
        });
        const run = this.options.run || runner;
        let user: { code: number | null; output: string } | undefined;
        try {
          await fs.access(join(this.directory, 'hosts.yml'));
          user = await run(
            this.binary,
            ['api', 'user', '--hostname', 'github.com', '--jq', '{login,name}'],
            this.environment(),
            active.signal,
          );
        } catch {
          /* A first login has no saved credentials. */
        }
        if (!user || user.code !== 0) {
          const result = await run(
            this.binary,
            [
              'auth',
              'login',
              '--hostname',
              'github.com',
              '--git-protocol',
              'https',
              '--web',
              '--insecure-storage',
              '--skip-ssh-key',
            ],
            this.environment(),
            active.signal,
            (output) => {
              const code = output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1];
              if (code && !active.signal.aborted)
                this.state = {
                  phase: 'waiting',
                  verification_url: 'https://github.com/login/device',
                  user_code: code,
                };
            },
          );
          active.signal.throwIfAborted();
          if (result.code !== 0) throw fail('GitHub 登录未完成，请重试或检查网络。');
          user = await run(
            this.binary,
            ['api', 'user', '--hostname', 'github.com', '--jq', '{login,name}'],
            this.environment(),
            active.signal,
          );
        }
        if (user.code !== 0) throw fail('无法确认 GitHub 账号，请重新连接。');
        const profile = JSON.parse(user.output);
        if (typeof profile.login !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(profile.login))
          throw fail('GitHub 账号验证失败。');
        await fs.chmod(join(this.directory, 'hosts.yml'), 0o600);
        await fs.writeFile(
          join(this.directory, 'profile.json'),
          JSON.stringify({
            login: profile.login,
            name: typeof profile.name === 'string' ? profile.name.slice(0, 200) : undefined,
          }),
          { mode: 0o600 },
        );
        active.signal.throwIfAborted();
        this.state = {
          phase: 'connected',
          login: profile.login,
          name: typeof profile.name === 'string' ? profile.name.slice(0, 200) : undefined,
        };
      } catch (error) {
        if (!active.signal.aborted)
          this.state = {
            phase: 'error',
            message: error instanceof DomainError ? error.message : 'GitHub 连接未完成，请重试。',
          };
      } finally {
        if (this.active === active) {
          this.work = undefined;
          this.active = undefined;
        }
      }
    })();
    // Device authorization expires; do not leave a child waiting indefinitely.
    const timer = setTimeout(
      () => {
        if (this.active === active) {
          active.abort();
          this.state = { phase: 'error', message: '登录已过期，请重新连接。' };
        }
      },
      10 * 60 * 1000,
    );
    timer.unref();
    void this.work.finally(() => clearTimeout(timer));
    return this.status();
  }
  async wait(signal: AbortSignal) {
    while (this.state.phase === 'preparing' || this.state.phase === 'waiting') {
      signal.throwIfAborted();
      await new Promise((done) => setTimeout(done, 200));
    }
    signal.throwIfAborted();
    if (this.state.phase !== 'connected') throw fail(this.state.message || '请先连接 GitHub。');
    return this.status();
  }
  async disconnect() {
    this.active?.abort();
    await this.work;
    this.work = undefined;
    this.active = undefined;
    await fs.rm(this.directory, { recursive: true, force: true });
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.state = { phase: 'disconnected' };
    return this.status();
  }
  commandEnvironment(): NodeJS.ProcessEnv {
    if (this.state.phase !== 'connected' || !this.binary) return {};
    const path = dirname(this.binary);
    return {
      PATH: path + delimiter + (process.env.PATH || process.env.Path || ''),
      GH_CONFIG_DIR: this.directory,
      GH_HOST: 'github.com',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!' + quote(this.binary.replaceAll('\\', '/')) + ' auth git-credential',
    };
  }
  async close() {
    this.active?.abort();
    await this.work;
  }
}
