import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_BUDGET, modelInput, ANSWER_INSTRUCTIONS, type ContextPackage } from '@acc/domain';
import { Store } from '@acc/db';
import {
  ClaudeProvider,
  DEFAULT_CLAUDE_MODEL,
  type ClaudeClient,
} from '../packages/model-gateway/src/claude';
import { ProviderRegistry } from '../packages/model-gateway/src/registry';
import { createApp } from '../apps/api/src/app';

const KEY = 'sk-ant-test-0123456789abcdefghij';
const pkg: ContextPackage = {
  package_id: 'pkg_1',
  context_set_id: 'set_1',
  policy_version: 'context-policy-0.1',
  current_prompt: 'What next?',
  graph_snapshot_version: 1,
  items: [
    {
      source_type: 'content_block',
      source_id: 'block_1',
      node_id: 'node_1',
      source_block_id: 'block_1',
      actor: 'human',
      sequence: 1,
      role: 'current',
      state: 'active',
      content: 'Stay local-first.',
      content_hash: `sha256:${'a'.repeat(64)}`,
      score: 0.85,
      reason: 'current',
      token_estimate: 17,
      compressed: false,
    },
  ],
  excluded: [],
  conflicts: [],
  diagnostics: [],
  sendable: true,
  budget: { ...DEFAULT_BUDGET, used_context_tokens: 17, estimated_input_tokens: 1000 },
  trace: { resolved_candidates: 1, included_items: 1, deduplicated_items: 0 },
};
// A stand-in for the SDK client: records requests and replays a scripted reply.
function fake(reply: { text?: string; stop_reason?: string; error?: unknown; models?: string[] }) {
  const calls: { key: string; body?: Record<string, unknown>; listed?: boolean }[] = [];
  const create = (key: string): ClaudeClient =>
    ({
      models: {
        list: () => {
          calls.push({ key, listed: true });
          if (reply.error) return Promise.reject(reply.error);
          const data = (reply.models ?? [DEFAULT_CLAUDE_MODEL]).map((id) => ({
            id,
            display_name: id.toUpperCase(),
          }));
          return Object.assign(Promise.resolve({ data }), {
            async *[Symbol.asyncIterator]() {
              yield* data;
            },
          });
        },
      },
      beta: {
        messages: {
          stream: (body: Record<string, unknown>) => {
            calls.push({ key, body });
            const listeners: ((delta: string) => void)[] = [];
            return {
              on: (_event: string, listener: (delta: string) => void) => listeners.push(listener),
              finalMessage: async () => {
                if (reply.error) throw reply.error;
                const text = reply.text ?? '';
                for (let i = 0; i < text.length; i += 12)
                  listeners.forEach((listener) => listener(text.slice(i, i + 12)));
                return {
                  stop_reason: reply.stop_reason ?? 'end_turn',
                  content: [
                    { type: 'thinking', thinking: '' },
                    { type: 'text', text },
                  ],
                };
              },
            };
          },
        },
      },
    }) as unknown as ClaudeClient;
  return { calls, create };
}
const answer = {
  answer: 'Keep it local.',
  used_source_ids: ['block_1'],
  suggested_graph_updates: [],
};
const workspace = () => mkdtempSync(join(tmpdir(), 'claude-provider-'));

