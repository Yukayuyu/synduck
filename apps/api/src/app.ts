import Fastify from 'fastify';
import { z } from 'zod';
import {
  CreateConversationSchema,
  CreateExcerptSchema,
  CompileRequestSchema,
  DomainError,
  ViewportSchema,
  ContextStateSchema,
  Id,
  type ContextSet,
} from '@acc/domain';
import {
  Store,
  id,
  now,
  exportProject,
  previewProject,
  importProject,
  listRecoverySnapshots,
  recoveryProject,
} from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import { type ModelProvider } from '@acc/model-gateway';
import { ProviderRegistry, ProviderMode } from '../../../packages/model-gateway/src/registry';
import { ReasoningEffort } from '../../../packages/model-gateway/src/codex';
import { registerAccess, type AccessConfig } from './access';
import { registerRuntime, type UpdateService } from './runtime';
import type { LocalExecutor } from '../../../packages/local-runtime/src/executor';
import packageJson from '../../../package.json';

export function createApp(
  store: Store,
  provider: ModelProvider,
  options: {
    access?: AccessConfig;
    models?: ProviderRegistry;
    local?: LocalExecutor;
    updates?: UpdateService;
  } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  registerAccess(app, options.access);
  registerRuntime(app, store, options.local, options.updates);
  const idle = () => {
    if (options.local?.busy || store.snapshot().turns.some((turn) => turn.status === 'streaming'))
      throw new DomainError('generation_active', '回答正在生成，請完成後再變更模型或登入。', 409);
  };
  app.get('/api/models', async () => ({
    provider: provider.name,
    model: provider.model,
    codex_available: !!options.models,
  }));
  if (options.models) {
    const models = options.models;
    app.get('/api/models/codex', async () => models.codex.status());
    app.get('/api/models/codex/models', async (_request, reply) =>
      reply.header('Cache-Control', 'no-store').send(await models.codex.listModels()),
    );
    app.get('/api/models/codex/diagnostics', async (_request, reply) =>
      reply.header('Cache-Control', 'no-store').send(models.codex.diagnostics()),
    );
    app.post('/api/models/codex/login', async () => {
      idle();
      return models.codex.startLogin();
    });
    app.post('/api/models/codex/cancel', async () => {
      idle();
      return models.codex.cancelLogin();
    });
    app.post('/api/models/codex/logout', async () => {
      idle();
      return models.codex.logout();
    });
    app.post('/api/models/select', async (request) => {
      idle();
      const {
        provider: mode,
        model,
        reasoning_effort: reasoningEffort,
      } = z
        .object({
          provider: ProviderMode,
          model: z.string().trim().min(1).max(256).optional(),
          reasoning_effort: ReasoningEffort.nullable().optional(),
        })
        .strict()
        .parse(request.body);
      return models.select(mode, model, reasoningEffort);
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 413)
      return reply
        .code(413)
        .send({ error: 'payload_too_large', message: '文件过大，项目备份上限为 12 MiB。' });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: '请求格式无效，请检查输入。' });
    if (error instanceof DomainError)
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    // Never return provider payloads, database paths, SQL or key material.
    return reply
      .code(500)
      .send({ error: 'internal_error', message: '操作失败，请重试。已有内容仍保存在本地。' });
  });
  app.get('/api/health', async () => ({
    ok: true,
    service: 'context-canvas',
    schema_version: '0.1.0',
    version: packageJson.version,
    instance_id: process.env.CANVAS_INSTANCE_ID || null,
  }));
  app.get('/api/state', async () => ({
    ...store.snapshot(),
    provider: { name: provider.name, model: provider.model, demo: provider.name === 'demo' },
  }));
  app.post('/api/conversations', async (request) => {
    const { title, position } = CreateConversationSchema.parse(request.body);
    return store.createConversation(title, undefined, position);
  });
  app.post('/api/excerpts', async (request) =>
    store.createExcerpt(CreateExcerptSchema.parse(request.body)),
  );
  app.post('/api/branches', async (request) =>
    store.branchExcerpt(z.object({ excerpt_id: Id }).strict().parse(request.body).excerpt_id),
  );
  app.patch('/api/nodes/:id', async (request) => {
    const nodeId = z.object({ id: Id }).parse(request.params).id;
    const patch = z
      .object({
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        context_state: ContextStateSchema.optional(),
      })
      .strict()
      .parse(request.body);
    return store.transaction(() => {
      const n = store.snapshot().nodes.find((n) => n.id === nodeId);
      if (!n) throw new DomainError('missing_node', '找不到节点', 404);
      store.saveNode({ ...n, ...patch, updated_at: now() });
      // Geometry cannot change the semantic package; state changes can.
      if (patch.context_state !== undefined) store.bump();
      return { ok: true };
    });
  });
  app.patch('/api/workspace', async (request) => {
    const patch = z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        viewport: ViewportSchema.optional(),
      })
      .strict()
      .parse(request.body);
    const w = store.workspace();
    store.saveWorkspace({
      ...w,
      name: patch.name ?? w.name,
      settings: { ...w.settings, viewport: patch.viewport ?? w.settings.viewport },
      updated_at: now(),
    });
    return { ok: true };
  });
  app.post('/api/context-control', async (request) => {
    const { node_id, action } = z
      .object({ node_id: Id, action: z.enum(['pin', 'unpin', 'exclude', 'restore']) })
      .strict()
      .parse(request.body);
    return store.transaction(() => {
      if (!store.snapshot().nodes.some((n) => n.id === node_id))
        throw new DomainError('missing_node', '找不到节点', 404);
      const w = store.workspace();
      const pins = new Set(w.settings.pinned_node_ids);
      const excluded = new Set(w.settings.excluded_node_ids);
      if (action === 'pin') {
        pins.add(node_id);
        excluded.delete(node_id);
      }
      if (action === 'unpin') pins.delete(node_id);
      if (action === 'exclude') {
        excluded.add(node_id);
        pins.delete(node_id);
      }
      if (action === 'restore') excluded.delete(node_id);
      store.saveWorkspace({
        ...w,
        settings: { ...w.settings, pinned_node_ids: [...pins], excluded_node_ids: [...excluded] },
      });
      store.bump();
      return { ok: true };
    });
  });
  app.post('/api/compile', async (request) => {
    const input = CompileRequestSchema.parse(request.body);
    const s = store.snapshot();
    const node = s.nodes.find(
      (n) => n.ref_type === 'conversation' && n.ref_id === input.conversation_id,
    );
    if (!node) throw new DomainError('missing_conversation', '找不到对话', 404);
    const set: ContextSet = {
      id: id(),
      workspace_id: s.workspace.id,
      conversation_id: input.conversation_id,
      target_turn_id: null,
      current_node_id: node.id,
      prompt_text: input.prompt,
      selected_node_ids: [...new Set(input.selected_node_ids)],
      pinned_node_ids: s.workspace.settings.pinned_node_ids,
      excluded_node_ids: s.workspace.settings.excluded_node_ids,
      budget: input.budget,
      policy_version: 'context-policy-0.1',
      graph_snapshot_version: s.workspace.revision,
      status: 'compiled',
      created_at: now(),
    };
    const pkg = compileContext(s, set);
    store.saveContext(set, pkg);
    return { context_set: set, package: pkg };
  });
  app.post('/api/answer', async (request, reply) => {
    const { context_set_id } = z.object({ context_set_id: Id }).strict().parse(request.body);
    const { turn, pkg } = store.beginAnswer(
      context_set_id,
      provider.name,
      provider.model || 'unconfigured',
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const emit = (event: object) => {
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    emit({ type: 'started', turn_id: turn.id, context_set_id: pkg.context_set_id });
    try {
      const answer = await provider.generate(pkg, (text) => emit({ type: 'draft', text }));
      store.finishAnswer(turn.id, answer);
      emit({ type: 'complete', turn_id: turn.id });
    } catch (error) {
      const message = error instanceof DomainError ? error.message : '生成失败，可重试。';
      store.failAnswer(turn.id, message);
      emit({
        type: 'error',
        code: error instanceof DomainError ? error.code : 'generation_failed',
        message,
      });
    } finally {
      reply.raw.end();
    }
  });
  app.post('/api/retry', async (request, reply) => {
    const { turn_id } = z.object({ turn_id: Id }).strict().parse(request.body);
    const { turn, pkg } = store.transaction(() => {
      const s = store.snapshot();
      const turn = s.turns.find((t) => t.id === turn_id);
      if (!turn || turn.actor !== 'assistant' || turn.status !== 'error')
        throw new DomainError('invalid_retry', '只能重试失败的回答。', 409);
      if (
        s.turns.some(
          (t) =>
            t.conversation_id === turn.conversation_id &&
            (t.status === 'streaming' || t.sequence > turn.sequence),
        )
      )
        throw new DomainError('invalid_retry', '该对话已有后续内容，请发送新的问题。', 409);
      const pkg = s.packages.find((p) => p.context_set_id === turn.input_context_set_id);
      if (!pkg) throw new DomainError('missing_context', '找不到原始上下文。', 404);
      const previousSet = s.context_sets.find((c) => c.id === turn.input_context_set_id)!;
      const exclusionsChanged =
        JSON.stringify([...s.workspace.settings.excluded_node_ids].sort()) !==
        JSON.stringify([...previousSet.excluded_node_ids].sort());
      if (
        exclusionsChanged ||
        pkg.items.some((i) => s.nodes.find((n) => n.id === i.node_id)?.context_state !== i.state)
      )
        throw new DomainError(
          'changed_context_policy',
          '上下文规则已变化，请重新预览并发送新问题。',
          409,
        );
      // Reuse the exact immutable context, never silently incorporate new data.
      store.saveTurn({
        ...turn,
        status: 'streaming',
        error: null,
        model_provider: provider.name,
        model_id: provider.model || 'unconfigured',
      });
      store.bump();
      return { turn, pkg };
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    const emit = (event: object) => {
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const answer = await provider.generate(pkg, (text) => emit({ type: 'draft', text }));
      store.finishAnswer(turn.id, answer);
      emit({ type: 'complete' });
    } catch (error) {
      const message = error instanceof DomainError ? error.message : '生成失败，可重试。';
      store.failAnswer(turn.id, message);
      emit({
        type: 'error',
        code: error instanceof DomainError ? error.code : 'generation_failed',
        message,
      });
    } finally {
      reply.raw.end();
    }
  });
  app.get('/api/project/export', async (_request, reply) => {
    const project = exportProject(store);
    return reply
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Disposition',
        `attachment; filename="context-canvas-${project.exported_at.slice(0, 10)}.json"`,
      )
      .send(project);
  });
  app.post('/api/project/validate', { bodyLimit: 16 * 1024 * 1024 }, async (request) => {
    const { project } = z.object({ project: z.unknown() }).strict().parse(request.body);
    return previewProject(store, project);
  });
  app.post('/api/project/import', { bodyLimit: 16 * 1024 * 1024 }, async (request) => {
    const input = z
      .object({
        project: z.unknown(),
        confirm_replace: z.literal(true),
        expected: z
          .object({
            workspace_id: Id,
            revision: z.number().int().nonnegative(),
            snapshot_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .strict()
      .parse(request.body);
    return importProject(store, input.project, input.expected);
  });
  app.get('/api/project/recovery', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send(listRecoverySnapshots(store)),
  );
  app.get('/api/project/recovery/:id', async (request, reply) => {
    const { id } = z.object({ id: Id }).parse(request.params);
    return reply.header('Cache-Control', 'no-store').send(recoveryProject(store, id));
  });
  return app;
}
