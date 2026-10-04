import { createHash } from 'node:crypto';
import { ANSWER_INSTRUCTIONS, ContextPackageSchema, ContextSetSchema, modelInput,
  type GraphSnapshot, type ContextSet, type ContextPackage, type ContextItem, type CanvasNode } from '@acc/domain';

// UTF-8 bytes are deliberately conservative, including CJK and emoji.
// These are estimates, never claimed as a provider tokenizer's exact counts.
export const estimateTokens = (text: string) => Buffer.byteLength(text, 'utf8');
const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export function compileContext(snapshot: GraphSnapshot, raw: ContextSet): ContextPackage {
  const set = ContextSetSchema.parse(raw);
  const excluded: ContextPackage['excluded'] = [];
  const conflicts: ContextPackage['conflicts'] = [];
  const diagnostics: string[] = [];
  const candidates: ContextItem[] = [];
  const explicitlyExcluded = new Set(set.excluded_node_ids);
  const blockedBlocks = new Set<string>();
  let blocked = false;
  const nodeById = new Map(snapshot.nodes.map(n => [n.id, n]));
  const blockById = new Map(snapshot.blocks.map(b => [b.id, b]));
  const excerptById = new Map(snapshot.excerpts.map(e => [e.id, e]));
  const blocksForNode = (node: CanvasNode) => {
    if (node.ref_type === 'excerpt') return [excerptById.get(node.ref_id)?.source_block_id].filter((v): v is string => Boolean(v));
    const turns = node.ref_type === 'turn' ? [node.ref_id] : snapshot.turns.filter(t => t.conversation_id === node.ref_id && t.status === 'complete').map(t => t.id);
    return snapshot.blocks.filter(b => b.turn_id !== null && turns.includes(b.turn_id)).map(b => b.id);
  };
  const omit = (nodeId: string, reason: string, sourceId: string | null = null) => excluded.push({ node_id: nodeId, source_id: sourceId, reason });
  for (const nodeId of explicitlyExcluded) {
    const node = nodeById.get(nodeId);
    if (node) blocksForNode(node).forEach(b => blockedBlocks.add(b));
    omit(nodeId, 'explicitly excluded');
  }
  const roles = new Map<string, ContextItem['role']>();
  const priorities: Record<ContextItem['role'], number> = { selected: 1, pinned: 0.98, branch_origin: 0.9, current: 0.85, related: 0.6, historical: 0.3 };
  const add = (nodeId: string, role: ContextItem['role']) => {
    if (!roles.has(nodeId) || priorities[role] > priorities[roles.get(nodeId)!]) roles.set(nodeId, role);
  };
  add(set.current_node_id, 'current');
  set.selected_node_ids.forEach(n => add(n, 'selected'));
  set.pinned_node_ids.forEach(n => add(n, 'pinned'));
  const conversation = snapshot.conversations.find(c => c.id === set.conversation_id);
  const origin = snapshot.nodes.find(n => n.ref_type === 'excerpt' && n.ref_id === conversation?.branch_origin_excerpt_id);
  if (origin) add(origin.id, 'branch_origin');
  // Only directly addressable excerpts are retrieved structurally. Traversing the
  // parent conversation would import unrelated siblings into a new branch.
  for (const edge of snapshot.edges) {
    const neighbor = edge.source_node_id === set.current_node_id ? edge.target_node_id : edge.target_node_id === set.current_node_id ? edge.source_node_id : null;
    if (neighbor && edge.edge_class === 'structural' && nodeById.get(neighbor)?.ref_type === 'excerpt') add(neighbor, 'related');
    if (neighbor && edge.edge_class === 'semantic' && edge.confirmed && ['supports', 'elaborates', 'related_to', 'depends_on'].includes(edge.type)) add(neighbor, 'related');
    // Direction convention: the new source supersedes the old target.
    if (edge.edge_class === 'semantic' && edge.confirmed && edge.type === 'supersedes' && (roles.has(edge.source_node_id) || roles.has(edge.target_node_id)))
      conflicts.push({ a: edge.target_node_id, b: edge.source_node_id, type: 'superseded_by', resolution: 'prefer the newer source; older target is historical', status: 'resolved' });
  }
  const superseded = new Set(conflicts.filter(c => c.type === 'superseded_by').map(c => c.a));
  for (const [nodeId, originalRole] of roles) {
    if (explicitlyExcluded.has(nodeId)) continue;
    const node = nodeById.get(nodeId);
    const explicit = originalRole === 'selected' || originalRole === 'pinned';
    if (!node || node.workspace_id !== set.workspace_id) {
      conflicts.push({ a: nodeId, b: null, type: 'missing_reference', resolution: 'remove or restore the missing reference', status: 'unresolved' });
      omit(nodeId, 'missing reference'); if (explicit || originalRole === 'current') blocked = true; continue;
    }
    if (node.context_state === 'rejected' && !explicit) { omit(nodeId, 'rejected by lifecycle policy'); continue; }
    const historical = ['superseded', 'rejected'].includes(node.context_state) || superseded.has(node.id);
    const role = historical ? 'historical' : originalRole;
    const score = priorities[originalRole] + (node.context_state === 'confirmed' ? 0.02 : 0) - (node.context_state === 'deprecated' ? 0.2 : 0);
    const blockIds = blocksForNode(node);
    if (blockIds.length === 0 && node.ref_type !== 'conversation') { omit(nodeId, 'missing source'); if (explicit) blocked = true; }
    for (const blockId of blockIds) {
      const block = blockById.get(blockId);
      if (blockedBlocks.has(blockId)) { omit(nodeId, 'source overlaps explicitly excluded content', blockId); continue; }
      if (!block || block.text_content === null) { omit(nodeId, 'source has no supported text', blockId); if (explicit) blocked = true; continue; }
      const excerpt = node.ref_type === 'excerpt' ? excerptById.get(node.ref_id) : null;
      const content = excerpt?.snapshot_text ?? block.text_content;
      if (hash(block.text_content) !== block.content_hash || (excerpt && (excerpt.source_content_hash !== block.content_hash || block.text_content.slice(excerpt.selector.start_char, excerpt.selector.end_char) !== excerpt.snapshot_text))) {
        conflicts.push({ a: nodeId, b: blockId, type: 'content_mismatch', resolution: 'reselect the excerpt from the current source', status: 'unresolved' });
        omit(nodeId, 'source content hash or selector mismatch', blockId); if (explicit || originalRole === 'branch_origin') blocked = true; continue;
      }
      candidates.push({ source_type: excerpt ? 'excerpt' : 'content_block', source_id: excerpt?.id ?? block.id, source_block_id: block.id, node_id: nodeId,
        role, state: superseded.has(nodeId) ? 'superseded' : node.context_state, content, content_hash: hash(content), score,
        reason: `${originalRole}${historical ? '; historical, not a current fact' : ''}${explicit ? '; explicit user control' : '; deterministic structural retrieval'}`,
        token_estimate: estimateTokens(content), compressed: false });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.node_id.localeCompare(b.node_id) || a.source_id.localeCompare(b.source_id));
  const items: ContextItem[] = [];
  const seen = new Set<string>();
  let deduplicated = 0;
  // Keep schema/framing headroom as well as the configured output reserve.
  const inputLimit = set.budget.max_input_tokens - set.budget.reserved_output_tokens;
  const inputSize = (next: ContextItem[]) => estimateTokens(ANSWER_INSTRUCTIONS + modelInput({ current_prompt: set.prompt_text, items: next, conflicts })) + 1024;
  let used = 0;
  for (const item of candidates) {
    const dedupe = `${item.source_block_id}:${item.content_hash}`;
    if (seen.has(dedupe)) { deduplicated++; omit(item.node_id, 'duplicate source content', item.source_id); continue; }
    const explicit = set.selected_node_ids.includes(item.node_id) || set.pinned_node_ids.includes(item.node_id);
    if (used + item.token_estimate > set.budget.target_context_tokens || inputSize([...items, item]) > inputLimit) {
      omit(item.node_id, explicit ? 'explicit source exceeds budget; sending blocked' : 'omitted to fit context budget', item.source_id);
      if (explicit) { blocked = true; diagnostics.push('选中或固定的原文超过预算；请增加预算或减少选择。不会静默删减后发送。'); }
      continue;
    }
    seen.add(dedupe); items.push(item); used += item.token_estimate;
  }
  if (inputSize(items) > inputLimit) { blocked = true; diagnostics.push('当前问题和必要元数据超过输入预算。'); }
  if (snapshot.workspace.id !== set.workspace_id || !conversation || conversation.workspace_id !== set.workspace_id) { blocked = true; diagnostics.push('上下文工作区或对话不匹配。'); }
  return ContextPackageSchema.parse({
    package_id: `pkg_${set.id}`, context_set_id: set.id, policy_version: set.policy_version, graph_snapshot_version: set.graph_snapshot_version,
    current_prompt: set.prompt_text, items, excluded, conflicts, diagnostics: [...new Set(diagnostics)], sendable: !blocked,
    budget: { ...set.budget, used_context_tokens: used, estimated_input_tokens: inputSize(items) },
    trace: { resolved_candidates: candidates.length, included_items: items.length, deduplicated_items: deduplicated },
  });
}
