import 'dotenv/config';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Store } from '@acc/db';
import { ProviderRegistry } from '../../../packages/model-gateway/src/registry';
import { accessConfig } from './access';
import { createApp } from './app.ts';

const access = accessConfig();
const models = new ProviderRegistry(
  process.env.MODEL_SETTINGS_PATH || './data/model-settings.json',
);
const store = new Store(process.env.DATABASE_PATH || './data/context-canvas.sqlite');
mkdirSync(process.env.ASSET_PATH || './data/assets', { recursive: true });
store.recoverInterrupted();
const app = createApp(store, models, { access, models });
const client = resolve('apps/web/dist');
if (existsSync(client)) await app.register(fastifyStatic, { root: client });
app.addHook('onClose', async () => {
  await models.close();
  store.close();
});
await app.listen({ host: access.host, port: Number(process.env.API_PORT || 3001) });
console.log('Context Canvas API started.');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
