import { z } from 'zod';
import { DomainError, type ContextPackage } from '@acc/domain';
import type { FastifyInstance } from 'fastify';
import type { Store } from '@acc/db';
import type { LocalExecutor } from '../../../packages/local-runtime/src/executor';
import type { UpdateState } from '../../../packages/local-runtime/src/updates';
import { randomUUID } from 'node:crypto';
import packageJson from '../../../package.json';
import type { CanvasRegistry } from './canvases';

export interface UpdateService {
  status(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  configure(channel: 'stable' | 'preview', autoDownload: boolean): Promise<UpdateState>;
  importArchive(bytes: Uint8Array): Promise<UpdateState>;
  apply(): Promise<{ ok: boolean; restarting: boolean }>;
}
export class LauncherBridge implements UpdateService {
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor() {
    process.on('message', this.receive);
    process.on('disconnect', this.close);
  }
  private receive = (message: unknown) => {
    const parsed = z
      .object({
        kind: z.literal('runtime-update-reply'),
        id: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
      })
      .safeParse(message);
    if (!parsed.success) return;
    const pending = this.pending.get(parsed.data.id);
    if (!pending) return;
    this.pending.delete(parsed.data.id);
    clearTimeout(pending.timer);
    if (parsed.data.error) pending.reject(new DomainError('update_failed', parsed.data.error, 502));
    else pending.resolve(parsed.data.result);
  };
  private request<T>(action: string, args: object = {}) {
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DomainError('update_timeout', '更新啟動器沒有回應。', 504));
      }, 180000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      if (!process.send || !process.connected) {
        clearTimeout(timer);
        this.pending.delete(id);
        return reject(new DomainError('update_unmanaged', '請使用本地啟動器。', 409));
      }
      process.send({ kind: 'runtime-update', id, action, args }, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new DomainError('update_unmanaged', '啟動器連線中斷。', 503));
        }
      });
    });
  }
  status() {
    return this.request<UpdateState>('status');
  }
  check() {
    return this.request<UpdateState>('check');
  }
  download() {
    return this.request<UpdateState>('download');
  }
  configure(channel: 'stable' | 'preview', autoDownload: boolean) {
    return this.request<UpdateState>('configure', { channel, auto_download: autoDownload });
  }
  importArchive(bytes: Uint8Array) {
    return this.request<UpdateState>('import', { archive: Buffer.from(bytes).toString('base64') });
  }
  apply() {
    return this.request<{ ok: boolean; restarting: boolean }>('apply');
  }
  close = () => {
    process.off('message', this.receive);
    process.off('disconnect', this.close);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DomainError('update_unmanaged', '啟動器已停止。', 503));
    }
    this.pending.clear();
  };
}
export function registerRuntime(
  app: FastifyInstance,
  store: Store,
  local?: LocalExecutor,
  updates?: UpdateService,
  canvases?: CanvasRegistry,
) {
  const otherCanvasBusy = () =>
    !!local &&
    !!canvases &&
    local
      .snapshot()
      .tasks.some(
        (task) =>
          ['running', 'waiting'].includes(task.status) &&
          canvases.taskOwner(task.id) !== canvases.currentId,
      );
  const idle = () => {
    if (
      local?.busy ||
      (canvases
        ? canvases.busy
        : store.snapshot().turns.some((turn) => turn.status === 'streaming'))
    )
      throw new DomainError('runtime_busy', '請先完成或停止 AI 回答與本地任務。', 409);
  };
  app.get('/api/local', async () =>
    local
      ? {
          available: true,
          ...local.summary(),
          ...(otherCanvasBusy() ? { other_canvas_busy: true } : {}),
          tasks: local
            .summary()
            .tasks.filter(
              (task) => !canvases || canvases.taskOwner(task.id) === canvases.currentId,
            ),
        }
      : { available: false, enabled: false, root: '', busy: false, tasks: [] },
  );
  app.get('/api/local/status', async () =>
    local
      ? { ...local.status(), ...(otherCanvasBusy() ? { waiting: 0, other_canvas_busy: true } : {}) }
      : { enabled: false, busy: false, waiting: 0 },
  );
  app.get('/api/local/canvas', async () => ({
    traces: local
      ? (await local.canvasTraces()).filter(
          (trace) => !canvases || canvases.taskOwner(trace.task_id) === canvases.currentId,
        )
      : [],
    busy: local?.busy || false,
  }));
  if (local) {
    app.get('/api/local/tasks/:id', async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      canvases?.assertTask(id);
      return local.readTask(id);
    });
    app.get('/api/local/integrations', async () => local.integrations());
    app.post('/api/local/mcp/configure', async (request) => {
      idle();
      const { servers } = z.object({ servers: z.unknown() }).strict().parse(request.body);
      return local.configureMcp(servers);
    });
    app.get('/api/local/desktop/windows', async () => local.desktop.windows());
    app.post('/api/local/desktop/configure', async (request) => {
      idle();
      const { enabled, window_id } = z
        .object({ enabled: z.boolean(), window_id: z.string().regex(/^\d*$/) })
        .strict()
        .parse(request.body);
      return local.configureDesktop(enabled, window_id);
    });
    app.post('/api/local/canvas', async (request) => {
      const { task_id, pinned, x, y } = z
        .object({
          task_id: z.string().uuid(),
          pinned: z.boolean(),
          x: z.number().finite().optional(),
          y: z.number().finite().optional(),
        })
        .strict()
        .parse(request.body);
      canvases?.assertTask(task_id);
      return (await local.pinTrace(task_id, pinned, x, y)).filter(
        (trace) => !canvases || canvases.taskOwner(trace.task_id) === canvases.currentId,
      );
    });
    app.get('/api/local/tasks/:id/images/:sha', async (request, reply) => {
      const { id, sha } = z
        .object({ id: z.string().uuid(), sha: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(request.params);
      canvases?.assertTask(id);
      const { evidence, bytes } = await local.image(id, sha);
      return reply.type(evidence.mime).header('X-Content-Type-Options', 'nosniff').send(bytes);
    });
    app.get('/api/local/tasks/:id/export', async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      canvases?.assertTask(id);
      const task = await local.readTask(id);
      const context = store
        .snapshot()
        .packages.find((pkg) => pkg.package_id === task.context_package_id);
      return reply
        .type('application/zip')
        .header('Content-Disposition', 'attachment; filename="canvas-task-' + id + '.zip"')
        .send(Buffer.from(await local.exportTrace(id, context)));
    });
    app.post('/api/local/configure', async (request) => {
      const { enabled, root } = z
        .object({ enabled: z.boolean(), root: z.string().max(2000) })
        .strict()
        .parse(request.body);
      idle();
      const result = await local.configure(enabled, root);
      return {
        ...result,
        tasks: result.tasks.filter(
          (task) => !canvases || canvases.taskOwner(task.id) === canvases.currentId,
        ),
      };
    });
    app.post('/api/local/actions', async (request) => {
      const {
        tool,
        arguments: args,
        continuation_id,
      } = z
        .object({
          tool: z.string(),
          arguments: z.unknown(),
          continuation_id: z.string().uuid().optional(),
        })
        .strict()
        .parse(request.body);
      if (continuation_id) canvases?.assertTask(continuation_id);
      const task = await local.manual(tool, args, continuation_id);
      canvases?.ownTask(task.id);
      return task;
    });
    app.post('/api/local/tasks', async (request) => {
      const { prompt, context_set_id: contextId } = z
        .object({
          prompt: z.string().trim().min(1).max(8000),
          context_set_id: z.string().uuid().optional(),
        })
        .strict()
        .parse(request.body);
      let pkg: ContextPackage | undefined;
      if (contextId) {
        const state = store.snapshot();
        pkg = state.packages.find((entry) => entry.context_set_id === contextId);
        if (!pkg?.sendable || pkg.graph_snapshot_version !== state.workspace.revision)
          throw new DomainError('stale_context', '請重新預覽上下文，再開始本地任務。', 409);
      }
      const task = await local.start(prompt, pkg);
      canvases?.ownTask(task.id);
      return task;
    });
    app.post('/api/local/tasks/:id/approve', async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      canvases?.assertTask(id);
      const { action_id, approved } = z
        .object({ action_id: z.string().uuid(), approved: z.boolean() })
        .strict()
        .parse(request.body);
      return local.approve(id, action_id, approved);
    });
    app.post('/api/local/tasks/:id/cancel', async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      canvases?.assertTask(id);
      return local.cancel(id);
    });
  }
  app.get('/api/updates', async () =>
    updates
      ? updates.status()
      : {
          current_version: packageJson.version,
          managed: false,
          phase: 'idle',
          channel: 'preview',
          auto_download: true,
          latest: null,
          staged_version: null,
          checked_at: null,
          error: null,
          previous_version: null,
        },
  );
  if (updates) {
    app.post('/api/updates/check', async () => updates.check());
    app.post('/api/updates/download', async () => updates.download());
    app.post('/api/updates/configure', async (request) => {
      const { channel, auto_download } = z
        .object({ channel: z.enum(['stable', 'preview']), auto_download: z.boolean() })
        .strict()
        .parse(request.body);
      return updates.configure(channel, auto_download);
    });
    app.post('/api/updates/import', { bodyLimit: 46 * 1024 * 1024 }, async (request) => {
      const { archive } = z
        .object({
          archive: z
            .string()
            .max(45 * 1024 * 1024)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        })
        .strict()
        .parse(request.body);
      return updates.importArchive(Buffer.from(archive, 'base64'));
    });
    app.post('/api/updates/apply', async () => {
      idle();
      return updates.apply();
    });
  }
}
