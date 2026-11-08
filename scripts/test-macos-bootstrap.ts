import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import packageJson from '../package.json';

if (process.platform !== 'darwin') throw new Error('This check requires a real macOS runner.');
const home = await fs.mkdtemp(join(tmpdir(), 'synduck mac startup '));
const root = join(home, 'ContextCanvas-macOS');
let child: ChildProcess | undefined;
let logs = '';
const port = await new Promise<number>((done) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    server.close(() => done(port));
  });
});
const url = `http://127.0.0.1:${port}`;
const wait = async (condition: () => Promise<boolean>, maximum = 300000) => {
  const deadline = Date.now() + maximum;
  while (!(await condition())) {
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw new Error('macOS bootstrap exited.\n' + logs.slice(-4000));
    if (Date.now() > deadline) throw new Error('macOS bootstrap timed out.\n' + logs.slice(-4000));
    await new Promise((done) => setTimeout(done, 300));
  }
};
const request = async (path: string, data?: unknown) => {
  const result = await fetch(
    url + '/api' + path,
    data === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  assert.equal(result.status, 200);
  return result.json();
};
const stop = async () => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const current = child;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-current.pid!, 'SIGKILL');
      } catch {
        /* stopped */
      }
      reject(new Error('macOS launcher did not stop'));
    }, 20000);
    current.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    process.kill(-current.pid!, 'SIGTERM');
  });
};
const start = async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Exclude installed Node, pnpm and Homebrew to exercise a genuine first run.
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    API_PORT: String(port),
    API_HOST: '127.0.0.1',
    LLM_PROVIDER: 'demo',
    UPDATES_DISABLED: '1',
    CANVAS_NO_BROWSER: '1',
    CANVAS_NO_PAUSE: '1',
    NO_PROXY: '127.0.0.1,localhost',
  };
  for (const key of [
    'DATABASE_PATH',
    'ASSET_PATH',
    'MODEL_SETTINGS_PATH',
    'APP_CODEX_HOME',
    'LOCAL_RUNTIME_PATH',
    'LOCAL_PROJECT_ROOT',
    'PUBLIC_ORIGIN',
    'APP_PASSWORD',
    'LLM_API_KEY',
    'OPENAI_API_KEY',
    'GH_TOKEN',
    'GITHUB_TOKEN',
  ])
    delete env[key];
  child = spawn(join(root, 'Start-Synduck.command'), [], {
    cwd: home,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-12000);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-12000);
  });
  child.once('error', (error) => {
    logs += error.message;
  });
  await wait(async () => {
    try {
      return (await request('/health')).version === packageJson.version;
    } catch {
      return false;
    }
  });
};
try {
  // ditto is the macOS ZIP extractor; verify Unix execute permissions survive it.
  execFileSync('/usr/bin/ditto', [
    '-x',
    '-k',
    resolve(`release-output/ContextCanvas-macOS-${packageJson.version}.zip`),
    home,
  ]);
  assert((await fs.stat(join(root, 'Start-Synduck.command'))).mode & 0o100);
  await start();
  const conversation = await request('/conversations', { title: 'macOS first launch record' });
  assert.equal((await request('/models/codex')).connected, false);
  await stop();
  await start();
  const snapshot = await request('/state');
  assert(
    snapshot.conversations.some(
      (entry: { id: string }) => entry.id === conversation.conversation.id,
    ),
  );
  assert.equal((await request('/updates')).managed, true);
  await stop();
  console.log(
    `PASS: native ${process.arch} macOS ZIP permissions, verified Node bootstrap without Node/pnpm in PATH, signed-out Codex, restart and retained data.`,
  );
} catch (error) {
  const detail = String(error) + '\n' + logs.slice(-4000);
  if (process.env.GITHUB_ACTIONS === 'true')
    console.error(
      '::error title=macOS first launch::' +
        detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'),
    );
  throw error;
} finally {
  await stop();
  await fs.rm(home, { recursive: true, force: true });
}