describe('Claude API mode', () => {
  it('verifies and stores a key privately, then reuses it after restart', async () => {
    const directory = workspace();
    const path = join(directory, 'claude', 'credentials.json');
    const client = fake({});
    try {
      const provider = new ClaudeProvider(path, '', '', client.create);
      expect(provider.status()).toEqual({
        connected: false,
        source: null,
        key_hint: null,
        model: DEFAULT_CLAUDE_MODEL,
      });
      await expect(provider.generate(pkg)).rejects.toMatchObject({
        code: 'provider_not_configured',
      });
      await expect(provider.connect('short')).rejects.toMatchObject({ code: 'claude_key_invalid' });
      expect(client.calls).toHaveLength(0);
      const status = await provider.connect(`  ${KEY}\n`);
      expect(status).toEqual({
        connected: true,
        source: 'saved',
        key_hint: 'ghij',
        model: DEFAULT_CLAUDE_MODEL,
      });
      expect(JSON.stringify(status)).not.toContain(KEY);
      expect(client.calls).toEqual([{ key: KEY, listed: true }]);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ api_key: KEY });
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(new ClaudeProvider(path, '', '', client.create).status().connected).toBe(true);
      provider.disconnect();
      expect(existsSync(path)).toBe(false);
      // A server-side environment key is used when nothing was saved.
      expect(new ClaudeProvider(path, '', KEY, client.create).status()).toMatchObject({
        connected: true,
        source: 'environment',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not store a key the API rejects', async () => {
    const directory = workspace();
    const path = join(directory, 'credentials.json');
    try {
      const rejected = new Anthropic.AuthenticationError(
        401,
        undefined,
        'invalid x-api-key',
        new Headers(),
      );
      const provider = new ClaudeProvider(path, '', '', fake({ error: rejected }).create);
      const failure = await provider.connect(KEY).catch((error) => error);
      expect(failure).toMatchObject({ code: 'claude_key_rejected', statusCode: 401 });
      expect(failure.message).not.toContain('x-api-key');
      expect(existsSync(path)).toBe(false);
      expect(provider.status().connected).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('sends the sealed context with a structured answer format and validates the reply', async () => {
    const directory = workspace();
    try {
      const client = fake({ text: JSON.stringify(answer) });
      const provider = new ClaudeProvider(
        join(directory, 'c.json'),
        'claude-sonnet-5-5',
        KEY,
        client.create,
      );
      const drafts: string[] = [];
      expect(await provider.generate(pkg, (text) => drafts.push(text))).toEqual(answer);
      expect(drafts.at(-1)).toBe('Keep it local.');
      const body = client.calls[0].body!;
      expect(body.model).toBe('claude-sonnet-5-5');
      expect(body.system).toBe(ANSWER_INSTRUCTIONS);
      expect(body.messages).toEqual([{ role: 'user', content: modelInput(pkg) }]);
      expect(body.fallbacks).toBe('default');
      expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
      // No sampling or fixed thinking budget: current models reject them.
      for (const removed of ['temperature', 'top_p', 'top_k', 'thinking'])
        expect(body).not.toHaveProperty(removed);

      const cases: [Parameters<typeof fake>[0], string][] = [
        [
          { text: JSON.stringify({ ...answer, used_source_ids: ['other'] }) },
          'invalid_model_sources',
        ],
        [{ text: 'not json' }, 'invalid_model_output'],
        [{ text: '', stop_reason: 'refusal' }, 'model_refused'],
        [{ text: '{"answer":"cut', stop_reason: 'max_tokens' }, 'model_incomplete'],
        [
          { error: new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()) },
          'claude_rate_limited',
        ],
        [{ error: new Error(`socket closed for ${KEY}`) }, 'model_unavailable'],
      ];
      for (const [reply, code] of cases) {
        const failure = await new ClaudeProvider(
          join(directory, 'c.json'),
          '',
          KEY,
          fake(reply).create,
        )
          .generate(pkg)
          .catch((error) => error);
        expect(failure).toMatchObject({ code });
        expect(failure.message).not.toContain(KEY);
      }
      const controller = new AbortController();
      controller.abort();
      await expect(
        new ClaudeProvider(
          join(directory, 'c.json'),
          '',
          KEY,
          fake({ error: new Error('aborted') }).create,
        ).generate(pkg, undefined, controller.signal),
      ).rejects.toMatchObject({ code: 'generation_cancelled' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('selects the mode and model through the registry and API without exposing the key', async () => {
    const directory = workspace();
    const settings = join(directory, 'settings.json');
    const client = fake({
      text: JSON.stringify({ answer: 'ok', used_source_ids: [], suggested_graph_updates: [] }),
      models: ['claude-opus-5-5', 'claude-haiku-5-5'],
    });
    const claude = new ClaudeProvider(
      join(directory, 'claude', 'credentials.json'),
      '',
      '',
      client.create,
    );
    const registry = new ProviderRegistry(settings, {}, undefined, claude);
    const store = new Store(':memory:');
    const app = createApp(store, registry, { models: registry });
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    try {
      expect((await post('/api/models/select', { provider: 'claude' })).statusCode).toBe(409);
      const connected = await post('/api/models/claude/connect', { api_key: KEY });
      expect(connected.statusCode).toBe(200);
      expect(connected.body).not.toContain(KEY);
      const listed = await app.inject({ method: 'GET', url: '/api/models/claude' });
      expect(listed.json()).toMatchObject({ connected: true, key_hint: 'ghij', live: true });
      expect(listed.json().models.map((m: { model: string }) => m.model)).toEqual([
        'claude-opus-5-5',
        'claude-haiku-5-5',
      ]);
      expect(listed.body).not.toContain(KEY);
      expect(
        (await post('/api/models/select', { provider: 'claude', model: 'claude-missing' }))
          .statusCode,
      ).toBe(409);
      const selected = await post('/api/models/select', {
        provider: 'claude',
        model: 'claude-haiku-5-5',
      });
      expect(selected.json()).toEqual({ provider: 'claude', model: 'claude-haiku-5-5' });
      expect(JSON.parse(readFileSync(settings, 'utf8'))).toEqual({
        provider: 'claude',
        claude_model: 'claude-haiku-5-5',
      });
      expect(readFileSync(settings, 'utf8')).not.toContain(KEY);
      const restored = new ProviderRegistry(
        settings,
        {},
        undefined,
        new ClaudeProvider(join(directory, 'claude', 'credentials.json'), '', '', client.create),
      );
      expect([restored.name, restored.model]).toEqual(['claude', 'claude-haiku-5-5']);
      await restored.close();
      expect((await app.inject({ method: 'GET', url: '/api/state' })).body).not.toContain(KEY);
      const off = await post('/api/models/claude/disconnect', {});
      expect(off.json()).toMatchObject({ connected: false });
      expect(registry.name).toBe('demo');
    } finally {
      await app.close();
      await registry.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
