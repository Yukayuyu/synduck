import { spawn } from 'node:child_process';
import process from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let active = 'app';
const pending = join(root, '.runtime', 'pending-install.json');
const installed = join(root, '.runtime', 'install.json');
if (existsSync(pending))
  active = JSON.parse(readFileSync(pending, 'utf8')).previous.active_directory;
else if (existsSync(installed))
  active = JSON.parse(readFileSync(installed, 'utf8')).active_directory;
if (active !== 'app' && !/^versions\/[0-9A-Za-z.-]+$/.test(active))
  throw new Error('Invalid application directory.');
const app = join(root, active);
const require = createRequire(join(app, 'package.json'));
const child = spawn(
  process.execPath,
  [
    '--import',
    pathToFileURL(require.resolve('tsx')).href,
    'scripts/local-launcher.ts',
    ...(process.env.CANVAS_NO_BROWSER === '1' ? ['--no-browser'] : []),
  ],
  {
    cwd: app,
    env: { ...process.env, CANVAS_INSTALL_ROOT: root, CANVAS_PORTABLE: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  },
);
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.once('error', () => {
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (child.connected) child.send({ kind: 'launcher-stop' });
    else child.kill(signal);
  });
