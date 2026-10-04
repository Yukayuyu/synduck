import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'context-canvas-e2e-'));
process.env.DATABASE_PATH = join(directory, 'workspace.sqlite');
process.env.ASSET_PATH = join(directory, 'assets');
process.env.LLM_PROVIDER = 'demo';
process.env.API_PORT = '3101';
process.env.APP_PORT = '3100';
process.on('exit', () => {
  rmSync(directory, { recursive: true, force: true });
});
await import('../../apps/api/src/server.ts');
