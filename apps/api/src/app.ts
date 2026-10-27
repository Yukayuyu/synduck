import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CreateConversationSchema,
  CreateExcerptSchema,
  CreateForksSchema,
  CompileRequestSchema,
  DomainError,
  ViewportSchema,
  ContextStateSchema,
  Id,
  type ContextSet,
  type ContextPackage,
  type Turn,
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
import { compileContext, excludedSources } from '@acc/context-compiler';
import { type ModelProvider } from '@acc/model-gateway';
import { ProviderRegistry, ProviderMode } from '../../../packages/model-gateway/src/registry';
import { ReasoningEffort } from '../../../packages/model-gateway/src/codex';
import { registerAccess, type AccessConfig } from './access';
import { registerRuntime, type UpdateService } from './runtime';
import type { LocalExecutor } from '../../../packages/local-runtime/src/executor';
import packageJson from '../../../package.json';
import { CanvasRegistry } from './canvases';

export function createApp(
  primaryStore: Store,
  provider: ModelProvider,
  options: {
    access?: AccessConfig;
    models?: ProviderRegistry;
    local?: LocalExecutor;
    updates?: UpdateService;
    canvases?: CanvasRegistry;
  } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const canvases = options.canvases ?? new CanvasRegistry(primaryStore);
  const store = canvases.store;
  const liveAnswers = new Map<string, AbortController>();
  const previousTaskHook = options.local?.onTaskCreated;
  const previousBusyHook = canvases.localBusy;
  if (options.local)
    canvases.localBusy = (id) =>
      options
        .local!.snapshot()
        .tasks.some(
          (task) =>
            ['running', 'waiting'].includes(task.status) && canvases.taskOwner(task.id) === id,
        );
  if (options.local)
    options.local.onTaskCreated = (id) => {
      previousTaskHook?.(id);
      canvases.ownTask(id);
    };
  registerAccess(app, options.access);
  app.addHook('onRequest', (request, _reply, done) => {
    if (!request.url.startsWith('/api/')) return done();
    try {
      const query = new URL(request.url, 'http://canvas.local').searchParams.get('canvas');
      const canvasId = Id.parse(request.headers['x-canvas-id'] ?? query ?? canvases.primaryId);
      canvases.run(canvasId, done);
    } catch (error) {
      done(error as Error);
    }
  });
  app.addHook('onClose', async () => {
    if (options.local) options.local.onTaskCreated = previousTaskHook;
    canvases.localBusy = previousBusyHook;
    canvases.close();
  });
  registerRuntime(app, store, options.local, options.updates, canvases);
  const idle = () => {
    if (options.local?.busy || canvases.busy)
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
    canvas_id: canvases.currentId,
    provider: { name: provider.name, model: provider.model, demo: provider.name === 'demo' },
  }));
  app.get('/api/canvases', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send({
      canvases: canvases.list(),
      primary_id: canvases.primaryId,
    }),
  );
  app.post('/api/canvases', async (request) => {
    const { name, request_id } = z
      .object({ name: z.string().trim().min(1).max(160), request_id: z.string().uuid().optional() })
      .strict()
      .parse(request.body);
    return canvases.create(name, request_id);
  });
  app.patch('/api/canvases/:id', async (request) =>
    canvases.rename(
      z.object({ id: Id }).parse(request.params).id,
      z
        .object({ name: z.string().trim().min(1).max(160) })
        .strict()
        .parse(request.body).name,
    ),
  );
  app.post('/api/canvases/:id/references', async (request) =>
    canvases.reference(z.object({ id: Id }).parse(request.params).id, request.body),
  );
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
  app.post('/api/forks', async (request) => ({
    branches: store.createForks(CreateForksSchema.parse(request.body)),
  }));
  app.post('/api/excerpts/:id/sources', async (request) =>
    store.addToCollection(
      z.object({ id: Id }).parse(request.params).id,
      CreateExcerptSchema.parse(request.body),
    ),
  );
  app.delete('/api/excerpts/:id/sources/:sourceId', async (request) => {
    const { id, sourceId } = z.object({ id: Id, sourceId: Id }).parse(request.params);
    return store.removeCollectionSource(id, sourceId);
  });
  app.delete('/api/nodes/:id', async (request) => ({
    node: store.setNodeDeleted(z.object({ id: Id }).parse(request.params).id, true),
  }));
  app.post('/api/nodes/:id/restore', async (request) => ({
    node: store.setNodeDeleted(z.object({ id: Id }).parse(request.params).id, false),
  }));
  app.post('/api/nodes/:id/rename', async (request) => ({
    node: store.renameNode(
      z.object({ id: Id }).parse(request.params).id,
      z
        .object({ title: z.string().trim().min(1).max(160) })
        .strict()
        .parse(request.body).title,
    ),
  }));
  app.patch('/api/nodes/:id', async (request) => {
    const nodeId = z.object({ id: Id }).parse(request.params).id;
    const patch = z
      .object({
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        width: z.number().min(340).max(1600).optional(),
        height: z.number().min(360).max(1800).optional(),
        size_mode: z.enum(['auto', 'manual']).optional(),
        collapsed: z.boolean().optional(),
        context_state: ContextStateSchema.optional(),
      })
      .strict()
      .refine(
        (value) =>
          (value.width === undefined) === (value.height === undefined) &&
          (value.width === undefined || value.size_mode === 'manual'),
        { message: 'Resizing requires both dimensions and manual size mode.' },
      )
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
  const compileInput = (input: z.infer<typeof CompileRequestSchema>, contextId: string = id()) => {
    const s = store.snapshot();
    const node = s.nodes.find(
      (n) => n.ref_type === 'conversation' && n.ref_id === input.conversation_id,
    );
    if (!node) throw new DomainError('missing_conversation', '找不到对话', 404);
    if (node.visibility === 'hidden')
      throw new DomainError('deleted_node', '請先從回收桶還原對話，再繼續提問。', 409);
    const set: ContextSet = {
      id: contextId,
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
  };
  app.post('/api/compile', async (request) =>
    compileInput(CompileRequestSchema.parse(request.body)),
  );
  const streamGeneration = async (
    turn: Turn,
    pkg: ContextPackage,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const controller = new AbortController();
    const answerKey = JSON.stringify([canvases.currentId, turn.id]);
    liveAnswers.set(answerKey, controller);
    let settled = false;
    const disconnected = () => {
      if (!settled) controller.abort();
    };
    request.raw.once('aborted', disconnected);
    reply.raw.once('close', disconnected);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const emit = (event: object) => {
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`);
    };
    emit({ type: 'started', turn_id: turn.id, context_set_id: pkg.context_set_id, package: pkg });
    try {
      const answer = await provider.generate(
        pkg,
        (text) => emit({ type: 'draft', text }),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new DomainError('generation_cancelled', '已停止這段回答，可使用原上下文重試。', 499);
      store.finishAnswer(turn.id, answer);
      emit({ type: 'complete', turn_id: turn.id });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? '已停止這段回答，可使用原上下文重試。'
        : error instanceof DomainError
          ? error.message
          : '生成失败，可重试。';
      store.failAnswer(turn.id, message);
      emit({
        type: 'error',
        code: cancelled
          ? 'generation_cancelled'
          : error instanceof DomainError
            ? error.code
            : 'generation_failed',
        message,
      });
    } finally {
      settled = true;
      liveAnswers.delete(answerKey);
      request.raw.off('aborted', disconnected);
      reply.raw.off('close', disconnected);
      reply.raw.end();
    }
  };
  app.post('/api/answers/:id/cancel', async (request) => {
    const { id: turnId } = z.object({ id: Id }).parse(request.params);
    const turn = store.snapshot().turns.find((t) => t.id === turnId);
    if (!turn || turn.actor !== 'assistant')
      throw new DomainError('missing_turn', '找不到這段回答。', 404);
    const controller = liveAnswers.get(JSON.stringify([canvases.currentId, turnId]));
    if (controller) controller.abort();
    return { ok: true, already_finished: !controller };
  });
  app.post('/api/answer', async (request, reply) => {
    const { context_set_id } = z.object({ context_set_id: Id }).strict().parse(request.body);
    const { turn, pkg } = store.beginAnswer(
      context_set_id,
      provider.name,
      provider.model || 'unconfigured',
    );
    return streamGeneration(turn, pkg, request, reply);
  });
  app.post('/api/send', async (request, reply) => {
    const input = CompileRequestSchema.extend({ request_id: z.string().uuid() })
      .strict()
      .parse(request.body);
    // Direct sends compile and claim their immutable input in the same SQLite
    // transaction. Unrelated concurrent completions cannot invalidate the gap
    // between preview and send; explicitly previewed /answer keeps that check.
    const result = store.transaction(() => {
      const contextId = `direct-${input.request_id}`;
      if (store.snapshot().context_sets.some((set) => set.id === contextId))
        throw new DomainError('already_used', '這個傳送請求已處理，請勿重複提交。', 409);
      const compiled = compileInput(input, contextId);
      if (!compiled.package.sendable) return { blocked: compiled.package };
      return store.beginAnswer(contextId, provider.name, provider.model || 'unconfigured');
    });
    if ('blocked' in result)
      return reply.code(422).send({
        error: 'context_blocked',
        message: '上下文存在阻塞问题，请先处理',
        package: result.blocked,
      });
    return streamGeneration(result.turn, result.pkg, request, reply);
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
      const excluded = excludedSources(s, s.workspace.settings.excluded_node_ids);
      if (
        exclusionsChanged ||
        excluded.deletedNodes.has(previousSet.current_node_id) ||
        pkg.items.some(
          (item) => excluded.nodes.has(item.node_id) || excluded.blocks.has(item.source_block_id),
        ) ||
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
    return streamGeneration(turn, pkg, request, reply);
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
