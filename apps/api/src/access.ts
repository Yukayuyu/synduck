import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export type AccessConfig = { publicOrigin?: string; password?: string; host?: string };
export function accessConfig(env: Record<string, string | undefined> = process.env): AccessConfig {
  const config = {
    publicOrigin: env.PUBLIC_ORIGIN || undefined,
    password: env.APP_PASSWORD || undefined,
    host: env.API_HOST || '127.0.0.1',
  };
  validateAccess(config);
  return config;
}
function validateAccess(config: AccessConfig) {
  if (config.password && config.password.length < 16)
    throw new Error('APP_PASSWORD must contain at least 16 characters.');
  if (config.publicOrigin) {
    const url = new URL(config.publicOrigin);
    if (url.origin !== config.publicOrigin || url.protocol !== 'https:')
      throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path or trailing slash.');
    if (!config.password) throw new Error('PUBLIC_ORIGIN requires APP_PASSWORD.');
  }
  if (
    config.host &&
    !['127.0.0.1', '::1', 'localhost'].includes(config.host) &&
    !config.publicOrigin
  )
    throw new Error('Non-loopback listening requires PUBLIC_ORIGIN and APP_PASSWORD.');
}
export function registerAccess(app: FastifyInstance, config: AccessConfig = {}) {
  validateAccess(config);
  const salt = randomBytes(16);
  const passwordHash = config.password ? scryptSync(config.password, salt, 32) : null;
  const sessions = new Map<string, number>();
  const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
  const sessionToken = (cookie = '') =>
    /(?:^|;\s*)canvas_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1] || '';
  const valid = (cookie?: string) =>
    !passwordHash || (sessions.get(sessionHash(sessionToken(cookie))) || 0) > Date.now();
  const cookie = (token: string, age: number) =>
    `canvas_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.publicOrigin ? '; Secure' : ''}`;
  const localOrigins = [
    `http://127.0.0.1:${process.env.APP_PORT || 3000}`,
    `http://localhost:${process.env.APP_PORT || 3000}`,
    `http://127.0.0.1:${process.env.API_PORT || 3001}`,
    `http://localhost:${process.env.API_PORT || 3001}`,
  ];
  const origins = config.publicOrigin ? [config.publicOrigin] : localOrigins;
  const hosts = new Set(['127.0.0.1', 'localhost', 'localhost.localdomain', '[::1]']);
  if (config.publicOrigin) hosts.add(new URL(config.publicOrigin).hostname);
  let attempts = 0;
  let windowEnd = 0;
  app.addHook('onRequest', async (request, reply) => {
    let host = '';
    try {
      host = new URL(`http://${request.headers.host}`).hostname;
    } catch {
      /* reject below */
    }
    if (!hosts.has(host))
      return reply.code(403).send({ error: 'host_rejected', message: '不接受此主機名稱。' });
    if (request.headers.origin && !origins.includes(request.headers.origin))
      return reply.code(403).send({ error: 'origin_rejected', message: '不接受其他網站的請求。' });
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) &&
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(415).send({ error: 'json_required', message: '需要 JSON 請求。' });
    const path = request.url.split('?')[0];
    if (path.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (
        !['/api/health', '/api/session', '/api/session/login'].includes(path) &&
        !valid(request.headers.cookie)
      )
        return reply.code(401).send({ error: 'login_required', message: '請先登入工作區。' });
    }
  });
  app.get('/api/session', async (request) => ({
    required: !!passwordHash,
    authenticated: valid(request.headers.cookie),
  }));
  app.post('/api/session/login', async (request, reply) => {
    if (!passwordHash) return { ok: true };
    if (Date.now() >= windowEnd) {
      windowEnd = Date.now() + 60_000;
      attempts = 0;
    }
    if (++attempts > 10)
      return reply
        .header('Retry-After', '60')
        .code(429)
        .send({ error: 'rate_limited', message: '嘗試次數過多，請一分鐘後重試。' });
    const { password } = z
      .object({ password: z.string().max(1024) })
      .strict()
      .parse(request.body);
    if (!timingSafeEqual(scryptSync(password, salt, 32), passwordHash))
      return reply.code(401).send({ error: 'invalid_password', message: '工作區密碼不正確。' });
    for (const [key, expires] of sessions) if (expires <= Date.now()) sessions.delete(key);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!);
    const token = randomBytes(32).toString('hex');
    sessions.set(sessionHash(token), Date.now() + 12 * 60 * 60_000);
    return reply.header('Set-Cookie', cookie(token, 12 * 60 * 60)).send({ ok: true });
  });
  app.post('/api/session/logout', async (request, reply) => {
    sessions.delete(sessionHash(sessionToken(request.headers.cookie)));
    return reply.header('Set-Cookie', cookie('', 0)).send({ ok: true });
  });
  app.addHook('onClose', async () => {
    sessions.clear();
  });
}
