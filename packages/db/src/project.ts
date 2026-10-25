import { createHash, randomUUID } from 'node:crypto';
import {
  DomainError,
  MAX_PROJECT_BYTES,
  ProjectFileSchema,
  type AppSnapshot,
  type ProjectFile,
  type ProjectPreview,
} from '@acc/domain';
import type { Store } from './index.ts';

// Stable key ordering permits normal JSON formatting/key-order changes without
// changing the checksum. Arrays retain their semantic order.
function canonical(value: unknown, depth = 0): string {
  if (depth > 64) throw new DomainError('invalid_project', '项目元数据嵌套过深。');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(obj[key], depth + 1)}`)
    .join(',')}}`;
}
const hashText = (text: string) =>
  `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
export const projectChecksum = (project: Omit<ProjectFile, 'checksum'>) =>
  hashText(canonical(project));
function invalid(message: string): never {
  throw new DomainError('invalid_project', message);
}

export function validateProject(raw: unknown): { project: ProjectFile; warnings: string[] } {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > MAX_PROJECT_BYTES)
    invalid('项目文件超过 12 MiB 限制。');
  const result = ProjectFileSchema.safeParse(raw);
  if (!result.success) invalid('项目格式或版本不受支持，或包含无效字段。');
  const project = result.data!;
  // Strictly reject any nested fields the current schema would otherwise strip.
  if (canonical(raw) !== canonical(project)) invalid('文件包含当前版本无法保留的字段。');
  const { checksum, ...payload } = project;
  if (checksum !== projectChecksum(payload))
    invalid('文件完整性校验失败，内容可能已损坏或被修改。');
  const s = project.snapshot;
  const warnings: string[] = [];
  const globalIds = new Set<string>([s.workspace.id]);
  const index = <T extends { id: string }>(values: T[]) => {
    const map = new Map<string, T>();
    for (const v of values) {
      if (globalIds.has(v.id)) invalid('项目包含重复 ID。');
      globalIds.add(v.id);
      map.set(v.id, v);
    }
    return map;
  };
  const conversations = index(s.conversations);
  const turns = index(s.turns);
  const turnsByConversation = new Map<string, typeof s.turns>();
  for (const turn of s.turns) {
    const group = turnsByConversation.get(turn.conversation_id) ?? [];
    group.push(turn);
    turnsByConversation.set(turn.conversation_id, group);
  }
  const blocks = index(s.blocks);
  const excerpts = index(s.excerpts);
  const nodes = index(s.nodes);
  index(s.edges);
  const sets = index(s.context_sets);
  const packages = new Map<string, ProjectFile['snapshot']['packages'][number]>();
  for (const p of s.packages) {
    if (globalIds.has(p.package_id) || packages.has(p.context_set_id))
      invalid('上下文包 ID 或所属上下文重复。');
    globalIds.add(p.package_id);
    packages.set(p.context_set_id, p);
  }
  for (const e of [...s.conversations, ...s.excerpts, ...s.nodes, ...s.edges, ...s.context_sets])
    if (e.workspace_id !== s.workspace.id) invalid('项目包含属于其他工作区的实体。');
  if (s.workspace.root_node_id !== null && !nodes.has(s.workspace.root_node_id))
    invalid('工作区入口节点不存在。');
  for (const nodeId of [
    ...s.workspace.settings.pinned_node_ids,
    ...s.workspace.settings.excluded_node_ids,
  ])
    if (!nodes.has(nodeId)) invalid('工作区固定或排除列表包含不存在的节点。');
  if (s.turns.some((t) => t.status === 'streaming'))
    invalid('文件包含尚未完成的生成，请等待生成结束后重新导出。');

  for (const c of s.conversations) {
    const ordered = (turnsByConversation.get(c.id) ?? []).sort((a, b) => a.sequence - b.sequence);
    if (c.root_turn_id !== (ordered[0]?.id ?? null)) invalid('对话根消息与历史不一致。');
    ordered.forEach((turn, i) => {
      if (turn.sequence !== i + 1 || turn.parent_turn_id !== (ordered[i - 1]?.id ?? null))
        invalid('对话顺序或父消息引用无效。');
    });
    if (c.branch_origin_excerpt_id !== null && !excerpts.has(c.branch_origin_excerpt_id))
      invalid('对话的分支来源摘录不存在。');
    if (c.summary_block_id !== null && !blocks.has(c.summary_block_id))
      invalid('对话摘要引用不存在。');
    const origin = c.fork_origin;
    if (origin) {
      if (
        origin.conversation_id === c.id ||
        !conversations.has(origin.conversation_id) ||
        (origin.turn_id !== null &&
          turns.get(origin.turn_id)?.conversation_id !== origin.conversation_id) ||
        origin.source_block_ids.some((id) => !blocks.has(id)) ||
        origin.source_excerpt_ids.some((id) => !excerpts.has(id)) ||
        s.conversations.some(
          (other) => other.id !== c.id && other.fork_origin?.request_id === origin.request_id,
        )
      )
        invalid('分叉背景或请求标识无效。');
      const seen = new Set([c.id]);
      let ancestor: typeof c | undefined = c;
      while (ancestor?.fork_origin) {
        const id = ancestor.fork_origin.conversation_id;
        if (seen.has(id)) invalid('分叉来源不能循环引用。');
        seen.add(id);
        ancestor = conversations.get(id);
      }
    }
  }
  for (const turn of s.turns) {
    if (!conversations.has(turn.conversation_id)) invalid('消息所属对话不存在。');
    if (turn.input_context_set_id !== null) {
      const ctx = sets.get(turn.input_context_set_id);
      const pkg = packages.get(turn.input_context_set_id);
      if (
        !ctx ||
        !pkg ||
        ctx.conversation_id !== turn.conversation_id ||
        ctx.target_turn_id !== turn.id ||
        ctx.status !== 'used'
      )
        invalid('回答的上下文来源记录无效。');
      const allowed = new Set(pkg.items.map((i) => i.source_id));
      if (
        [
          ...turn.used_source_ids,
          ...turn.suggested_graph_updates.flatMap((p) => p.source_ids),
        ].some((id) => !allowed.has(id))
      )
        invalid('回答引用了上下文包中不存在的来源。');
    }
  }
  const ordinals = new Set<string>();
  for (const b of s.blocks) {
    if (b.turn_id !== null && !turns.has(b.turn_id)) invalid('内容块所属消息不存在。');
    if (b.asset_id !== null || ['image', 'file'].includes(b.block_type))
      invalid('当前版本尚不支持带附件的项目导入。');
    if (b.text_content !== null && hashText(b.text_content) !== b.content_hash)
      invalid('内容块哈希与原文不一致。');
    if (b.turn_id !== null) {
      const key = `${b.turn_id}:${b.ordinal}`;
      if (ordinals.has(key)) invalid('同一消息中存在重复的内容块序号。');
      ordinals.add(key);
    }
  }
  for (const e of s.excerpts) {
    const b = blocks.get(e.source_block_id);
    if (
      !b ||
      b.text_content === null ||
      b.content_hash !== e.source_content_hash ||
      b.text_content.slice(e.selector.start_char, e.selector.end_char) !== e.snapshot_text ||
      e.selector.end_char > b.text_content.length
    )
      invalid('摘录的来源、哈希或文字范围无效。');
    if (e.collection_source_ids) {
      const ids = e.collection_source_ids;
      if (
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) =>
            !excerpts.has(id) ||
            (id !== e.id && excerpts.get(id)?.collection_source_ids !== undefined) ||
            !s.nodes.some((n) => n.ref_type === 'excerpt' && n.ref_id === id),
        )
      )
        invalid('汇合点必须保留有效且不重复的原始摘录。');
      if (
        s.excerpts.some((other) => other.id !== e.id && other.collection_source_ids?.includes(e.id))
      )
        invalid('汇合点不能嵌套。');
    }
  }
  for (const n of s.nodes) {
    const refs =
      n.ref_type === 'conversation' ? conversations : n.ref_type === 'turn' ? turns : excerpts;
    if (!refs.has(n.ref_id)) invalid('画布节点引用的实体不存在。');
  }
  for (const edge of s.edges) {
    const source = nodes.get(edge.source_node_id);
    const target = nodes.get(edge.target_node_id);
    if (!source || !target) invalid('连线端点不存在。');
    if (
      edge.type === 'branch_from' &&
      (source.ref_type !== 'excerpt' ||
        target.ref_type !== 'conversation' ||
        conversations.get(target.ref_id)?.branch_origin_excerpt_id !== source.ref_id)
    )
      invalid('分支连线与来源摘录不一致。');
    if (edge.type === 'excerpt_from') {
      const e = excerpts.get(target.ref_id);
      const block = e ? blocks.get(e.source_block_id) : null;
      const turn = block?.turn_id ? turns.get(block.turn_id) : null;
      if (
        target.ref_type !== 'excerpt' ||
        !turn ||
        (source.ref_type === 'conversation'
          ? source.ref_id !== turn.conversation_id
          : source.ref_type !== 'turn' || source.ref_id !== turn.id)
      )
        invalid('摘录连线与来源消息不一致。');
    }
    if (edge.type === 'continue_from' && target.ref_type === 'conversation') {
      const origin = conversations.get(target.ref_id)?.fork_origin;
      if (source.ref_type !== 'conversation' || !origin || origin.conversation_id !== source.ref_id)
        invalid('分叉连线与背景来源不一致。');
    }
  }
  for (const ctx of s.context_sets) {
    const pkg = packages.get(ctx.id);
    const current = nodes.get(ctx.current_node_id);
    if (
      !conversations.has(ctx.conversation_id) ||
      !current ||
      current.ref_type !== 'conversation' ||
      current.ref_id !== ctx.conversation_id ||
      !pkg
    )
      invalid('上下文所属对话或输入包不存在。');
    if (
      ctx.target_turn_id !== null &&
      (!turns.has(ctx.target_turn_id) ||
        turns.get(ctx.target_turn_id)?.input_context_set_id !== ctx.id)
    )
      invalid('上下文目标回答不匹配。');
    if (ctx.status === 'used' && ctx.target_turn_id === null)
      invalid('已使用的上下文缺少目标回答。');
    if (
      pkg.current_prompt !== ctx.prompt_text ||
      pkg.graph_snapshot_version !== ctx.graph_snapshot_version ||
      pkg.policy_version !== ctx.policy_version
    )
      invalid('上下文包与输入快照不一致。');
    if (ctx.graph_snapshot_version > s.workspace.revision)
      invalid('上下文快照版本超出工作区版本。');
    if (
      ['max_input_tokens', 'reserved_output_tokens', 'target_context_tokens'].some(
        (key) =>
          pkg.budget[key as keyof typeof ctx.budget] !== ctx.budget[key as keyof typeof ctx.budget],
      )
    )
      invalid('上下文包预算与输入快照不一致。');
    const missing = [
      ...ctx.selected_node_ids,
      ...ctx.pinned_node_ids,
      ...ctx.excluded_node_ids,
    ].some((id) => !nodes.has(id));
    if (missing && ctx.status === 'used') invalid('已使用的上下文包含缺失的来源节点。');
    if (missing) warnings.push('文件保留了含缺失引用的未发送预览；导入后仍需重新预览。');
    for (const item of pkg.items) {
      const node = nodes.get(item.node_id);
      const block = blocks.get(item.source_block_id);
      if (!node || !block || item.compressed)
        invalid('输入包包含缺失来源或当前版本不支持的压缩内容。');
      if (item.source_type === 'excerpt') {
        const e = excerpts.get(item.source_id);
        if (
          !e ||
          node.ref_type !== 'excerpt' ||
          node.ref_id !== e.id ||
          e.source_block_id !== item.source_block_id ||
          item.content !== e.snapshot_text
        )
          invalid('输入包摘录来源不一致。');
      } else {
        const turn = block.turn_id ? turns.get(block.turn_id) : null;
        if (
          item.source_id !== block.id ||
          item.content !== block.text_content ||
          !turn ||
          (node.ref_type === 'conversation'
            ? node.ref_id !== turn.conversation_id
            : node.ref_type !== 'turn' || node.ref_id !== turn.id)
        )
          invalid('输入包内容来源不一致。');
      }
      const sourceTurn = block.turn_id ? turns.get(block.turn_id) : null;
      if (
        item.actor !== (sourceTurn?.actor ?? null) ||
        item.sequence !== (sourceTurn?.sequence ?? null) ||
        hashText(item.content) !== item.content_hash
      )
        invalid('输入包来源元数据或哈希不一致。');
      if (ctx.excluded_node_ids.includes(item.node_id)) invalid('输入包包含当时明确排除的节点。');
    }
  }
  for (const pkg of s.packages)
    if (!sets.has(pkg.context_set_id)) invalid('输入包缺少所属上下文。');
  return { project, warnings: [...new Set(warnings)] };
}

export function exportProject(store: Store): ProjectFile {
  return store.transaction(() => {
    const snapshot = store.snapshot();
    if (snapshot.turns.some((t) => t.status === 'streaming'))
      throw new DomainError('generation_active', '请等待回答生成结束后再备份或恢复。', 409);
    const payload: Omit<ProjectFile, 'checksum'> = {
      format: 'ai-context-canvas',
      format_version: 1,
      exported_at: new Date().toISOString(),
      snapshot,
      assets: [],
    };
    const project = { ...payload, checksum: projectChecksum(payload) };
    return validateProject(project).project;
  });
}

export function previewProject(store: Store, raw: unknown): ProjectPreview {
  const { project, warnings } = validateProject(raw);
  const s = project.snapshot;
  const current = store.snapshot();
  return {
    name: s.workspace.name,
    checksum: project.checksum,
    counts: {
      conversations: s.conversations.length,
      turns: s.turns.length,
      excerpts: s.excerpts.length,
      nodes: s.nodes.length,
      contexts: s.packages.length,
    },
    warnings,
    current: {
      workspace_id: current.workspace.id,
      revision: current.workspace.revision,
      snapshot_hash: hashText(canonical(current)),
      name: current.workspace.name,
      nodes: current.nodes.length,
    },
  };
}

export function importProject(
  store: Store,
  raw: unknown,
  expected: { workspace_id: string; revision: number; snapshot_hash: string },
) {
  const { project } = validateProject(raw);
  return store.transaction(() => {
    const current = store.workspace();
    if (
      current.id !== expected.workspace_id ||
      current.revision !== expected.revision ||
      hashText(canonical(store.snapshot())) !== expected.snapshot_hash
    )
      throw new DomainError(
        'stale_import_preview',
        '当前工作区已变化，请重新校验后再确认导入。',
        409,
      );
    const backup = exportProject(store);
    const backupId = randomUUID();
    // The recovery copy is in the same transaction as replacement. Either the
    // old workspace and its data survive unchanged, or the complete import and
    // its recovery copy are committed together.
    store.db
      .prepare('INSERT INTO recovery_snapshots(id, created_at, name, payload) VALUES(?, ?, ?, ?)')
      .run(backupId, new Date().toISOString(), current.name, JSON.stringify(backup));
    store.db.exec(
      'DELETE FROM edges; DELETE FROM nodes; DELETE FROM excerpts; DELETE FROM content_blocks; DELETE FROM context_packages; DELETE FROM turns; DELETE FROM context_sets; DELETE FROM conversations; DELETE FROM workspaces;',
    );
    const s = project.snapshot;
    const restored: AppSnapshot = {
      ...s,
      workspace: {
        ...s.workspace,
        revision: Math.max(current.revision, s.workspace.revision) + 1,
        updated_at: new Date().toISOString(),
      },
    };
    store.saveWorkspace(restored.workspace);
    s.conversations.forEach((v) => store.saveConversation(v));
    const packages = new Map(s.packages.map((p) => [p.context_set_id, p]));
    s.context_sets.forEach((v) => store.saveContext(v, packages.get(v.id)!));
    [...s.turns].sort((a, b) => a.sequence - b.sequence).forEach((v) => store.saveTurn(v));
    s.blocks.forEach((v) => store.saveBlock(v));
    s.excerpts.forEach((v) => store.saveExcerpt(v));
    s.nodes.forEach((v) => store.saveNode(v));
    s.edges.forEach((v) => store.saveEdge(v));
    return { ok: true, recovery_id: backupId, workspace_id: restored.workspace.id };
  });
}

export function listRecoverySnapshots(store: Store) {
  return store.db
    .prepare('SELECT id, created_at, name FROM recovery_snapshots ORDER BY rowid DESC LIMIT 20')
    .all() as { id: string; created_at: string; name: string }[];
}
export function recoveryProject(store: Store, id: string): ProjectFile {
  const row = store.db.prepare('SELECT payload FROM recovery_snapshots WHERE id = ?').get(id);
  if (!row) throw new DomainError('missing_recovery', '恢复点不存在。', 404);
  return validateProject(JSON.parse(row.payload as string)).project;
}
