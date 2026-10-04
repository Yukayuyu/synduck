import 'dotenv/config';
import Fastify from 'fastify';

const app = Fastify({ logger: false });
app.get('/api/health', async () => ({ ok: true, service: 'context-canvas' }));
await app.listen({ host: '127.0.0.1', port: Number(process.env.API_PORT || 3001) });
console.log('Context Canvas API started.');
