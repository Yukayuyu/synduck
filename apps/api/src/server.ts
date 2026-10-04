import 'dotenv/config';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Store } from '@acc/db';
import { configuredProvider } from '@acc/model-gateway';
import { createApp } from './app.ts';

const store = new Store(process.env.DATABASE_PATH || './data/context-canvas.sqlite');
mkdirSync(process.env.ASSET_PATH || './data/assets', { recursive: true });
store.recoverInterrupted();
const app = createApp(store, configuredProvider());
const client = resolve('apps/web/dist');
if (existsSync(client)) await app.register(fastifyStatic, { root: client });
app.addHook('onClose', async () => {
  store.close();
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.API_PORT || 3001) });
console.log('Context Canvas API started (local-only).');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
