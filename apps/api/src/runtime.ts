import { z } from 'zod';
import { DomainError, type ContextPackage } from '@acc/domain';
import type { FastifyInstance } from 'fastify';
import type { Store } from '@acc/db';
import type { LocalExecutor } from '../../../packages/local-runtime/src/executor';
import type { UpdateState } from '../../../packages/local-runtime/src/updates';
import { randomUUID } from 'node:crypto';
import packageJson from '../../../package.json';

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
) {
  const idle = () => {
    if (local?.busy || store.snapshot().turns.some((turn) => turn.status === 'streaming'))
      throw new DomainError('runtime_busy', '請先完成或停止 AI 回答與本地任務。', 409);
  };
  app.get('/api/local', async () =>
    local
      ? { available: true, ...local.summary() }
      : { available: false, enabled: false, root: '', busy: false, tasks: [] },
  );
  app.get('/api/local/status', async () =>
    local ? local.status() : { enabled: false, busy: false, waiting: 0 },
  );
  if (local) {
    app.get('/api/local/tasks/:id', async (request) =>
      local.task(z.object({ id: z.string().uuid() }).parse(request.params).id),
    );
    app.post('/api/local/configure', async (request) => {
      const { enabled, root } = z
        .object({ enabled: z.boolean(), root: z.string().max(2000) })
        .strict()
        .parse(request.body);
      idle();
      return local.configure(enabled, root);
    });
    app.post('/api/local/actions', async (request) => {
      const { tool, arguments: args } = z
        .object({ tool: z.string(), arguments: z.unknown() })
        .strict()
        .parse(request.body);
      return local.manual(tool, args);
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
      return local.start(prompt, pkg);
    });
    app.post('/api/local/tasks/:id/approve', async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const { action_id, approved } = z
        .object({ action_id: z.string().uuid(), approved: z.boolean() })
        .strict()
        .parse(request.body);
      return local.approve(id, action_id, approved);
    });
    app.post('/api/local/tasks/:id/cancel', async (request) =>
      local.cancel(z.object({ id: z.string().uuid() }).parse(request.params).id),
    );
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
