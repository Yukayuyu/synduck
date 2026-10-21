import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { unzipSync, zipSync } from 'fflate';
import { unpackRelease } from '../packages/local-runtime/src/updates';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')).version as string;
const archivePath = join(root, 'release-output', `ContextCanvas-Windows-${version}.zip`);
const files = unzipSync(new Uint8Array(await fs.readFile(archivePath)));
const home = await fs.mkdtemp(join(tmpdir(), 'canvas-portable-smoke-'));
const testStore = process.env.CANVAS_PNPM_STORE || join(home, '.runtime', 'pnpm-store');
const application = join(home, 'app');
let launcher: ChildProcess | null = null;
let logs = '';
let phase = 'extract package';
// Preserve the normal uncaught-error exit while making the existing smoke-test
// failure readable through GitHub annotations when hosted log downloads fail.
const reportFailure = (error: Error) => {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const detail = `${error.stack || error.message}\n${logs.slice(-4000)}`
    .slice(-7000)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  console.error(`::error title=Portable lifecycle - ${phase}::${detail}`);
};
process.once('uncaughtExceptionMonitor', reportFailure);
const freePort = await new Promise<number>((done, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    server.close(() => done(port));
  });
});
const address = `http://127.0.0.1:${freePort}`;
const wait = async (condition: () => Promise<boolean>, maximum = 150000) => {
  const deadline = Date.now() + maximum;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Portable smoke timeout.\n${logs.slice(-4000)}`);
    await new Promise((done) => setTimeout(done, 250));
  }
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const newVersion = (minor: number) => {
  const fields = version.split('-')[0].split('.').map(Number);
  return `${fields[0]}.${fields[1]}.${fields[2] + minor}`;
};
function newerArchive(next: string, broken = false) {
  const updated = { ...files };
  const pkgPath = 'ContextCanvas-Windows/app/package.json';
  const pkg = JSON.parse(Buffer.from(updated[pkgPath]).toString('utf8'));
  pkg.version = next;
  updated[pkgPath] = new TextEncoder().encode(JSON.stringify(pkg));
  if (broken)
    updated['ContextCanvas-Windows/app/apps/api/server.mjs'] = new TextEncoder().encode(
      'throw new Error("Expected startup failure in portable smoke");\nexport {};',
    );
  const manifestPath = 'ContextCanvas-Windows/package-files.json';
  const manifest = JSON.parse(Buffer.from(updated[manifestPath]).toString('utf8'));
  manifest.version = next;
  for (const entry of manifest.files)
    entry.sha256 = sha(updated[`ContextCanvas-Windows/${entry.path}`]);
  updated[manifestPath] = new TextEncoder().encode(JSON.stringify(manifest));
  return zipSync(updated);
}
async function request(path: string, body?: unknown) {
  const response = await fetch(
    `${address}/api${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const streamed = response.headers.get('content-type')?.includes('ndjson');
  const data = streamed
    ? (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : await response.json();
  if (streamed) assert.equal(data.at(-1)?.type, 'complete');
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
async function start(entry: 'launcher' | 'legacy-server' = 'launcher') {
  const require = createRequire(join(application, 'package.json'));
  const env = {
    ...process.env,
    CANVAS_INSTALL_ROOT: home,
    CANVAS_PORTABLE: '1',
    CANVAS_PNPM_STORE: testStore,
    UPDATES_DISABLED: '1',
    API_PORT: String(freePort),
    APP_PORT: String(freePort + 1),
    API_HOST: '127.0.0.1',
    LLM_PROVIDER: 'demo',
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
    'UPDATE_GITHUB_TOKEN',
    'GH_TOKEN',
    'GITHUB_TOKEN',
  ])
    delete (env as Record<string, string | undefined>)[key];
  launcher = spawn(
    process.execPath,
    [
      ...(entry === 'legacy-server'
        ? ['--import', pathToFileURL(require.resolve('tsx')).href, 'apps/api/src/server.ts']
        : process.env.CANVAS_TEST_LEGACY_BOOTSTRAP === '1'
          ? ['--import', pathToFileURL(require.resolve('tsx')).href, 'scripts/local-launcher.ts']
          : ['scripts/local-launcher.mjs']),
      '--no-browser',
    ],
    { cwd: application, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  launcher.stdout?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-12000);
  });
  launcher.stderr?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-12000);
  });
  launcher.on('error', (error) => {
    logs += error.message;
  });
  await wait(async () => {
    try {
      return (await request('/health')).ok;
    } catch {
      return false;
    }
  });
}
async function stop() {
  if (!launcher || launcher.exitCode !== null || launcher.signalCode !== null) return;
  const processChild = launcher;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => {
      processChild.kill('SIGKILL');
      reject(new Error('Launcher did not stop'));
    }, 20000);
    processChild.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    processChild.kill('SIGTERM');
  });
  launcher = null;
}
try {
  const original = unpackRelease(new Uint8Array(await fs.readFile(archivePath)));
  assert.ok(original.application.has('scripts/local-launcher.mjs'));
  assert.ok(original.application.has('apps/api/server.mjs'));
  assert.ok(original.application.has('apps/api/desktop/windows.ps1'));
  const adapters = new Set(['scripts/local-launcher.ts', 'apps/api/src/server.ts']);
  for (const [path, bytes] of original.application) {
    assert.ok(!path.endsWith('.map'), `Source map leaked: ${path}`);
    assert.ok(!path.endsWith('.ts') || adapters.has(path), `Source leaked: ${path}`);
    if (adapters.has(path)) assert.ok(bytes.byteLength < 100, 'Legacy adapter contains source');
    assert.ok(
      !path.startsWith('packages/') && !path.startsWith('.github/'),
      `Private tree leaked: ${path}`,
    );
  }
  for (const [path, content] of original.application) {
    const target = join(application, path);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await fs.writeFile(
    join(application, '.env'),
    `LLM_PROVIDER=demo\nAPI_PORT=${freePort}\nUPDATES_DISABLED=1\n`,
  );
  await fs.mkdir(join(application, 'data', 'codex'), { recursive: true });
  await fs.writeFile(
    join(application, 'data', 'codex', 'marker.txt'),
    'Keep app-owned login directory',
  );
  const savedSettings = JSON.stringify({
    provider: 'demo',
    codex_model: 'saved-test-model',
    codex_reasoning_effort: 'high',
  });
  await fs.writeFile(join(application, 'data', 'model-settings.json'), savedSettings);
  // All dependencies come from the pinned lockfile, not a copied Linux node_modules tree.
  const windows = process.platform === 'win32';
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  phase = 'install initial dependencies';
  execFileSync(
    windows ? process.execPath : 'pnpm',
    windows
      ? [
          npxCli,
          '--yes',
          '--package=pnpm@11.19.0',
          'pnpm',
          'install',
          '--frozen-lockfile',
          '--store-dir',
          testStore,
        ]
      : ['install', '--frozen-lockfile', '--store-dir', testStore],
    { cwd: application, stdio: 'pipe', timeout: 150000 },
  );
  phase = 'start compiled server through the previous server entry';
  await start('legacy-server');
  assert.equal((await request('/health')).version, version);
  await stop();
  phase = 'start initial version';
  await start();
  assert.equal((await request('/health')).version, version);
  phase = 'initialize packaged signed-out Codex without a model request';
  assert.equal((await request('/models/codex')).connected, false);
  if (windows) {
    phase = 'enumerate Windows through the compiled API and packaged desktop bridge';
    assert.ok(Array.isArray(await request('/local/desktop/windows')));
  }
  phase = 'retain user records';
  const project = join(home, 'project');
  await fs.mkdir(project);
  await fs.writeFile(join(project, 'spec.txt'), 'Preserve tool evidence');
  await request('/local/configure', { enabled: true, root: project });
  const read = await request('/local/actions', {
    tool: 'canvas_read_file',
    arguments: { path: 'spec.txt' },
  });
  await wait(async () => !(await request('/local')).busy);
  const originalTask = await request(`/local/tasks/${read.id}`);
  const conversation = await request('/conversations', {
    title: 'Preserve IDs and provenance through updates',
  });
  const compiled = await request('/compile', {
    conversation_id: conversation.conversation.id,
    prompt: 'Preserve the original text',
    selected_node_ids: [],
  });
  await request('/answer', { context_set_id: compiled.context_set.id });
  const originalState = await request('/state');
  assert.equal(originalState.turns.length, 2);
  assert.equal(originalState.packages.length, 1);
  assert.ok(originalState.turns.every((turn: { status: string }) => turn.status === 'complete'));
  assert.equal(
    await fs.readFile(join(home, 'data/codex/marker.txt'), 'utf8'),
    'Keep app-owned login directory',
  );
  assert.equal(await fs.readFile(join(home, 'data/model-settings.json'), 'utf8'), savedSettings);
  assert.deepEqual(await request(`/local/tasks/${read.id}`), originalTask);
  const nextVersion = newVersion(1);
  phase = 'install update and retain data';
  await request('/updates/import', {
    archive: Buffer.from(newerArchive(nextVersion)).toString('base64'),
  });
  await request('/updates/apply', {});
  await wait(async () => {
    try {
      return (
        (await request('/health')).version === nextVersion &&
        (await request('/updates')).phase === 'idle'
      );
    } catch {
      return false;
    }
  });
  const updatedState = await request('/state');
  assert.deepEqual(updatedState.nodes, originalState.nodes);
  assert.deepEqual(updatedState.excerpts, originalState.excerpts);
  assert.deepEqual(updatedState.packages, originalState.packages);
  assert.deepEqual(updatedState.turns, originalState.turns);
  assert.equal(
    await fs.readFile(join(home, 'data/codex/marker.txt'), 'utf8'),
    'Keep app-owned login directory',
  );
  console.log('PASS: actual portable install, health check, data/login/provenance retention.');
  phase = 'failed-update rollback';
  await request('/updates/import', {
    archive: Buffer.from(newerArchive(newVersion(2), true)).toString('base64'),
  });
  await request('/updates/apply', {});
  await wait(async () => {
    try {
      const status = await request('/updates');
      return status.phase === 'ready' && !!status.error;
    } catch {
      return false;
    }
  });
  assert.equal((await request('/health')).version, nextVersion);
  assert.deepEqual((await request('/state')).packages, originalState.packages);
  assert.equal(
    await fs.readFile(join(home, 'data/codex/marker.txt'), 'utf8'),
    'Keep app-owned login directory',
  );
  console.log('PASS: actual failed new server rolls back to previous version and data.');
  phase = 'stop before journal recovery';
  await stop();
  const previous = JSON.parse(await fs.readFile(join(home, '.runtime/install.json'), 'utf8'));
  const backup = `update-backup-${randomUUID()}`;
  await fs.cp(join(home, 'data'), join(home, '.runtime', backup), { recursive: true });
  await fs.writeFile(join(home, 'data/codex/marker.txt'), 'Interrupted update mutation');
  await fs.writeFile(
    join(home, '.runtime/pending-install.json'),
    JSON.stringify({ previous, backup, backup_ready: true }),
  );
  phase = 'recover interrupted journal';
  await start();
  assert.equal((await request('/health')).version, nextVersion);
  assert.equal(
    await fs.readFile(join(home, 'data/codex/marker.txt'), 'utf8'),
    'Keep app-owned login directory',
  );
  assert.deepEqual((await request('/state')).packages, originalState.packages);
  console.log('PASS: pending-journal recovery after a simulated interrupted update.');
  phase = 'abrupt exit and stale-lock recovery';
  const crashConversation = await request('/conversations', {
    title: 'Cancel owned generation when launcher disappears',
  });
  const crashInput = await request('/compile', {
    conversation_id: crashConversation.conversation.id,
    prompt: 'Long demo input '.repeat(450),
    selected_node_ids: [],
  });
  const streamed = await fetch(`${address}/api/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_set_id: crashInput.context_set.id }),
  });
  assert.equal(streamed.status, 200);
  // Read immediately, with an attached rejection handler: force-killing a
  // Windows parent can reset the response before an error frame is delivered.
  const streamResult = streamed.text().then(
    (text) => ({ kind: 'text' as const, text }),
    (error: unknown) => ({ kind: 'interrupted' as const, error }),
  );
  const runningState = await request('/state');
  const runningTurn = runningState.turns.find(
    (turn: { conversation_id: string; actor: string }) =>
      turn.conversation_id === crashConversation.conversation.id && turn.actor === 'assistant',
  );
  assert.equal(runningTurn?.status, 'streaming');
  const crashed = launcher!;
  await new Promise<void>((done) => {
    crashed.once('exit', () => done());
    crashed.kill('SIGKILL');
  });
  launcher = null;
  await wait(async () => {
    try {
      await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(500) });
      return false;
    } catch {
      return true;
    }
  }, 10000);
  const received = await streamResult;
  if (received.kind === 'text') {
    const events = received.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1)?.type, 'error');
  } else {
    assert.ok(
      received.error instanceof TypeError && received.error.message === 'terminated',
      'Only the forced process termination may interrupt this response',
    );
  }
  await start();
  const interrupted = await request('/state');
  const recoveredTurn = interrupted.turns.find(
    (turn: { id: string }) => turn.id === runningTurn.id,
  );
  assert.equal(recoveredTurn?.status, 'error');
  assert.equal(recoveredTurn.input_context_set_id, crashInput.context_set.id);
  console.log('PASS: abrupt launcher exit stops its API and generation; stale lock recovers.');
} catch (error) {
  if (error instanceof Error) {
    reportFailure(error);
    process.off('uncaughtExceptionMonitor', reportFailure);
  }
  throw error;
} finally {
  phase = 'cleanup';
  await stop();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
