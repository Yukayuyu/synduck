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
import { Store, id, now } from '@acc/db';
import { compileContext } from '@acc/context-compiler';
import { type ModelProvider } from '@acc/model-gateway';

export function createApp(store: Store, provider: ModelProvider) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  // A local app is not an authenticated public service. Bind loopback and reject
  // cross-origin browser writes, including DNS-rebinding / form submissions.
  app.addHook('onRequest', async (request, reply) => {
    const host = (request.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost', 'localhost.localdomain'].includes(host))
      return reply.code(403).send({ error: 'host_rejected', message: '仅支持本机访问。' });
    const origin = request.headers.origin;
    if (
      origin &&
      ![
        `http://127.0.0.1:${process.env.APP_PORT || 3000}`,
        `http://localhost:${process.env.APP_PORT || 3000}`,
        `http://127.0.0.1:${process.env.API_PORT || 3001}`,
        `http://localhost:${process.env.API_PORT || 3001}`,
      ].includes(origin)
    )
      return reply.code(403).send({ error: 'origin_rejected', message: '不接受其他网站的请求。' });
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) &&
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(415).send({ error: 'json_required', message: '需要 JSON 请求。' });
  });
  app.setErrorHandler((error, _request, reply) => {
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
  }));
  app.get('/api/state', async () => ({
    ...store.snapshot(),
    provider: { name: provider.name, model: provider.model, demo: provider.name === 'demo' },
  }));
  app.post('/api/conversations', async (request) => {
    const { title } = CreateConversationSchema.parse(request.body);
    return store.createConversation(title);
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
      emit({ type: 'error', message });
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
      emit({ type: 'error', message });
    } finally {
      reply.raw.end();
    }
  });
  return app;
}
