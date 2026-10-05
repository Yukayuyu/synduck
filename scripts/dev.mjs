import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const tsx = join(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs');
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const children = [
  spawn(process.execPath, [tsx, 'watch', 'apps/api/src/server.ts'], {
    stdio: 'inherit',
    shell: false,
  }),
  spawn(process.execPath, [vite, '--config', 'apps/web/vite.config.ts'], {
    stdio: 'inherit',
    shell: false,
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
