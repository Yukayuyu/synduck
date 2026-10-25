import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  WorkspaceSchema,
  ConversationSchema,
  TurnSchema,
  ContentBlockSchema,
  ExcerptSchema,
  NodeSchema,
  EdgeSchema,
  ContextSetSchema,
  ContextPackageSchema,
  AnswerSchema,
  CreateExcerptSchema,
  CreateForksSchema,
  DomainError,
  type Workspace,
  type Conversation,
  type Turn,
  type ContentBlock,
  type Excerpt,
  type CanvasNode,
  type Edge,
  type ContextSet,
  type ContextPackage,
  type Answer,
  type AppSnapshot,
} from '@acc/domain';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const contentHash = (text: string) =>
  `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

const migration = `
CREATE TABLE workspaces(id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE conversations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE context_sets(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE turns(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), parent_turn_id TEXT REFERENCES turns(id), input_context_set_id TEXT REFERENCES context_sets(id), sequence INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), UNIQUE(conversation_id, sequence));
CREATE UNIQUE INDEX one_generation_per_conversation ON turns(conversation_id) WHERE status = 'streaming';
CREATE TABLE content_blocks(id TEXT PRIMARY KEY, turn_id TEXT REFERENCES turns(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE excerpts(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), source_block_id TEXT NOT NULL REFERENCES content_blocks(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE nodes(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), conversation_id TEXT REFERENCES conversations(id), turn_id TEXT REFERENCES turns(id), excerpt_id TEXT REFERENCES excerpts(id), payload TEXT NOT NULL CHECK(json_valid(payload)), CHECK((conversation_id IS NOT NULL) + (turn_id IS NOT NULL) + (excerpt_id IS NOT NULL) = 1));
CREATE TABLE edges(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), source_node_id TEXT NOT NULL REFERENCES nodes(id), target_node_id TEXT NOT NULL REFERENCES nodes(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE context_packages(id TEXT PRIMARY KEY, context_set_id TEXT NOT NULL UNIQUE REFERENCES context_sets(id), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE INDEX conversations_workspace ON conversations(workspace_id);
CREATE INDEX turns_conversation ON turns(conversation_id, sequence);
CREATE INDEX blocks_turn ON content_blocks(turn_id);
CREATE INDEX nodes_workspace ON nodes(workspace_id);
CREATE INDEX edges_source ON edges(source_node_id);
CREATE INDEX edges_target ON edges(target_node_id);
`;

export class Store {
  readonly db: DatabaseSync;
  private inTransaction = false;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);',
    );
    if (!this.db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()) {
      this.transaction(() => {
        this.db.exec(migration);
        this.db.prepare('INSERT INTO schema_migrations VALUES(1, ?)').run(now());
      });
    }
    if (!this.db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()) {
      this.transaction(() => {
        this.db.exec(
          'CREATE TABLE recovery_snapshots(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));',
        );
        this.db.prepare('INSERT INTO schema_migrations VALUES(2, ?)').run(now());
      });
    }
    if (this.all('workspaces', WorkspaceSchema).length === 0) {
      const at = now();
      this.saveWorkspace({
        id: id(),
        name: '我的思考空间',
        description: null,
        root_node_id: null,
        schema_version: '0.1.0',
        revision: 0,
        settings: { pinned_node_ids: [], excluded_node_ids: [], viewport: { x: 0, y: 0, zoom: 1 } },
        created_at: at,
        updated_at: at,
      });
    }
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
  private all<T>(table: string, schema: z.ZodType<T>): T[] {
    return this.db
      .prepare(`SELECT payload FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => schema.parse(JSON.parse(row.payload as string)));
  }
  private put(
    table: string,
    entity: { id: string },
    columns: Record<string, string | number | null> = {},
  ) {
    const values = { id: entity.id, ...columns, payload: JSON.stringify(entity) };
    const keys = Object.keys(values);
    this.db
      .prepare(
        `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((k) => k !== 'id')
          .map((k) => `${k}=excluded.${k}`)
          .join(',')}`,
      )
      .run(...Object.values(values));
  }
  workspace() {
    return this.all('workspaces', WorkspaceSchema)[0];
  }
  snapshot(): AppSnapshot {
    return {
      workspace: this.workspace(),
      conversations: this.all('conversations', ConversationSchema),
      turns: this.all('turns', TurnSchema),
      blocks: this.all('content_blocks', ContentBlockSchema),
      excerpts: this.all('excerpts', ExcerptSchema),
      nodes: this.all('nodes', NodeSchema),
      edges: this.all('edges', EdgeSchema),
      context_sets: this.all('context_sets', ContextSetSchema),
      packages: this.all('context_packages', ContextPackageSchema),
    };
  }
  bump() {
    const w = this.workspace();
    this.saveWorkspace({ ...w, revision: w.revision + 1, updated_at: now() });
  }
  saveWorkspace(value: Workspace) {
    this.put('workspaces', WorkspaceSchema.parse(value));
  }
  saveConversation(value: Conversation) {
    const v = ConversationSchema.parse(value);
    this.put('conversations', v, { workspace_id: v.workspace_id });
  }
  saveTurn(value: Turn) {
    const v = TurnSchema.parse(value);
    this.put('turns', v, {
      conversation_id: v.conversation_id,
      parent_turn_id: v.parent_turn_id,
      input_context_set_id: v.input_context_set_id,
      sequence: v.sequence,
      status: v.status,
    });
  }
  saveBlock(value: ContentBlock) {
    const v = ContentBlockSchema.parse(value);
    this.put('content_blocks', v, { turn_id: v.turn_id });
  }
  saveExcerpt(value: Excerpt) {
    const v = ExcerptSchema.parse(value);
    this.put('excerpts', v, { workspace_id: v.workspace_id, source_block_id: v.source_block_id });
  }
  saveNode(value: CanvasNode) {
    const v = NodeSchema.parse(value);
    this.put('nodes', v, {
      workspace_id: v.workspace_id,
      conversation_id: v.ref_type === 'conversation' ? v.ref_id : null,
      turn_id: v.ref_type === 'turn' ? v.ref_id : null,
      excerpt_id: v.ref_type === 'excerpt' ? v.ref_id : null,
    });
  }
  setNodeDeleted(nodeId: string, deleted: boolean) {
    return this.transaction(() => {
      const snapshot = this.snapshot();
      const node = snapshot.nodes.find((n) => n.id === nodeId);
      if (!node) throw new DomainError('missing_node', '找不到卡片。', 404);
      if (
        snapshot.turns.some(
          (turn) =>
            turn.status === 'streaming' &&
            ((node.ref_type === 'conversation' && turn.conversation_id === node.ref_id) ||
              (node.ref_type === 'turn' && turn.id === node.ref_id)),
        )
      )
        throw new DomainError(
          'generation_active',
          '請等這段對話的回答完成後再刪除或還原卡片。',
          409,
        );
      if ((node.visibility === 'hidden') === deleted) return node;
      const position = deleted
        ? { x: node.x, y: node.y }
        : this.vacantPosition(
            node.x,
            node.y,
            Math.max(node.width, 360),
            Math.max(node.height, node.type === 'conversation' ? 650 : 420),
          );
      const updated = {
        ...node,
        ...position,
        visibility: deleted ? ('hidden' as const) : ('normal' as const),
        updated_at: now(),
      };
      this.saveNode(updated);
      this.bump();
      return updated;
    });
  }
  renameNode(nodeId: string, title: string) {
    return this.transaction(() => {
      const snapshot = this.snapshot();
      const node = snapshot.nodes.find((n) => n.id === nodeId);
      if (!node) throw new DomainError('missing_node', '找不到卡片。', 404);
      if (node.visibility === 'hidden')
        throw new DomainError('deleted_node', '請先從回收桶還原卡片。', 409);
      if (
        snapshot.turns.some(
          (turn) =>
            turn.status === 'streaming' &&
            ((node.ref_type === 'conversation' && turn.conversation_id === node.ref_id) ||
              (node.ref_type === 'turn' && turn.id === node.ref_id)),
        )
      )
        throw new DomainError('generation_active', '請等這段對話的回答完成後再重新命名。', 409);
      const updated = NodeSchema.parse({
        ...node,
        title: title.trim(),
        representation: { ...node.representation, overview: title.trim() },
        updated_at: now(),
      });
      if (updated.title === node.title) return node;
      if (node.ref_type === 'conversation') {
        const conversation = snapshot.conversations.find((c) => c.id === node.ref_id)!;
        this.saveConversation({
          ...conversation,
          title: updated.title,
          updated_at: updated.updated_at,
        });
      } else if (node.ref_type === 'excerpt') {
        const excerpt = snapshot.excerpts.find((e) => e.id === node.ref_id)!;
        this.saveExcerpt({ ...excerpt, title: updated.title });
      }
      this.saveNode(updated);
      this.bump();
      return updated;
    });
  }
  saveEdge(value: Edge) {
    const v = EdgeSchema.parse(value);
    this.put('edges', v, {
      workspace_id: v.workspace_id,
      source_node_id: v.source_node_id,
      target_node_id: v.target_node_id,
    });
  }
  saveContext(value: ContextSet, pkg: ContextPackage) {
    this.transaction(() => {
      const v = ContextSetSchema.parse(value);
      const p = ContextPackageSchema.parse(pkg);
      if (v.id !== p.context_set_id)
        throw new DomainError('context_mismatch', 'Context package does not match its set');
      const existing = this.db.prepare('SELECT payload FROM context_sets WHERE id = ?').get(v.id);
      const stored = this.db
        .prepare('SELECT payload FROM context_packages WHERE context_set_id = ?')
        .get(v.id);
      if (existing) {
        const before = ContextSetSchema.parse(JSON.parse(existing.payload as string));
        const transition = { ...before, status: v.status, target_turn_id: v.target_turn_id };
        if (
          JSON.stringify(transition) !== JSON.stringify(v) ||
          (before.status === 'used' &&
            (v.status !== 'used' || before.target_turn_id !== v.target_turn_id))
        )
          throw new DomainError('immutable_context', '已保存的上下文快照不可修改。', 409);
      }
      if (
        stored &&
        JSON.stringify(ContextPackageSchema.parse(JSON.parse(stored.payload as string))) !==
          JSON.stringify(p)
      )
        throw new DomainError('immutable_context', '已保存的输入包不可修改。', 409);
      this.put('context_sets', v, { conversation_id: v.conversation_id });
      this.put('context_packages', { ...p, id: p.package_id }, { context_set_id: v.id });
    });
  }
  private vacantPosition(x: number, y: number, width: number, height: number) {
    // Place only the new card. Existing user positions are never rearranged.
    const occupied = this.snapshot().nodes.filter((node) => node.visibility !== 'hidden');
    let collision: CanvasNode | undefined;
    while (
      (collision = occupied.find(
        (node) =>
          x < node.x + Math.max(node.width, 360) + 60 &&
          x + width + 60 > node.x &&
          y < node.y + Math.max(node.height, node.ref_type === 'conversation' ? 650 : 420) + 60 &&
          y + height + 60 > node.y,
      ))
    ) {
      const next =
        collision.y +
        Math.max(collision.height, collision.ref_type === 'conversation' ? 650 : 420) +
        80;
      if (!Number.isFinite(next) || next <= y)
        throw new DomainError(
          'invalid_position',
          '此位置無法放置新卡片，請移到畫布其他位置。',
          400,
        );
      y = next;
    }
    return { x, y };
  }
  private createNode(type: CanvasNode['type'], refId: string, title: string, x: number, y: number) {
    const height = type === 'conversation' ? 650 : 420;
    const width = type === 'conversation' ? 420 : 280;
    ({ x, y } = this.vacantPosition(x, y, width, height));
    const at = now();
    const n: CanvasNode = {
      id: id(),
      workspace_id: this.workspace().id,
      type,
      ref_type: type,
      ref_id: refId,
      title,
      x,
      y,
      width,
      height,
      z_index: 0,
      collapsed: false,
      visibility: 'normal',
      context_state: 'active',
      representation: { overview: title, summary: '' },
      created_by: 'human',
      created_at: at,
      updated_at: at,
    };
    this.saveNode(n);
    return n;
  }
  private structural(
    source: string,
    target: string,
    type: 'excerpt_from' | 'branch_from' | 'continue_from',
  ) {
    const at = now();
    this.saveEdge({
      id: id(),
      workspace_id: this.workspace().id,
      source_node_id: source,
      target_node_id: target,
      edge_class: 'structural',
      type,
      direction: 'directed',
      provenance: 'system',
      confidence: null,
      confirmed: true,
      label: null,
      metadata: {},
      created_at: at,
      updated_at: at,
    });
  }
  createConversation(title: string, origin?: Excerpt, position?: { x: number; y: number }) {
    return this.transaction(() => {
      const w = this.workspace();
      const count = this.snapshot().conversations.length;
      const at = now();
      const c: Conversation = {
        id: id(),
        workspace_id: w.id,
        title,
        status: 'active',
        root_turn_id: null,
        summary_block_id: null,
        branch_origin_excerpt_id: origin?.id ?? null,
        created_at: at,
        updated_at: at,
      };
      this.saveConversation(c);
      const node = this.createNode(
        'conversation',
        c.id,
        title,
        position?.x ?? 100 + (count % 3) * 460,
        position?.y ?? 100 + Math.floor(count / 3) * 740,
      );
      if (!w.root_node_id) this.saveWorkspace({ ...w, root_node_id: node.id });
      this.bump();
      return { conversation: c, node };
    });
  }
  createExcerpt(input: z.input<typeof CreateExcerptSchema>) {
    const request = CreateExcerptSchema.parse(input);
    return this.transaction(() => {
      const s = this.snapshot();
      const block = s.blocks.find((b) => b.id === request.source_block_id);
      if (!block || block.text_content === null)
        throw new DomainError('missing_source', '找不到摘录来源', 404);
      const sel = request.selector;
      if (
        contentHash(block.text_content) !== request.source_content_hash ||
        block.content_hash !== request.source_content_hash ||
        block.text_content.slice(sel.start_char, sel.end_char) !== sel.exact ||
        sel.end_char > block.text_content.length
      )
        throw new DomainError('stale_source', '来源已变化，请重新选择文字', 409);
      const turn = s.turns.find((t) => t.id === block.turn_id);
      const sourceNode = s.nodes.find(
        (n) => n.ref_type === 'conversation' && n.ref_id === turn?.conversation_id,
      );
      if (!sourceNode) throw new DomainError('missing_source', '来源对话不存在', 404);
      if (sourceNode.visibility === 'hidden')
        throw new DomainError('deleted_node', '請先還原來源卡片，再建立摘錄。', 409);
      const excerpt: Excerpt = {
        id: id(),
        workspace_id: s.workspace.id,
        source_block_id: block.id,
        selector: sel,
        snapshot_text: sel.exact,
        source_content_hash: block.content_hash,
        title: sel.exact.slice(0, 60),
        created_by: 'human',
        created_at: now(),
      };
      this.saveExcerpt(excerpt);
      const siblings = s.edges.filter(
        (e) => e.source_node_id === sourceNode.id && e.type === 'excerpt_from',
      ).length;
      const node = this.createNode(
        'excerpt',
        excerpt.id,
        excerpt.title,
        sourceNode.x + 460,
        sourceNode.y + siblings * 740,
      );
      this.structural(sourceNode.id, node.id, 'excerpt_from');
      const branch = request.branch ? this.branchExcerpt(excerpt.id) : null;
      this.bump();
      return { excerpt, node, branch };
    });
  }
  branchExcerpt(excerptId: string) {
    return this.transaction(() => {
      const s = this.snapshot();
      const excerpt = s.excerpts.find((e) => e.id === excerptId);
      const node = s.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === excerptId);
      if (!excerpt || !node) throw new DomainError('missing_excerpt', '找不到摘录', 404);
      if (node.visibility === 'hidden')
        throw new DomainError('deleted_node', '請先還原摘錄卡片，再建立分支。', 409);
      const branches = s.edges.filter(
        (e) => e.source_node_id === node.id && e.type === 'branch_from',
      ).length;
      const result = this.createConversation(`分支 · ${excerpt.title.slice(0, 45)}`, excerpt, {
        x: node.x + 460,
        y: node.y + branches * 740,
      });
      this.structural(node.id, result.node.id, 'branch_from');
      return result;
    });
  }
  createForks(input: z.infer<typeof CreateForksSchema>) {
    const request = CreateForksSchema.parse(input);
    return this.transaction(() => {
      const s = this.snapshot();
      const parent = s.conversations.find((c) => c.id === request.conversation_id);
      const parentNode = s.nodes.find(
        (n) => n.ref_type === 'conversation' && n.ref_id === parent?.id,
      );
      if (!parent || !parentNode || parentNode.visibility === 'hidden')
        throw new DomainError('missing_conversation', '找不到可分叉的对话', 404);
      if (new Set(request.branches.map((b) => b.request_id)).size !== request.branches.length)
        throw new DomainError('duplicate_request', '分支请求不能重复');
      const turns = s.turns
        .filter((t) => t.conversation_id === parent.id && t.status === 'complete')
        .sort((a, b) => a.sequence - b.sequence);
      const turnIds = new Set(turns.map((t) => t.id));
      const origin = s.excerpts.find((e) => e.id === parent.branch_origin_excerpt_id);
      const sourceBlocks = [
        ...new Set([
          ...(parent.fork_origin?.source_block_ids ?? []),
          ...s.blocks.filter((b) => b.turn_id && turnIds.has(b.turn_id)).map((b) => b.id),
        ]),
      ];
      const sourceExcerpts = [
        ...new Set([
          ...(parent.fork_origin?.source_excerpt_ids ?? []),
          ...(origin ? (origin.collection_source_ids ?? [origin.id]) : []),
        ]),
      ];
      if (sourceBlocks.length > 2000 || sourceExcerpts.length > 200)
        throw new DomainError('fork_too_large', '背景过多，请先摘录需要的部分再分支。');
      return request.branches.map((entry, index) => {
        const existing = this.snapshot().conversations.find(
          (c) => c.fork_origin?.request_id === entry.request_id,
        );
        if (existing) {
          if (
            existing.fork_origin?.conversation_id !== parent.id ||
            existing.fork_origin.initial_prompt !== entry.prompt ||
            existing.fork_origin.mode !== entry.mode
          )
            throw new DomainError('request_conflict', '此分支请求已用于其他内容。', 409);
          const node = s.nodes.find(
            (n) => n.ref_type === 'conversation' && n.ref_id === existing.id,
          );
          if (!node || node.visibility === 'hidden')
            throw new DomainError('deleted_node', '分支已删除，请先还原。', 409);
          return { conversation: existing, node };
        }
        const created = this.createConversation(entry.prompt.slice(0, 48), undefined, {
          x: parentNode.x + 600,
          y: parentNode.y + index * 820,
        });
        const conversation: Conversation = {
          ...created.conversation,
          fork_origin: {
            conversation_id: parent.id,
            turn_id: turns.at(-1)?.id ?? null,
            mode: entry.mode,
            request_id: entry.request_id,
            initial_prompt: entry.prompt,
            source_block_ids: sourceBlocks,
            source_excerpt_ids: sourceExcerpts,
          },
        };
        this.saveConversation(conversation);
        this.structural(parentNode.id, created.node.id, 'continue_from');
        return { ...created, conversation };
      });
    });
  }
  addToCollection(excerptId: string, input: z.input<typeof CreateExcerptSchema>) {
    return this.transaction(() => {
      const s = this.snapshot();
      const anchor = s.excerpts.find((e) => e.id === excerptId);
      const node = s.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === excerptId);
      if (!anchor || !node || node.visibility === 'hidden')
        throw new DomainError('missing_excerpt', '找不到汇合点', 404);
      if (
        s.excerpts.some((e) => e.id !== anchor.id && e.collection_source_ids?.includes(anchor.id))
      )
        throw new DomainError('nested_collection', '请加入已有的汇合点。');
      const request = CreateExcerptSchema.parse({ ...input, branch: false });
      const ids = anchor.collection_source_ids ?? [anchor.id];
      const duplicate = s.excerpts.find(
        (e) =>
          ids.includes(e.id) &&
          e.source_block_id === request.source_block_id &&
          e.source_content_hash === request.source_content_hash &&
          e.selector.start_char === request.selector.start_char &&
          e.selector.end_char === request.selector.end_char,
      );
      // Validate source hashes even on an idempotent duplicate add.
      const block = s.blocks.find((b) => b.id === request.source_block_id);
      if (
        !block ||
        contentHash(block.text_content ?? '') !== request.source_content_hash ||
        block.text_content?.slice(request.selector.start_char, request.selector.end_char) !==
          request.selector.exact
      )
        throw new DomainError('stale_source', '来源已变化，请重新选择文字', 409);
      if (duplicate) return { excerpt: anchor, node };
      if (ids.length >= 200)
        throw new DomainError('collection_full', '汇合点最多保留 200 处摘录。');
      const source = this.createExcerpt(request);
      const excerpt: Excerpt = { ...anchor, collection_source_ids: [...ids, source.excerpt.id] };
      this.saveExcerpt(excerpt);
      this.bump();
      return { excerpt, node };
    });
  }
  removeCollectionSource(excerptId: string, sourceId: string) {
    return this.transaction(() => {
      const s = this.snapshot();
      const anchor = s.excerpts.find((e) => e.id === excerptId);
      const node = s.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === excerptId);
      if (!anchor || !node || node.visibility === 'hidden')
        throw new DomainError('missing_excerpt', '找不到汇合点', 404);
      const ids = anchor.collection_source_ids ?? [anchor.id];
      if (!ids.includes(sourceId))
        throw new DomainError('missing_source', '摘录不在此汇合点中。', 404);
      if (ids.length === 1)
        throw new DomainError('empty_collection', '请至少保留一处摘录，或删除整个汇合点。');
      const excerpt = { ...anchor, collection_source_ids: ids.filter((id) => id !== sourceId) };
      this.saveExcerpt(excerpt);
      this.bump();
      return { excerpt, node };
    });
  }
  appendTurn(
    conversationId: string,
    actor: 'human' | 'assistant',
    text: string | null,
    options?: { context: string; provider: string; model: string },
  ) {
    const s = this.snapshot();
    const c = s.conversations.find((c) => c.id === conversationId);
    if (!c) throw new DomainError('missing_conversation', '找不到对话', 404);
    const previous = s.turns
      .filter((t) => t.conversation_id === conversationId)
      .sort((a, b) => a.sequence - b.sequence)
      .at(-1);
    const turn: Turn = {
      id: id(),
      conversation_id: conversationId,
      parent_turn_id: previous?.id ?? null,
      actor,
      sequence: (previous?.sequence ?? 0) + 1,
      model_provider: options?.provider ?? null,
      model_id: options?.model ?? null,
      input_context_set_id: options?.context ?? null,
      status: text === null ? 'streaming' : 'complete',
      created_at: now(),
      used_source_ids: [],
      suggested_graph_updates: [],
      error: null,
    };
    this.saveTurn(turn);
    if (text !== null) this.addText(turn.id, text);
    this.saveConversation({ ...c, root_turn_id: c.root_turn_id ?? turn.id, updated_at: now() });
    return turn;
  }
  private addText(turnId: string, text: string) {
    const at = now();
    const b: ContentBlock = {
      id: id(),
      turn_id: turnId,
      block_type: 'text',
      ordinal: 0,
      mime_type: 'text/plain',
      text_content: text,
      content_hash: contentHash(text),
      asset_id: null,
      structured_data: null,
      created_at: at,
      updated_at: at,
    };
    this.saveBlock(b);
    return b;
  }
  beginAnswer(contextId: string, provider: string, model: string) {
    return this.transaction(() => {
      const s = this.snapshot();
      const set = s.context_sets.find((c) => c.id === contextId);
      const pkg = s.packages.find((p) => p.context_set_id === contextId);
      if (!set || !pkg) throw new DomainError('missing_context', '请先预览上下文', 404);
      if (set.status === 'used')
        throw new DomainError('already_used', '该上下文已发送，请创建新预览', 409);
      if (set.graph_snapshot_version !== s.workspace.revision)
        throw new DomainError('stale_preview', '内容已变化，请重新预览后发送', 409);
      if (!pkg.sendable)
        throw new DomainError('context_blocked', '上下文存在阻塞问题，请先处理', 409);
      if (
        s.turns.some((t) => t.conversation_id === set.conversation_id && t.status === 'streaming')
      )
        throw new DomainError('busy', '对话正在生成回答', 409);
      this.appendTurn(set.conversation_id, 'human', set.prompt_text);
      const turn = this.appendTurn(set.conversation_id, 'assistant', null, {
        context: set.id,
        provider,
        model,
      });
      this.saveContext({ ...set, status: 'used', target_turn_id: turn.id }, pkg);
      this.bump();
      return { turn, pkg };
    });
  }
  finishAnswer(turnId: string, raw: Answer) {
    const answer = AnswerSchema.parse(raw);
    return this.transaction(() => {
      const s = this.snapshot();
      const turn = s.turns.find((t) => t.id === turnId);
      if (!turn || turn.status !== 'streaming')
        throw new DomainError('invalid_turn', '回答状态已变化', 409);
      const pkg = s.packages.find((p) => p.context_set_id === turn.input_context_set_id);
      const allowed = new Set(pkg?.items.map((i) => i.source_id));
      if (
        [
          ...answer.used_source_ids,
          ...answer.suggested_graph_updates.flatMap((p) => p.source_ids),
        ].some((source) => !allowed.has(source))
      )
        throw new DomainError('invalid_sources', '模型返回了未提供的来源', 502);
      this.addText(turn.id, answer.answer);
      this.saveTurn({
        ...turn,
        status: 'complete',
        used_source_ids: answer.used_source_ids,
        suggested_graph_updates: answer.suggested_graph_updates,
      });
      const node = s.nodes.find(
        (n) => n.ref_type === 'conversation' && n.ref_id === turn.conversation_id,
      );
      if (node)
        this.saveNode({
          ...node,
          representation: { ...node.representation, summary: answer.answer.slice(0, 180) },
          updated_at: now(),
        });
      this.bump();
    });
  }
  failAnswer(turnId: string, message: string) {
    this.transaction(() => {
      const t = this.snapshot().turns.find((t) => t.id === turnId);
      if (t?.status === 'streaming') {
        this.saveTurn({ ...t, status: 'error', error: message });
        this.bump();
      }
    });
  }
  recoverInterrupted() {
    for (const t of this.snapshot().turns.filter((t) => t.status === 'streaming'))
      this.failAnswer(t.id, '服务重启中断了生成，可重试。');
  }
}

export {
  exportProject,
  validateProject,
  previewProject,
  importProject,
  listRecoverySnapshots,
  recoveryProject,
} from './project.ts';
