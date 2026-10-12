import 'dotenv/config';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Store } from '@acc/db';
import { ProviderRegistry } from '../../../packages/model-gateway/src/registry';
import { accessConfig } from './access';
import { createApp } from './app.ts';
import { dirname } from 'node:path';
import { LocalExecutor } from '../../../packages/local-runtime/src/executor';
import { UpdateManager } from '../../../packages/local-runtime/src/updates';
import { LauncherBridge, type UpdateService } from './runtime';
import packageJson from '../../../package.json';
const managedParent = process.env.CANVAS_MANAGED === '1' && !!process.send;
const parentShutdown: { stop?: () => Promise<void> } = {};
if (managedParent)
  process.once('disconnect', () => {
    if (parentShutdown.stop) void parentShutdown.stop().then(() => process.exit(0));
    else process.exit(1);
  });

const access = accessConfig();
const models = new ProviderRegistry(
  process.env.MODEL_SETTINGS_PATH || './data/model-settings.json',
);
const store = new Store(process.env.DATABASE_PATH || './data/context-canvas.sqlite');
mkdirSync(process.env.ASSET_PATH || './data/assets', { recursive: true });
store.recoverInterrupted();
const local =
  process.env.LOCAL_EXECUTOR_DISABLED === '1'
    ? undefined
    : new LocalExecutor(
        process.env.LOCAL_RUNTIME_PATH || './data/local-runtime',
        () => ({
          model: models.name === 'codex' ? models.codex.model : '',
          effort: models.codex.reasoningEffort,
          connected: async () => (await models.codex.status()).connected,
        }),
        undefined,
        [
          resolve(dirname(process.env.DATABASE_PATH || './data/context-canvas.sqlite')),
          resolve(process.env.APP_CODEX_HOME || './data/codex'),
          resolve(dirname(process.env.MODEL_SETTINGS_PATH || './data/model-settings.json')),
        ],
      );
await local?.initialize();
if (local && !local.snapshot().root && process.env.LOCAL_PROJECT_ROOT)
  await local.configure(true, process.env.LOCAL_PROJECT_ROOT);
const bridge = managedParent ? new LauncherBridge() : undefined;
const updateManager =
  !bridge && process.env.UPDATES_DISABLED !== '1'
    ? new UpdateManager(resolve('.'), packageJson.version, false)
    : undefined;
await updateManager?.initialize();
updateManager?.start();
const updates: UpdateService | undefined =
  bridge ||
  (updateManager
    ? {
        status: async () => updateManager.snapshot(),
        check: () => updateManager.check(),
        download: () => updateManager.download(),
        configure: (channel, autoDownload) => updateManager.configure(channel, autoDownload),
        importArchive: (bytes) => updateManager.importArchive(bytes),
        apply: async () => {
          throw new Error('Use the portable launcher to install updates.');
        },
      }
    : undefined);
const app = createApp(store, models, { access, models, local, updates });
let closing = false;
app.addHook('onRequest', async (_request, reply) => {
  if (closing)
    return reply.code(503).send({ error: 'runtime_stopping', message: '後端正在重新啟動。' });
});
let shutdown: Promise<void> | undefined;
const stopApp = () => {
  if (!shutdown) {
    closing = true;
    shutdown = (async () => {
      await local?.close();
      await models.close();
      await app.close();
    })();
  }
  return shutdown;
};
parentShutdown.stop = stopApp;
const client = resolve('apps/web/dist');
if (existsSync(client)) await app.register(fastifyStatic, { root: client });
app.addHook('onClose', async () => {
  await local?.close();
  bridge?.close();
  updateManager?.close();
  await models.close();
  store.close();
});
await app.listen({ host: access.host, port: Number(process.env.API_PORT || 3001) });
console.log('Context Canvas API started.');
if (managedParent && !process.connected) void stopApp().then(() => process.exit(0));
process.on('message', (message) => {
  if ((message as { kind?: string })?.kind === 'runtime-quiesce') {
    if (local?.busy || store.snapshot().turns.some((turn) => turn.status === 'streaming')) {
      process.send?.({ kind: 'runtime-quiesce-rejected' });
    } else void stopApp().then(() => process.exit(0));
  }
  if ((message as { kind?: string })?.kind === 'runtime-stop')
    void stopApp().then(() => process.exit(0));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void stopApp().then(() => process.exit(0));
  });
