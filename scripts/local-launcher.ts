import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs, existsSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@acc/domain';
import { UpdateManager } from '../packages/local-runtime/src/updates';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installRoot = resolve(process.env.CANVAS_INSTALL_ROOT || sourceRoot);
const portable = process.env.CANVAS_PORTABLE === '1';
const runtime = join(installRoot, '.runtime');
const wrapperShutdown: { stop?: () => Promise<void> } = {};
if (process.send)
  process.once('disconnect', () => {
    if (wrapperShutdown.stop) void wrapperShutdown.stop();
    else process.exit(1);
  });
await fs.mkdir(runtime, { recursive: true });
const initialEnv = existsSync(join(installRoot, '.env'))
  ? join(installRoot, '.env')
  : join(installRoot, 'app', '.env');
if (existsSync(initialEnv)) process.loadEnvFile(initialEnv);
const configuredPort = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535)
  throw new Error('Invalid API_PORT.');
const listening = (host: string) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host, port: configuredPort });
    const finish = (value: boolean) => {
      socket.destroy();
      done(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
if ((await Promise.all(['127.0.0.1', '::1'].map(listening))).some(Boolean))
  throw new Error(
    'The API port is already in use. Stop the running Context Canvas before starting another launcher.',
  );
const lockDirectory = join(runtime, 'launcher-lock');
const ownerName = `owner-${process.pid}-${randomUUID()}.lock`;
async function lock() {
  try {
    await fs.mkdir(lockDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owners = await fs.readdir(lockDirectory);
    if (owners.length !== 1 || !/^owner-\d+-[a-f0-9-]{36}\.lock$/.test(owners[0]))
      throw new Error(
        'Another launcher may be starting. Stop all launchers before repairing .runtime/launcher-lock.',
      );
    const pid = Number(owners[0].split('-')[1]);
    let alive = true;
    try {
      process.kill(pid, 0);
      // A terminated child can remain unreaped in a cloud container. It owns no
      // running server; kill(pid, 0) alone would block this installation forever.
      if (process.platform === 'linux') {
        try {
          const state = await fs.readFile('/proc/' + pid + '/stat', 'utf8');
          alive = !['Z', 'X'].includes(state.slice(state.lastIndexOf(')') + 2).split(' ')[0]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') alive = false;
        }
      }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('This installation already has a running launcher.');
    try {
      await fs.unlink(join(lockDirectory, owners[0]));
      await fs.rmdir(lockDirectory);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
    }
    return lock();
  }
  writeFileSync(join(lockDirectory, ownerName), '', { flag: 'wx', mode: 0o600 });
  process.once('exit', () => {
    try {
      unlinkSync(join(lockDirectory, ownerName));
      rmdirSync(lockDirectory);
    } catch {
      /* Only remove this process's owner marker. */
    }
  });
}
await lock();
const RecordSchema = z.object({
  active_directory: z.string(),
  active_version: z.string(),
  previous_directory: z.string().nullable(),
  previous_version: z.string().nullable(),
});
type InstallRecord = z.infer<typeof RecordSchema>;
const safeDirectory = (value: string) => {
  if (value !== 'app' && !/^versions\/[0-9A-Za-z.-]+$/.test(value))
    throw new Error('Invalid installed application directory.');
  return join(installRoot, value);
};
const writeJson = async (path: string, value: unknown) => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temporary, path);
};
let record: InstallRecord;
try {
  record = RecordSchema.parse(JSON.parse(await fs.readFile(join(runtime, 'install.json'), 'utf8')));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  record = {
    active_directory: 'app',
    active_version: JSON.parse(await fs.readFile(join(sourceRoot, 'package.json'), 'utf8')).version,
    previous_directory: null,
    previous_version: null,
  };
}
if (portable) {
  try {
    const pending = JSON.parse(
      await fs.readFile(join(runtime, 'pending-install.json'), 'utf8'),
    ) as { previous: InstallRecord; backup: string; backup_ready: boolean };
    record = RecordSchema.parse(pending.previous);
    safeDirectory(record.active_directory);
    if (pending.backup_ready) {
      if (!/^update-backup-[a-f0-9-]{36}$/.test(pending.backup))
        throw new Error('Invalid update recovery point.');
      await fs.rm(join(installRoot, 'data'), { recursive: true, force: true });
      await fs.cp(join(runtime, pending.backup), join(installRoot, 'data'), { recursive: true });
    }
    await writeJson(join(runtime, 'install.json'), record);
    await fs.rm(join(runtime, 'pending-install.json'));
    console.log('Recovered the previous version after an interrupted update.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
let appDirectory = portable ? safeDirectory(record.active_directory) : sourceRoot;
if (portable) {
  const oldData = join(installRoot, 'app', 'data');
  if (!existsSync(join(installRoot, 'data')) && existsSync(oldData)) {
    const staging = join(runtime, `migrated-data-${randomUUID()}`);
    await fs.cp(oldData, staging, { recursive: true });
    await fs.rename(staging, join(installRoot, 'data'));
  }
  const oldEnv = join(installRoot, 'app', '.env');
  if (!existsSync(join(installRoot, '.env'))) {
    const staging = join(runtime, `migrated-env-${randomUUID()}`);
    await fs.copyFile(existsSync(oldEnv) ? oldEnv : join(appDirectory, '.env.example'), staging);
    await fs.rename(staging, join(installRoot, '.env'));
  }
}
const envPath = join(installRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CANVAS_INSTALL_ROOT: installRoot,
  CANVAS_MANAGED: '1',
};
for (const [key, fallback] of Object.entries({
  DATABASE_PATH: 'data/context-canvas.sqlite',
  ASSET_PATH: 'data/assets',
  APP_CODEX_HOME: 'data/codex',
  MODEL_SETTINGS_PATH: 'data/model-settings.json',
  LOCAL_RUNTIME_PATH: 'data/local-runtime',
}))
  env[key] = resolve(installRoot, env[key] || fallback);
if (portable)
  for (const key of [
    'DATABASE_PATH',
    'ASSET_PATH',
    'APP_CODEX_HOME',
    'MODEL_SETTINGS_PATH',
    'LOCAL_RUNTIME_PATH',
  ]) {
    const path = relative(join(installRoot, 'data'), env[key]!);
    if (path.startsWith(`..${sep}`) || path === '..' || resolve(env[key]!) === installRoot)
      throw new Error(
        'Portable updates require data and authentication paths inside the installation data directory.',
      );
  }
const port = Number(env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT.');
const address = `http://127.0.0.1:${port}`;
const currentVersion = JSON.parse(await fs.readFile(join(appDirectory, 'package.json'), 'utf8'))
  .version as string;
record.active_version = currentVersion;
const updates = new UpdateManager(installRoot, currentVersion, portable);
await updates.initialize();
let child: ChildProcess | null = null,
  dependencyInstaller: ChildProcess | null = null,
  stopping = false,
  replacing = false;

const startServer = async (directory: string, expectedVersion: string) => {
  const require = createRequire(join(directory, 'package.json'));
  const tsx = pathToFileURL(require.resolve('tsx')).href;
  const instanceId = randomUUID();
  const processChild = spawn(process.execPath, ['--import', tsx, 'apps/api/src/server.ts'], {
    cwd: directory,
    env: { ...env, CANVAS_INSTANCE_ID: instanceId },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  child = processChild;
  processChild.on('message', (message) => {
    const parsed = z
      .object({
        kind: z.literal('runtime-update'),
        id: z.string(),
        action: z.string(),
        args: z.record(z.string(), z.unknown()),
      })
      .safeParse(message);
    if (!parsed.success || processChild !== child) return;
    const { id, action, args } = parsed.data;
    const reply = (result?: unknown, error?: string) => {
      if (processChild.connected)
        processChild.send({ kind: 'runtime-update-reply', id, result, error });
    };
    if (action === 'apply') {
      if (replacing || !portable || updates.state.phase !== 'ready')
        return reply(undefined, '請先準備新版，並使用 Windows 啟動器。');
      replacing = true;
      reply({ ok: true, restarting: true });
      void installUpdate().finally(() => {
        replacing = false;
      });
      return;
    }
    void (async () => {
      if (action === 'status') return updates.snapshot();
      if (action === 'check') return updates.check();
      if (action === 'download') return updates.download();
      if (action === 'configure') {
        const data = z
          .object({ channel: z.enum(['stable', 'preview']), auto_download: z.boolean() })
          .parse(args);
        return updates.configure(data.channel, data.auto_download);
      }
      if (action === 'import')
        return updates.importArchive(
          Buffer.from(
            z
              .string()
              .max(45 * 1024 * 1024)
              .parse(args.archive),
            'base64',
          ),
        );
      throw new Error('Unknown update action.');
    })().then(
      (result) => reply(result),
      (error) =>
        reply(
          undefined,
          error instanceof DomainError ? error.message : '更新操作失敗，未切換版本。',
        ),
    );
  });
  processChild.once('exit', () => {
    if (!stopping && !replacing && child === processChild) {
      updates.close();
      process.exitCode = 1;
    }
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !stopping) {
    if (processChild.exitCode !== null || processChild.signalCode !== null)
      throw new Error('Application startup failed.');
    try {
      const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1500) });
      const health = (await response.json()) as {
        service?: string;
        version?: string;
        ok?: boolean;
        instance_id?: string;
      };
      if (
        health.ok &&
        health.service === 'context-canvas' &&
        health.version === expectedVersion &&
        health.instance_id === instanceId
      )
        return processChild;
    } catch {
      /* Wait for this version's own health check. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('Application health check timed out.');
};
const stopServer = async (processChild: ChildProcess, graceful = true) => {
  if (processChild.exitCode !== null || processChild.signalCode !== null) return;
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Application did not stop.'));
    }, 20000);
    const exited = () => {
      cleanup();
      done();
    };
    const rejected = (message: unknown) => {
      if ((message as { kind?: string }).kind === 'runtime-quiesce-rejected') {
        cleanup();
        reject(new Error('Application is busy.'));
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      processChild.off('exit', exited);
      processChild.off('message', rejected);
    };
    processChild.once('exit', exited);
    processChild.on('message', rejected);
    if (processChild.connected)
      processChild.send({ kind: graceful ? 'runtime-quiesce' : 'runtime-stop' });
    else processChild.kill();
  });
};
const installDependencies = async (directory: string) => {
  const windows = process.platform === 'win32';
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const command = windows ? process.execPath : 'pnpm';
  const args = windows
    ? [
        npxCli,
        '--yes',
        '--cache',
        join(runtime, 'npm-cache'),
        '--package=pnpm@11.19.0',
        'pnpm',
        'install',
        '--frozen-lockfile',
        '--store-dir',
        join(runtime, 'pnpm-store'),
      ]
    : [
        'install',
        '--frozen-lockfile',
        '--store-dir',
        process.env.CANVAS_PNPM_STORE || join(runtime, 'pnpm-store'),
      ];
  if (windows && !existsSync(npxCli))
    throw new Error('The portable Node installation is missing npm.');
  await new Promise<void>((done, reject) => {
    const installer = spawn(command, args, {
      cwd: directory,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    dependencyInstaller = installer;
    const timer = setTimeout(
      () => {
        installer.kill();
        reject(new Error('Dependency installation timed out.'));
      },
      5 * 60 * 1000,
    );
    installer.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not start dependency installation.'));
    });
    installer.once('exit', (code) => {
      dependencyInstaller = null;
      clearTimeout(timer);
      if (code === 0) done();
      else reject(new Error('Dependency installation failed.'));
    });
  });
};
async function installUpdate() {
  const previous = { ...record };
  const previousDirectory = appDirectory;
  let stopped = false,
    backupReady = false;
  const backup = `update-backup-${randomUUID()}`;
  try {
    const prepared = await updates.prepare();
    await installDependencies(prepared.directory);
    if (stopping) throw new Error('Launcher is stopping.');
    await stopServer(child!);
    stopped = true;
    await writeJson(join(runtime, 'pending-install.json'), {
      previous,
      backup,
      backup_ready: false,
    });
    await fs.cp(join(installRoot, 'data'), join(runtime, backup), { recursive: true });
    backupReady = true;
    await writeJson(join(runtime, 'pending-install.json'), {
      previous,
      backup,
      backup_ready: true,
    });
    await startServer(prepared.directory, prepared.version);
    record = {
      active_directory: relative(installRoot, prepared.directory).split(sep).join('/'),
      active_version: prepared.version,
      previous_directory: previous.active_directory,
      previous_version: previous.active_version,
    };
    await writeJson(join(runtime, 'install.json'), record);
    await fs.rm(join(runtime, 'pending-install.json'));
    await fs.rm(join(runtime, 'staged.json'), { force: true });
    appDirectory = prepared.directory;
    updates.completeInstallation(prepared.version, previous.active_version);
    console.log(`Updated Context Canvas to ${prepared.version}.`);
  } catch {
    if (stopped) {
      if (child && child.exitCode === null && child.signalCode === null)
        await stopServer(child, false).catch(() => child?.kill('SIGKILL'));
      if (backupReady) {
        await fs.rm(join(installRoot, 'data'), { recursive: true, force: true });
        await fs.cp(join(runtime, backup), join(installRoot, 'data'), { recursive: true });
      }
      record = previous;
      appDirectory = previousDirectory;
      await writeJson(join(runtime, 'install.json'), record);
      await fs.rm(join(runtime, 'pending-install.json'), { force: true });
      if (!stopping)
        await startServer(previousDirectory, previous.active_version).catch(() => {
          process.exitCode = 1;
        });
    }
    updates.installationFailed();
    console.error('Update failed; the previous application and data were retained.');
  }
}
const stopLauncher = async () => {
  if (stopping) return;
  stopping = true;
  updates.close();
  dependencyInstaller?.kill();
  if (child) await stopServer(child, false).catch(() => child?.kill('SIGKILL'));
  process.exit(0);
};
wrapperShutdown.stop = stopLauncher;
process.on('message', (message) => {
  if ((message as { kind?: string }).kind === 'launcher-stop') void stopLauncher();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stopLauncher());
try {
  await startServer(appDirectory, currentVersion);
  if (portable) await writeJson(join(runtime, 'install.json'), record);
  if (process.env.UPDATES_DISABLED !== '1') updates.start();
  console.log('Context Canvas is ready. Keep this launcher open.');
  if (process.platform === 'win32' && !process.argv.includes('--no-browser')) {
    const browser = spawn('cmd.exe', ['/d', '/c', 'start', '""', address], {
      stdio: 'ignore',
      windowsHide: true,
    });
    browser.on('error', () => {});
    browser.unref();
  }
} catch {
  updates.close();
  (child as ChildProcess | null)?.kill();
  process.exitCode = 1;
  console.error('Context Canvas could not start. Check the error above.');
}
