import { describe, expect, it } from 'vitest';
import { Store } from '@acc/db';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
import { accessConfig } from '../apps/api/src/access';
const password = 'test-only-workspace-password';
const origin = 'https://canvas.example.test';

describe('protected cross-device workspace', () => {
  it('fails closed for unsafe deployment configuration', () => {
    expect(() => accessConfig({ API_HOST: '0.0.0.0' })).toThrow();
    expect(() => accessConfig({ PUBLIC_ORIGIN: origin })).toThrow();
    expect(() =>
      accessConfig({ PUBLIC_ORIGIN: 'http://canvas.test', APP_PASSWORD: password }),
    ).toThrow();
    expect(() => accessConfig({ APP_PASSWORD: 'short' })).toThrow();
    expect(
      accessConfig({ PUBLIC_ORIGIN: origin, APP_PASSWORD: password, API_HOST: '0.0.0.0' }).host,
    ).toBe('0.0.0.0');
  });
  it('protects data, backups and model login; supports secure cookies, CSRF rejection and logout', async () => {
    const store = new Store(':memory:');
    const app = createApp(store, new DemoProvider(), {
      access: { publicOrigin: origin, password },
    });
    const headers = { host: 'canvas.example.test', origin };
    try {
      for (const url of [
        '/api/state',
        '/api/project/export',
        '/api/project/recovery',
        '/api/models',
        '/api/models/codex/models',
      ])
        expect((await app.inject({ url, headers })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: '/api/models/codex/login', headers, payload: {} }))
          .statusCode,
      ).toBe(401);
      expect((await app.inject({ url: '/api/session', headers })).json()).toEqual({
        required: true,
        authenticated: false,
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/session/login',
            headers,
            payload: { password: 'wrong' },
          })
        ).statusCode,
      ).toBe(401);
      const login = await app.inject({
        method: 'POST',
        url: '/api/session/login',
        headers,
        payload: { password },
      });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers['set-cookie'] as string;
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      const cookie = setCookie.split(';')[0];
      expect(cookie).not.toContain(password);
      const authorized = { ...headers, cookie };
      expect((await app.inject({ url: '/api/state', headers: authorized })).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/conversations',
            headers: { ...authorized, origin: 'https://evil.test' },
            payload: { title: 'forged' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ url: '/api/state', headers: { ...authorized, host: 'evil.test' } }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/session/logout',
            headers: authorized,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject({ url: '/api/state', headers: authorized })).statusCode).toBe(401);
      for (let i = 0; i < 9; i++)
        await app.inject({
          method: 'POST',
          url: '/api/session/login',
          headers,
          payload: { password: 'wrong' },
        });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/session/login',
            headers,
            payload: { password },
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
      store.close();
    }
  });
});
