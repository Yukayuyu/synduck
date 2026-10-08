import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
  failure: unknown = null;
  retryError: unknown = null;
  turnRejected = false;
  notificationOnly = false;
  passiveItem = '';
  silent = false;
  errorNotification = true;
  messagePhase = 'final_answer';
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
      if (this.turnRejected) throw this.failure;
      if (this.silent) return {} as T;
      if (this.retryError)
        this.emit('error', {
          threadId: 'thread1',
          turnId: 'turn1',
          error: this.retryError,
          willRetry: true,
        });
      if (this.failure) {
        this.emit('error', {
          threadId: 'other-thread',
          turnId: 'turn1',
          error: { codexErrorInfo: 'unauthorized' },
          willRetry: false,
        });
        if (this.errorNotification)
          this.emit('error', {
            threadId: 'thread1',
            turnId: 'turn1',
            error: this.failure,
            willRetry: false,
          });
        this.emit('turn/completed', {
          threadId: 'thread1',
          turn: { status: 'failed', error: this.failure },
        });
        return {} as T;
      }
      if (this.passiveItem)
        this.emit('item/started', { threadId: 'thread1', item: { type: this.passiveItem } });
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
      if (!this.notificationOnly)
        this.emit('item/completed', {
          threadId: 'thread1',
          item: {
            type: 'agentMessage',
            text: JSON.stringify(this.response),
            phase: this.messagePhase,
          },
        });
      this.emit('turn/completed', {
        threadId: 'thread1',
        turn: { status: this.interrupted ? 'interrupted' : 'completed' },
        ...(this.notificationOnly
          ? {
              turn: {
                status: 'completed',
                items: [
                  {
                    type: 'agentMessage',
                    text: JSON.stringify(this.response),
                    phase: this.messagePhase,
                  },
                ],
              },
            }
          : {}),
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
  it('distinguishes upstream auth, quota, network and RPC failures without exposing private error text', async () => {
    const cases = [
      [{ codexErrorInfo: 'unauthorized' }, 'codex_auth_expired'],
      [{ codexErrorInfo: 'usageLimitExceeded' }, 'codex_usage_limit'],
      [{ codexErrorInfo: 'rateLimitExceeded' }, 'codex_rate_limit'],
      [
        { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 403 } } },
        'codex_access_denied',
      ],
      [
        { codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } },
        'codex_connection_failed',
      ],
      [
        { message: 'Invalid schema for response_format: sensitive-auth-token' },
        'codex_schema_rejected',
      ],
      [{ message: 'Model is not supported: sensitive-auth-token' }, 'codex_model_unavailable'],
      [{ code: -32602 }, 'codex_request_rejected'],
    ] as const;
    for (const [metadata, code] of cases) {
      const rpc = new FakeCodex();
      rpc.failure = {
        message: 'sensitive-auth-token',
        additionalDetails: 'private-provider-body',
        ...metadata,
      };
      const provider = new CodexProvider(rpc, 'test-model');
      try {
        await expect(provider.generate(pkg)).rejects.toMatchObject({ code });
        expect(provider.diagnostics().last_failure).toMatchObject({ code, stage: 'generation' });
        expect(JSON.stringify(provider.diagnostics())).not.toMatch(
          /sensitive-auth-token|private-provider-body/,
        );
        expect(rpc.closed).toBe(true);
      } finally {
        await provider.close();
      }
    }
    const rpc = new FakeCodex();
    rpc.turnRejected = true;
    rpc.failure = { code: -32602, message: 'sensitive-auth-token' };
    const provider = new CodexProvider(rpc, 'test-model');
    await expect(provider.generate(pkg)).rejects.toMatchObject({ code: 'codex_request_rejected' });
    expect(provider.diagnostics().last_failure?.stage).toBe('turn/start');
    await provider.close();
  });
  it('accepts passive protocol items and complete final payloads while retaining tool rejection', async () => {
    for (const type of ['plan', 'contextCompaction']) {
      const rpc = new FakeCodex();
      rpc.passiveItem = type;
      rpc.notificationOnly = true;
      const provider = new CodexProvider(rpc, 'test-model');
      expect(await provider.generate(pkg)).toEqual(answer);
      expect(provider.diagnostics().last_failure).toBeNull();
      await provider.close();
    }
    const rpc = new FakeCodex();
    rpc.invalidTool = true;
    const provider = new CodexProvider(rpc, 'test-model');
    await expect(provider.generate(pkg)).rejects.toMatchObject({ code: 'codex_tool_blocked' });
    await provider.close();
  });
  it('reads a failed turn payload even when no error notification was received', async () => {
    const rpc = new FakeCodex();
    rpc.errorNotification = false;
    rpc.failure = { codexErrorInfo: 'badRequest', message: 'Invalid schema: sensitive-auth-token' };
    const provider = new CodexProvider(rpc, 'test-model');
    try {
      await expect(provider.generate(pkg)).rejects.toMatchObject({ code: 'codex_schema_rejected' });
      expect(JSON.stringify(provider.diagnostics())).not.toContain('sensitive-auth-token');
    } finally {
      await provider.close();
    }
  });
  it('never saves a commentary message as the final structured answer', async () => {
    const rpc = new FakeCodex();
    rpc.messagePhase = 'commentary';
    const provider = new CodexProvider(rpc, 'test-model');
    try {
      await expect(provider.generate(pkg)).rejects.toMatchObject({
        code: 'codex_invalid_response',
      });
      expect(rpc.closed).toBe(true);
    } finally {
      await provider.close();
    }
  });
  it('waits for retryable provider errors but distinguishes the three minute generation deadline', async () => {
    const rpc = new FakeCodex();
    rpc.retryError = {
      codexErrorInfo: { httpConnectionFailed: { httpStatusCode: null } },
      message: 'private-provider-body',
    };
    const provider = new CodexProvider(rpc, 'test-model');
    expect(await provider.generate(pkg)).toEqual(answer);
    expect(provider.diagnostics().last_retry?.code).toBe('codex_connection_failed');
    await provider.close();
    vi.useFakeTimers();
    const silent = new FakeCodex();
    silent.silent = true;
    const timed = new CodexProvider(silent, 'test-model');
    try {
      const result = expect(timed.generate(pkg)).rejects.toMatchObject({
        code: 'codex_generation_timeout',
      });
      await vi.advanceTimersByTimeAsync(180_000);
      await result;
      expect(timed.diagnostics().last_failure).toMatchObject({
        elapsed_ms: 180_000,
        stage: 'generation',
      });
    } finally {
      vi.useRealTimers();
      await timed.close();
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
      rpc.failure = { codexErrorInfo: 'usageLimitExceeded', message: 'sensitive-auth-token' };
      rpc.connected = true;
      await registry.select('codex');
      const next = (
        await post('/api/compile', {
          conversation_id: conversation.conversation.id,
          prompt: 'Diagnose failure',
          selected_node_ids: [],
        })
      ).json();
      const failed = await post('/api/answer', { context_set_id: next.context_set.id });
      expect(failed.body).toContain('"code":"codex_usage_limit"');
      const diagnostics = await app.inject('/api/models/codex/diagnostics');
      expect(diagnostics.headers['cache-control']).toBe('no-store');
      expect(diagnostics.json().last_failure).toMatchObject({
        code: 'codex_usage_limit',
        stage: 'generation',
      });
      expect(diagnostics.body).not.toMatch(/sensitive-auth-token|never-expose|test@example/);
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
      await expect(rpc.request('canvas/not-a-method', {})).rejects.toMatchObject({
        code: 'codex_request_rejected',
      });
    } finally {
      await rpc.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15000);
});
