import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { testMcpServer } from '../fixtures/mcp-server';

export async function oauthMcpFixture() {
  const clients = new Map<string, string[]>();
  const codes = new Map<string, { challenge: string; client: string }>();
  let token = 'fixture-access-' + randomUUID();
  const refresh = 'fixture-refresh-' + randomUUID();
  let base = '';
  const events: { path: string; authorization?: string }[] = [];
  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, base);
      events.push({ path: url.pathname, authorization: request.headers.authorization });
      const send = (value: unknown, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (url.pathname.includes('oauth-protected-resource'))
        return send({
          resource: base + '/mcp',
          authorization_servers: [base],
          scopes_supported: ['read', 'write'],
        });
      if (
        url.pathname.includes('oauth-authorization-server') ||
        url.pathname.includes('openid-configuration')
      )
        return send({
          issuer: base,
          authorization_endpoint: base + '/authorize',
          token_endpoint: base + '/token',
          registration_endpoint: base + '/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      if (url.pathname === '/register') {
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = JSON.parse(text);
        const id = randomUUID();
        clients.set(id, body.redirect_uris);
        return send(
          { ...body, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) },
          201,
        );
      }
      if (url.pathname === '/authorize') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><html><meta charset="utf-8"><h1>测试网页登录</h1><p>这是隔离的授权测试，不会连接真实账号。</p><a href="/allow?' +
            url.searchParams.toString().replaceAll('&', '&amp;') +
            '">允许这次测试登录</a></html>',
        );
        return;
      }
      if (url.pathname === '/allow') {
        const p = url.searchParams;
        const client = p.get('client_id')!;
        const redirect = p.get('redirect_uri')!;
        if (!clients.get(client)?.includes(redirect) || !p.get('code_challenge'))
          return send({ error: 'invalid_request' }, 400);
        const code = randomUUID();
        codes.set(code, { client, challenge: p.get('code_challenge')! });
        const location = new URL(redirect);
        location.searchParams.set('code', code);
        location.searchParams.set('state', p.get('state')!);
        response.writeHead(302, { location: location.href });
        response.end();
        return;
      }
      if (url.pathname === '/token') {
        let text = '';
        for await (const chunk of request) text += chunk;
        const body = new URLSearchParams(text);
        if (body.get('grant_type') === 'refresh_token') {
          if (body.get('refresh_token') !== refresh) return send({ error: 'invalid_grant' }, 400);
          token = 'fixture-access-' + randomUUID();
        } else {
          const code = codes.get(body.get('code')!);
          codes.delete(body.get('code')!);
          if (
            !code ||
            code.client !== body.get('client_id') ||
            code.challenge !==
              createHash('sha256')
                .update(body.get('code_verifier') || '')
                .digest('base64url')
          )
            return send({ error: 'invalid_grant' }, 400);
        }
        return send({
          access_token: token,
          refresh_token: refresh,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read write',
        });
      }
      if (url.pathname === '/mcp') {
        if (request.headers.authorization !== 'Bearer ' + token) {
          response.setHeader(
            'WWW-Authenticate',
            'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource"',
          );
          return send({ error: 'unauthorized' }, 401);
        }
        const server = testMcpServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        response.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(request, response);
        return;
      }
      return send({ error: 'missing' }, 404);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + (http.address() as { port: number }).port;
  return {
    url: base + '/mcp',
    events,
    token: () => token,
    expire: () => {
      token = 'expired-' + randomUUID();
    },
    close: () =>
      new Promise<void>((done) => {
        http.closeAllConnections();
        http.close(() => done());
      }),
  };
}
