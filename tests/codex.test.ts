import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '@acc/db';
import { createApp } from '../apps/api/src/app';
import { DEFAULT_BUDGET, type ContextPackage } from '@acc/domain';
import { CodexProvider } from '../packages/model-gateway/src/codex';
import {
  CodexRpc,
  type CodexConnection,
  type RpcEvent,
} from '../packages/model-gateway/src/codex-rpc';
import { ProviderRegistry } from '../packages/model-gateway/src/registry';
const pkg: ContextPackage = {
  package_id: 'pkg',
  context_set_id: 'ctx',
  policy_version: 'context-policy-0.1',
  current_prompt: 'Explain context',
  graph_snapshot_version: 1,
  items: [],
  excluded: [{ node_id: 'excluded-secret-id', source_id: null, reason: 'explicitly excluded' }],
  conflicts: [],
  diagnostics: [],
  sendable: true,
  budget: { ...DEFAULT_BUDGET, used_context_tokens: 0, estimated_input_tokens: 1000 },
  trace: { resolved_candidates: 0, included_items: 0, deduplicated_items: 0 },
};
const answer = { answer: 'Safe answer 🌱', used_source_ids: [], suggested_graph_updates: [] };
class FakeCodex implements CodexConnection {
  calls: { method: string; params: object }[] = [];
  listeners = new Set<(event: RpcEvent) => void>();
  connected = true;
  response: unknown = answer;
  invalidTool = false;
  interrupted = false;
  rawFailure = false;
  closed = false;
  verificationUrl = 'https://auth.openai.com/codex/device';
  emit(method: string, params: Record<string, unknown>) {
    for (const listener of this.listeners) listener({ method, params });
  }
  async request<T>(method: string, params: object): Promise<T> {
    this.calls.push({ method, params });
    if (this.rawFailure) throw new Error('sensitive-auth-token');
    let result: unknown = {};
    if (method === 'account/read')
      result = {
        account: this.connected
          ? {
              type: 'chatgpt',
              email: 'test@example.test',
              planType: 'plus',
              accessToken: 'never-expose',
            }
          : null,
      };
    if (method === 'account/login/start')
      result = {
        type: 'chatgptDeviceCode',
        loginId: 'login1',
        verificationUrl: this.verificationUrl,
        userCode: 'ABCD-12345',
      };
    if (method === 'account/logout') this.connected = false;
    if (method === 'thread/start')
      result = { thread: { id: 'thread1' }, model: 'test-model', instructionSources: [] };
    if (method === 'turn/start') {
      if (this.invalidTool)
        this.emit('item/started', { threadId: 'thread1', item: { type: 'commandExecution' } });
      this.emit('item/agentMessage/delta', {
        threadId: 'other-thread',
        delta: 'private-other-thread',
      });
      this.emit('item/agentMessage/delta', {
        threadId: 'thread1',
        delta: JSON.stringify(this.response),
      });
      this.emit('item/completed', {
        threadId: 'thread1',
        item: { type: 'agentMessage', text: JSON.stringify(this.response), phase: 'final_answer' },
      });
      this.emit('turn/completed', {
        threadId: 'thread1',
        turn: { status: this.interrupted ? 'interrupted' : 'completed' },
      });
    }
    return result as T;
  }
  subscribe(listener: (event: RpcEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  close() {
    this.closed = true;
  }
}
describe('ChatGPT through official Codex protocol', () => {
  it('uses device authorization, whitelists returned fields and cancels/logout without reading tokens', async () => {
    const rpc = new FakeCodex();
    rpc.connected = false;
    const provider = new CodexProvider(rpc, 'test-model');
    expect((await provider.startLogin()).login.userCode).toBe('ABCD-12345');
    expect(rpc.calls.find((c) => c.method === 'account/login/start')?.params).toEqual({
      type: 'chatgptDeviceCode',
    });
    rpc.connected = true;
    rpc.emit('account/login/completed', { loginId: 'login1', success: true });
    const status = await provider.status();
    expect(status.connected).toBe(true);
    expect(status.login.status).toBe('complete');
    expect(JSON.stringify(status)).not.toContain('never-expose');
    expect(status.login.userCode).toBeUndefined();
    await provider.logout();
    expect((await provider.status()).connected).toBe(false);
    await provider.startLogin();
    await provider.cancelLogin();
    expect(rpc.calls.some((c) => c.method === 'account/login/cancel')).toBe(true);
    provider.close();
  });
  it('rejects unexpected authorization destinations and normalizes private provider errors', async () => {
    const rpc = new FakeCodex();
    rpc.verificationUrl = 'https://evil.test';
    const provider = new CodexProvider(rpc, 'test-model');
    await expect(provider.startLogin()).rejects.toThrow('無法開始');
    rpc.rawFailure = true;
    await expect(provider.generate(pkg)).rejects.toThrow('Codex 未返回有效回答');
    provider.close();
  });
  it('sends only compiled input in a fresh ephemeral thread and validates citations before persistence', async () => {
    const rpc = new FakeCodex();
    const provider = new CodexProvider(rpc, 'test-model');
    const drafts: string[] = [];
    expect(await provider.generate(pkg, (s) => drafts.push(s))).toEqual(answer);
    const start = rpc.calls.find((c) => c.method === 'thread/start')!.params;
    expect(start).toMatchObject({
      ephemeral: true,
      environments: [],
      dynamicTools: [],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: { 'features.shell_tool': false, 'features.apps': false, web_search: 'disabled' },
    });
    const turn = JSON.stringify(rpc.calls.find((c) => c.method === 'turn/start')!.params);
    expect(turn).toContain('Explain context');
    expect(turn).not.toContain('excluded-secret-id');
    expect(drafts).toEqual([answer.answer]);
    expect(rpc.calls.at(-1)?.method).toBe('thread/unsubscribe');
    rpc.response = { ...answer, used_source_ids: ['invented'] };
    await expect(provider.generate(pkg)).rejects.toThrow('未提供的来源');
    expect(rpc.closed).toBe(true);
    provider.close();
  });
  it('rejects missing login, tool execution and interrupted turns', async () => {
    for (const scenario of ['signed-out', 'tool', 'interrupted']) {
      const rpc = new FakeCodex();
      rpc.connected = scenario !== 'signed-out';
      rpc.invalidTool = scenario === 'tool';
      rpc.interrupted = scenario === 'interrupted';
      const provider = new CodexProvider(rpc, 'test-model');
      await expect(provider.generate(pkg)).rejects.toThrow();
      if (scenario === 'signed-out')
        expect(rpc.calls.some((c) => c.method === 'turn/start')).toBe(false);
      provider.close();
    }
  });
  it('persists selected mode without credentials and rejects unauthenticated Codex selection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-model-test-'));
    const rpc = new FakeCodex();
    const provider = new CodexProvider(rpc, 'test-model');
    const path = join(directory, 'settings.json');
    const registry = new ProviderRegistry(path, {}, provider);
    try {
      await registry.select('codex');
      expect(registry.name).toBe('codex');
      const restored = new ProviderRegistry(path, {}, provider);
      expect(restored.name).toBe('codex');
      rpc.connected = false;
      await expect(registry.select('codex')).rejects.toThrow('完成 ChatGPT');
    } finally {
      registry.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('connects the HTTP model controls to generation and saves Codex provenance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-codex-api-'));
    const rpc = new FakeCodex();
    const codex = new CodexProvider(rpc, 'test-model');
    const registry = new ProviderRegistry(join(directory, 'settings.json'), {}, codex);
    const store = new Store(':memory:');
    const app = createApp(store, registry, { models: registry });
    const post = (url: string, payload: object = {}) =>
      app.inject({ method: 'POST', url, payload });
    try {
      rpc.connected = false;
      expect((await post('/api/models/select', { provider: 'codex' })).statusCode).toBe(409);
      expect((await post('/api/models/codex/login')).json().login.status).toBe('pending');
      rpc.connected = true;
      rpc.emit('account/login/completed', { loginId: 'login1', success: true });
      expect((await post('/api/models/select', { provider: 'codex' })).statusCode).toBe(200);
      const conversation = (await post('/api/conversations', { title: 'Account test' })).json();
      const compiled = (
        await post('/api/compile', {
          conversation_id: conversation.conversation.id,
          prompt: 'Account answer',
          selected_node_ids: [],
        })
      ).json();
      const response = await post('/api/answer', { context_set_id: compiled.context_set.id });
      expect(response.body).toContain('"type":"complete"');
      const state = (await app.inject('/api/state')).json();
      expect(state.provider).toMatchObject({ name: 'codex', model: 'test-model', demo: false });
      expect(
        state.turns.find((turn: { actor: string }) => turn.actor === 'assistant'),
      ).toMatchObject({
        model_provider: 'codex',
        model_id: 'test-model',
        input_context_set_id: compiled.context_set.id,
        status: 'complete',
      });
      expect((await post('/api/models/codex/logout')).json().connected).toBe(false);
      expect((await post('/api/models/select', { provider: 'demo' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await registry.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('initializes the pinned official binary using a new empty application home, without account or model calls', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'canvas-codex-smoke-'));
    const rpc = new CodexRpc(directory);
    try {
      const response = await rpc.request<{ account: unknown }>('account/read', {
        refreshToken: false,
      });
      expect(response.account).toBeNull();
    } finally {
      await rpc.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15000);
});
