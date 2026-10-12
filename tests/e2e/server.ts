import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'context-canvas-e2e-'));
const project = mkdtempSync(join(tmpdir(), 'context-canvas-project-e2e-'));
writeFileSync(join(project, 'spec.txt'), 'Local project evidence for the browser test.');
process.env.DATABASE_PATH = join(directory, 'workspace.sqlite');
process.env.ASSET_PATH = join(directory, 'assets');
process.env.LLM_PROVIDER = 'demo';
process.env.UPDATES_DISABLED = '1';
delete process.env.LOCAL_EXECUTOR_DISABLED;
process.env.LOCAL_PROJECT_ROOT = project;
process.env.LOCAL_RUNTIME_PATH = join(directory, 'local-runtime');
process.env.MODEL_SETTINGS_PATH = join(directory, 'model-settings.json');
process.env.APP_CODEX_HOME = join(directory, 'codex');
delete process.env.PUBLIC_ORIGIN;
delete process.env.APP_PASSWORD;
process.env.API_HOST = '127.0.0.1';
process.env.API_PORT = '3101';
process.env.APP_PORT = '3100';
process.on('exit', () => {
  rmSync(directory, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});
// Only this isolated test server injects a deterministic desktop driver.
// Production always uses the native Windows driver.
const { Store } = await import('@acc/db');
const { ProviderRegistry } = await import('../../packages/model-gateway/src/registry');
const { LocalExecutor } = await import('../../packages/local-runtime/src/executor');
const { TestDesktopDriver } = await import('../helpers/desktop');
const { createApp } = await import('../../apps/api/src/app');
const { accessConfig } = await import('../../apps/api/src/access');
const { createRequire } = await import('node:module');
const fastifyStatic = createRequire(new URL('../../apps/api/package.json',import.meta.url))('@fastify/static');
const { resolve } = await import('node:path');
const store = new Store(process.env.DATABASE_PATH);
const models = new ProviderRegistry(process.env.MODEL_SETTINGS_PATH);
const local = new LocalExecutor(process.env.LOCAL_RUNTIME_PATH, undefined, undefined, [], {
  desktop: new TestDesktopDriver(),
});
await local.initialize();
await local.configure(true, project);
const app = createApp(store, models, { models, local, access: accessConfig() });
await app.register(fastifyStatic, { root: resolve('apps/web/dist') });
app.addHook('onClose', async () => {
  await local.close();
  await models.close();
  store.close();
});
await app.listen({ host: '127.0.0.1', port: 3101 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
