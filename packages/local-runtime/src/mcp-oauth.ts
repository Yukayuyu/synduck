import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { DomainError } from '@acc/domain';

export type ConnectionState = {
  id: string;
  name: string;
  phase: 'disconnected' | 'preparing' | 'waiting' | 'connected' | 'error';
  authorization_url?: string;
  message?: string;
};
type Saved = {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
  api_key?: string;
};
type Entry = {
  id: string;
  url: string;
  name: string;
  key: string;
  saved: Saved;
  active: boolean;
  provider: OAuthClientProvider;
  verifier?: string;
  state?: string;
  authorization_url?: string;
  created?: number;
  phase: ConnectionState['phase'];
  message?: string;
};
const failure = () =>
  new DomainError('connection_login_required', '请先完成这个服务的网页登录。', 409);
export const oauthFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.username ||
    url.password ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    )
  )
    throw failure();
  return fetch(input, {
    ...init,
    redirect: 'error',
    signal: init?.signal || AbortSignal.timeout(20000),
  });
};
export class McpAuthorization {
  private entries = new Map<string, Entry>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly directory: string,
    readonly redirectUrl: string,
    private readonly transport: typeof fetch = oauthFetch,
  ) {}
  private key(id: string, url: string) {
    return createHash('sha256')
      .update(id + '\0' + url + '\0' + this.redirectUrl)
      .digest('hex');
  }
  private save(entry: Entry) {
    const snapshot = JSON.stringify(entry.saved);
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        if (!entry.active || this.entries.get(entry.key) !== entry) throw failure();
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, entry.key + '.json');
        const temporary = path + '.' + randomUUID() + '.tmp';
        await fs.writeFile(temporary, snapshot, { mode: 0o600 });
        await fs.rename(temporary, path);
        if (!entry.active) throw failure();
      });
    this.writes = work;
    return work;
  }
  async entry(id: string, url: string, name: string) {
    const key = this.key(id, url);
    const existing = this.entries.get(key);
    if (existing) return existing;
    let saved: Saved = {};
    try {
      saved = JSON.parse(await fs.readFile(join(this.directory, key + '.json'), 'utf8'));
    } catch {
      /* New service. */
    }
    const entry = {
      id,
      url,
      name,
      key,
      saved,
      active: true,
      phase: saved.tokens || saved.api_key ? 'connected' : 'disconnected',
    } as Entry;
    const begin = () => {
      if (!entry.state || Date.now() - (entry.created || 0) > 10 * 60 * 1000) {
        entry.state = randomBytes(32).toString('hex');
        entry.created = Date.now();
      }
      return entry.state;
    };
    entry.provider = {
      redirectUrl: this.redirectUrl,
      clientMetadata: {
        client_name: 'Synduck',
        redirect_uris: [this.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      state: begin,
      clientInformation: () => entry.saved.client,
      saveClientInformation: async (client) => {
        entry.saved.client = client;
        await this.save(entry);
      },
      tokens: () => entry.saved.tokens,
      saveTokens: async (tokens) => {
        entry.saved.tokens = tokens;
        await this.save(entry);
        entry.phase = 'connected';
        entry.authorization_url = undefined;
      },
      saveCodeVerifier: (verifier) => {
        entry.verifier = verifier;
      },
      codeVerifier: () => {
        if (!entry.verifier) throw failure();
        return entry.verifier;
      },
      redirectToAuthorization: (authorization) => {
        if (
          authorization.protocol !== 'https:' &&
          !['127.0.0.1', 'localhost', '[::1]'].includes(authorization.hostname)
        )
          throw failure();
        if (authorization.username || authorization.password) throw failure();
        begin();
        entry.authorization_url = authorization.href;
        entry.phase = 'waiting';
      },
      saveDiscoveryState: async (discovery) => {
        entry.saved.discovery = discovery;
        await this.save(entry);
      },
      discoveryState: () => entry.saved.discovery,
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'client') delete entry.saved.client;
        if (scope === 'all' || scope === 'tokens') delete entry.saved.tokens;
        if (scope === 'all' || scope === 'discovery') delete entry.saved.discovery;
        if (scope === 'all' || scope === 'verifier') entry.verifier = undefined;
        await this.save(entry);
      },
    };
    this.entries.set(key, entry);
    return entry;
  }
  status(id: string, url: string, name: string): ConnectionState {
    const entry = this.entries.get(this.key(id, url));
    if (entry?.phase === 'waiting' && Date.now() - (entry.created || 0) > 10 * 60 * 1000) {
      entry.phase = 'error';
      entry.message = '登录已过期，请重新连接。';
      entry.state = undefined;
      entry.authorization_url = undefined;
      entry.verifier = undefined;
    }
    return {
      id,
      name,
      phase: entry?.phase || 'disconnected',
      authorization_url: entry?.authorization_url,
      message: entry?.message,
    };
  }
  async prepare(id: string, url: string, name: string) {
    const entry = await this.entry(id, url, name);
    entry.message = undefined;
    if (entry.phase === 'waiting' && entry.authorization_url) return;
    entry.phase = 'preparing';
    try {
      await auth(entry.provider, { serverUrl: url, fetchFn: this.transport });
    } catch {
      entry.phase = 'error';
      entry.message = '这个服务暂时无法自动登录。请确认服务地址，或稍后重试。';
    }
  }
  async callback(state: string, code?: string, error?: string) {
    const entry = [...this.entries.values()].find(
      (entry) =>
        entry.state === state &&
        entry.phase === 'waiting' &&
        Date.now() - (entry.created || 0) < 10 * 60 * 1000,
    );
    if (!entry) throw failure();
    // Single-use state: a repeated callback cannot exchange a code again.
    entry.state = undefined;
    entry.authorization_url = undefined;
    if (error || !code) {
      entry.phase = 'error';
      entry.message = '你未完成授权，可以重新连接。';
      entry.verifier = undefined;
      return entry.id;
    }
    try {
      await auth(entry.provider, {
        serverUrl: entry.url,
        authorizationCode: code,
        fetchFn: this.transport,
      });
      entry.phase = 'connected';
    } catch {
      entry.phase = 'error';
      entry.message = '登录未完成或已过期，请重新连接。';
    } finally {
      entry.verifier = undefined;
    }
    return entry.id;
  }
  async setKey(id: string, url: string, name: string, key: string) {
    const entry = await this.entry(id, url, name);
    entry.saved = { api_key: key };
    entry.phase = 'connected';
    entry.state = undefined;
    entry.authorization_url = undefined;
    await this.save(entry);
  }
  async forget(id: string, url: string) {
    const key = this.key(id, url);
    const entry = this.entries.get(key);
    if (entry) entry.active = false;
    this.entries.delete(key);
    const work = this.writes
      .catch(() => {})
      .then(() => fs.rm(join(this.directory, key + '.json'), { force: true }));
    this.writes = work;
    await work;
  }
}
