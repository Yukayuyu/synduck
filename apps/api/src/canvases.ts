import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  CreateExcerptSchema,
  DomainError,
  ExternalOriginSchema,
  type ExternalOrigin,
} from '@acc/domain';
import { Store, contentHash, id, now } from '@acc/db';

export interface CanvasEntry {
  id: string;
  name: string;
  created_at: string;
  busy: boolean;
  unavailable?: boolean;
}

// Each canvas owns a complete database, including its own recovery points.
// The original database remains the first canvas and contains only the catalog
// and shared local-task ownership in addition to its existing graph.
export class CanvasRegistry {
  private readonly scope = new AsyncLocalStorage<string>();
  private readonly stores = new Map<string, Store>();
  readonly primaryId: string;
  readonly store: Store;
  localBusy?: (canvasId: string) => boolean;
  constructor(private readonly primary: Store) {
    let row = primary.db.prepare('SELECT id FROM canvas_catalog WHERE is_primary = 1').get();
    if (!row) {
      const key = id();
      primary.db
        .prepare('INSERT INTO canvas_catalog VALUES(?,1,?,?)')
        .run(key, primary.workspace().created_at, primary.workspace().name);
      row = { id: key };
    }
    this.primaryId = row.id as string;
    this.stores.set(this.primaryId, primary);
    // Resolve at method invocation, within the request's immutable async scope.
    // Never change a process-wide active Store while another answer is awaiting.
    this.store = new Proxy(primary, {
      get: (_target, key) => {
        const current = this.get(this.currentId);
        const value = Reflect.get(current, key);
        return typeof value === 'function' ? value.bind(current) : value;
      },
    });
  }
  get currentId() {
    return this.scope.getStore() ?? this.primaryId;
  }
  run<T>(canvasId: string, work: () => T): T {
    this.get(canvasId);
    return this.scope.run(canvasId, work);
  }
  private rows() {
    return this.primary.db
      .prepare('SELECT id, is_primary, created_at, name FROM canvas_catalog ORDER BY rowid')
      .all() as { id: string; is_primary: number; created_at: string; name: string }[];
  }
  get(canvasId: string) {
    const cached = this.stores.get(canvasId);
    if (cached) return cached;
    const row = this.primary.db.prepare('SELECT id FROM canvas_catalog WHERE id = ?').get(canvasId);
    if (!row || !z.string().uuid().safeParse(canvasId).success)
      throw new DomainError('missing_canvas', '找不到这张画布。', 404);
    if (
      this.primary.path !== ':memory:' &&
      !existsSync(join(resolve(this.primary.path + '.canvases'), canvasId + '.sqlite'))
    )
      throw new DomainError(
        'canvas_unavailable',
        '画布数据文件不可用，已有数据不会被空画布替换。',
        409,
      );
    const store = new Store(
      this.primary.path === ':memory:'
        ? ':memory:'
        : join(resolve(this.primary.path + '.canvases'), canvasId + '.sqlite'),
    );
    this.stores.set(canvasId, store);
    return store;
  }
  list(): CanvasEntry[] {
    return this.rows().map((row) => {
      try {
        const store = this.get(row.id);
        const name = store.workspace().name;
        if (name !== row.name)
          this.primary.db
            .prepare('UPDATE canvas_catalog SET name = ? WHERE id = ?')
            .run(name, row.id);
        return {
          id: row.id,
          name,
          created_at: row.created_at,
          busy:
            !!store.db.prepare("SELECT 1 FROM turns WHERE status = 'streaming' LIMIT 1").get() ||
            !!this.localBusy?.(row.id),
        };
      } catch {
        return {
          id: row.id,
          name: row.name,
          created_at: row.created_at,
          busy: false,
          unavailable: true,
        };
      }
    });
  }
  get busy() {
    return this.list().some((canvas) => canvas.busy);
  }
  create(name: string, requestId?: string): CanvasEntry {
    name = z.string().trim().min(1).max(160).parse(name);
    const key = requestId ? z.string().uuid().parse(requestId) : id();
    const existing = this.rows().find((entry) => entry.id === key);
    if (existing) {
      if (this.get(key).workspace().name !== name)
        throw new DomainError(
          'canvas_request_conflict',
          '此新建请求已使用，请从列表选择已创建的画布。',
          409,
        );
      return this.list().find((entry) => entry.id === key)!;
    }
    if (this.primary.path !== ':memory:')
      mkdirSync(this.primary.path + '.canvases', { recursive: true });
    const store = new Store(
      this.primary.path === ':memory:'
        ? ':memory:'
        : join(resolve(this.primary.path + '.canvases'), key + '.sqlite'),
    );
    try {
      store.saveWorkspace({ ...store.workspace(), name, updated_at: now() });
      this.primary.db.prepare('INSERT INTO canvas_catalog VALUES(?,0,?,?)').run(key, now(), name);
      this.stores.set(key, store);
      return this.list().find((entry) => entry.id === key)!;
    } catch (error) {
      store.close();
      throw error;
    }
  }
  rename(canvasId: string, name: string) {
    const store = this.get(canvasId);
    name = z.string().trim().min(1).max(160).parse(name);
    store.saveWorkspace({ ...store.workspace(), name, updated_at: now() });
    return this.list().find((entry) => entry.id === canvasId)!;
  }
  reference(targetId: string, raw: unknown) {
    const input = CreateExcerptSchema.extend({ request_id: z.string().uuid() }).strict().parse(raw);
    if (targetId === this.currentId) throw new DomainError('same_canvas', '请选择另一张画布。');
    const source = this.get(this.currentId).snapshot();
    const block = source.blocks.find((b) => b.id === input.source_block_id);
    const turn = source.turns.find((t) => t.id === block?.turn_id);
    const conversation = source.conversations.find((c) => c.id === turn?.conversation_id);
    const sourceNode = source.nodes.find(
      (n) => n.ref_type === 'conversation' && n.ref_id === conversation?.id,
    );
    if (
      !block?.text_content ||
      !turn ||
      !conversation ||
      !sourceNode ||
      sourceNode.visibility === 'hidden'
    )
      throw new DomainError('missing_source', '找不到可引用的原文。', 404);
    const sel = input.selector;
    if (
      contentHash(block.text_content) !== input.source_content_hash ||
      block.content_hash !== input.source_content_hash ||
      block.text_content.slice(sel.start_char, sel.end_char) !== sel.exact ||
      sel.end_char > block.text_content.length
    )
      throw new DomainError('stale_source', '原文已变化，请重新选取。', 409);
    const target = this.get(targetId);
    return target.transaction(() => {
      const existing = target
        .snapshot()
        .excerpts.find((e) => e.external_origin?.request_id === input.request_id);
      if (existing) {
        const node = target
          .snapshot()
          .nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === existing.id)!;
        const inherited = block.structured_data?.external_origin
          ? ExternalOriginSchema.parse(block.structured_data.external_origin)
          : undefined;
        if (
          existing.snapshot_text !== sel.exact ||
          node.visibility === 'hidden' ||
          existing.external_origin!.canvas_id !== (inherited?.canvas_id ?? this.currentId) ||
          existing.external_origin!.workspace_id !==
            (inherited?.workspace_id ?? source.workspace.id) ||
          existing.external_origin!.source_block_id !== (inherited?.source_block_id ?? block.id) ||
          existing.external_origin!.source_content_hash !==
            (inherited?.source_content_hash ?? block.content_hash) ||
          existing.external_origin!.selector.start_char !==
            (inherited?.selector.start_char ?? 0) + sel.start_char
        )
          throw new DomainError('reference_request_conflict', '此引用请求已使用。', 409);
        return { excerpt: existing, node };
      }
      const inherited = block.structured_data?.external_origin
        ? ExternalOriginSchema.parse(block.structured_data.external_origin)
        : undefined;
      const origin: ExternalOrigin = inherited
        ? {
            ...inherited,
            request_id: input.request_id,
            selector: {
              ...sel,
              start_char: inherited.selector.start_char + sel.start_char,
              end_char: inherited.selector.start_char + sel.end_char,
            },
          }
        : {
            canvas_id: this.currentId,
            workspace_id: source.workspace.id,
            source_block_id: block.id,
            conversation_id: conversation.id,
            turn_id: turn.id,
            selector: sel,
            source_content_hash: block.content_hash,
            canvas_name: source.workspace.name,
            conversation_title: conversation.title,
            request_id: input.request_id,
          };
      const imported = target.createConversation(('引用 · ' + origin.canvas_name).slice(0, 160));
      const importedTurn = target.appendTurn(imported.conversation.id, 'human', sel.exact);
      target.saveTurn({ ...importedTurn, actor: 'tool' });
      const importedBlock = target.snapshot().blocks.find((b) => b.turn_id === importedTurn.id)!;
      target.saveBlock({ ...importedBlock, structured_data: { external_origin: origin } });
      target.saveNode({ ...imported.node, collapsed: true, context_state: 'reference' });
      const result = target.createExcerpt({
        source_block_id: importedBlock.id,
        source_content_hash: importedBlock.content_hash,
        selector: {
          type: 'text_range',
          start_char: 0,
          end_char: sel.exact.length,
          exact: sel.exact,
        },
        branch: false,
      });
      const node = { ...result.node, context_state: 'reference' as const };
      target.saveNode(node);
      return { ...result, node };
    });
  }
  taskOwner(taskId: string) {
    return (
      (this.primary.db
        .prepare('SELECT canvas_id FROM canvas_task_owners WHERE task_id = ?')
        .get(taskId)?.canvas_id as string | undefined) ?? this.primaryId
    );
  }
  ownTask(taskId: string, canvasId = this.currentId) {
    this.primary.db
      .prepare('INSERT INTO canvas_task_owners VALUES(?,?) ON CONFLICT(task_id) DO NOTHING')
      .run(taskId, canvasId);
    this.assertTask(taskId);
  }
  assertTask(taskId: string) {
    if (this.taskOwner(taskId) !== this.currentId)
      throw new DomainError('missing_task', '此任务属于另一张画布。', 404);
  }
  recoverInterrupted() {
    for (const entry of this.rows()) {
      try {
        this.get(entry.id).recoverInterrupted();
      } catch (error) {
        if (entry.is_primary) throw error;
      }
    }
  }
  close() {
    for (const [key, store] of this.stores) if (key !== this.primaryId) store.close();
    this.stores.clear();
    this.stores.set(this.primaryId, this.primary);
  }
}
