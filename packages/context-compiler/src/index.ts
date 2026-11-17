import { createHash } from 'node:crypto';
import {
  ANSWER_INSTRUCTIONS,
  ContextPackageSchema,
  ContextSetSchema,
  modelInput,
  collectionSources,
  conversationSummaries,
  SUMMARY_PROMPT,
  type GraphSnapshot,
  type ContextThread,
  type Conversation,
  type ContextSet,
  type ContextPackage,
  type ContextItem,
  type CanvasNode,
  type ContextState,
} from '@acc/domain';

// UTF-8 bytes are deliberately conservative, including CJK and emoji.
// These are estimates, never claimed as a provider tokenizer's exact counts.
export const estimateTokens = (text: string) => Buffer.byteLength(text, 'utf8');
const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

const blocksForNode = (snapshot: GraphSnapshot, node: CanvasNode) => {
  if (node.ref_type === 'excerpt')
    return [snapshot.excerpts.find((e) => e.id === node.ref_id)?.source_block_id].filter(
      (value): value is string => Boolean(value),
    );
  const turns = new Set(
    node.ref_type === 'turn'
      ? [node.ref_id]
      : snapshot.turns
          .filter((t) => t.conversation_id === node.ref_id && t.status === 'complete')
          .map((t) => t.id),
  );
  return snapshot.blocks
    .filter((block) => block.turn_id !== null && turns.has(block.turn_id))
    .map((block) => block.id);
};
export function excludedSources(snapshot: GraphSnapshot, excludedNodeIds: string[]) {
  const deletedNodes = new Set(
    snapshot.nodes.filter((node) => node.visibility === 'hidden').map((node) => node.id),
  );
  const nodes = new Set([...excludedNodeIds, ...deletedNodes]);
  const blocks = new Set<string>();
  const derivedBlocks = new Set<string>();
  for (const node of snapshot.nodes) {
    if (!nodes.has(node.id)) continue;
    const collection =
      node.ref_type === 'excerpt'
        ? snapshot.excerpts.find((e) => e.id === node.ref_id)?.collection_source_ids
        : undefined;
    if (collection) {
      for (const id of collection) {
        const excerpt = snapshot.excerpts.find((e) => e.id === id);
        if (excerpt) blocks.add(excerpt.source_block_id);
      }
    } else blocksForNode(snapshot, node).forEach((id) => blocks.add(id));
  }
  // Follow immutable inputs transitively; answers can paraphrase uncited inputs.
  let changed = true;
  while (changed) {
    changed = false;
    for (const turn of snapshot.turns) {
      if (turn.actor !== 'assistant') continue;
      const pkg = snapshot.packages?.find(
        (pkg) => pkg.context_set_id === turn.input_context_set_id,
      );
      if (!pkg?.items.some((item) => blocks.has(item.source_block_id) || nodes.has(item.node_id)))
        continue;
      for (const block of snapshot.blocks.filter((block) => block.turn_id === turn.id)) {
        if (!blocks.has(block.id)) {
          blocks.add(block.id);
          derivedBlocks.add(block.id);
          changed = true;
        }
      }
    }
  }
  return { nodes, blocks, derivedBlocks, deletedNodes };
}

// Derives the context chain: which conversations contributed sources and how each
// one relates to the conversation being answered. Uses only fork records, branch-origin
// excerpts and collection membership; canvas coordinates and model output play no part.
function contextThreads(
  snapshot: GraphSnapshot,
  current: Conversation | undefined,
  blockedBlocks: Set<string>,
  collectionRoots: Map<string, string>,
) {
  const conversations = new Map(snapshot.conversations.map((c) => [c.id, c]));
  const turns = new Map(snapshot.turns.map((t) => [t.id, t]));
  const blocks = new Map(snapshot.blocks.map((b) => [b.id, b]));
  const excerpts = new Map(snapshot.excerpts.map((e) => [e.id, e]));
  const threadOfBlock = (blockId: string) =>
    turns.get(blocks.get(blockId)?.turn_id ?? '')?.conversation_id;
  const parents = (conversation: Conversation) => {
    const found: { id: string; via: NonNullable<ContextThread['via']> }[] = [];
    if (conversation.fork_origin)
      found.push({
        id: conversation.fork_origin.conversation_id,
        via: conversation.fork_origin.mode,
      });
    const origin = excerpts.get(conversation.branch_origin_excerpt_id ?? '');
    for (const source of origin ? collectionSources(snapshot, origin) : []) {
      const id = threadOfBlock(source.source_block_id);
      if (id) found.push({ id, via: origin?.collection_source_ids ? 'merge' : 'excerpt' });
    }
    return found;
  };
  // Breadth-first, so a thread reachable by several routes keeps its nearest depth.
  const ancestry = new Map<string, { depth: number; via: NonNullable<ContextThread['via']> }>();
  let frontier = current ? [current] : [];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Conversation[] = [];
    for (const conversation of frontier)
      for (const parent of parents(conversation)) {
        if (parent.id === current?.id || ancestry.has(parent.id)) continue;
        ancestry.set(parent.id, { depth, via: parent.via });
        const found = conversations.get(parent.id);
        if (found) next.push(found);
      }
    frontier = next;
  }
  // Titles are often derived from a quote or a first question. A thread is named only
  // when its own messages are in the input, so a title can never carry unpicked,
  // removed or excluded text into the model.
  const title = (conversation: Conversation, quotedOnly: boolean) => {
    if (quotedOnly || conversation.branch_origin_excerpt_id) return null;
    const blocked = snapshot.blocks.some(
      (b) =>
        blockedBlocks.has(b.id) && turns.get(b.turn_id ?? '')?.conversation_id === conversation.id,
    );
    if (blocked) return null;
    return (
      snapshot.nodes.find(
        (n) =>
          n.ref_type === 'conversation' &&
          n.ref_id === conversation.id &&
          n.visibility !== 'hidden',
      )?.title ?? conversation.title
    );
  };
  return (items: ContextItem[]): ContextThread[] => {
    const used: string[] = [];
    const merged = new Set<string>();
    const whole = new Set<string>();
    for (const item of items) {
      if (!item.thread_id) continue;
      if (item.source_type === 'content_block') whole.add(item.thread_id);
      if (!used.includes(item.thread_id)) used.push(item.thread_id);
      if (collectionRoots.has(item.node_id)) merged.add(item.thread_id);
    }
    const describe = (id: string): ContextThread | null => {
      const conversation = conversations.get(id);
      if (!conversation) return null;
      const ancestor = ancestry.get(id);
      return {
        thread_id: id,
        title: title(conversation, !whole.has(id)),
        relation: id === current?.id ? 'current' : ancestor ? 'ancestor' : 'reference',
        depth: id !== current?.id && ancestor ? ancestor.depth : null,
        via: id === current?.id ? null : (ancestor?.via ?? (merged.has(id) ? 'merge' : null)),
      };
    };
    const rank = { ancestor: 0, reference: 1, current: 2 };
    const threads = used
      .filter((id) => id !== current?.id)
      .map(describe)
      .filter((thread): thread is ContextThread => thread !== null)
      .map((thread, index) => ({ thread, index }))
      .sort(
        (a, b) =>
          rank[a.thread.relation] - rank[b.thread.relation] ||
          (b.thread.depth ?? 0) - (a.thread.depth ?? 0) ||
          a.index - b.index,
      )
      .map(({ thread }) => thread);
    const own = current ? describe(current.id) : null;
    return own ? [...threads, own] : threads;
  };
}

export function compileContext(snapshot: GraphSnapshot, raw: ContextSet): ContextPackage {
  const set = ContextSetSchema.parse(raw);
  const excluded: ContextPackage['excluded'] = [];
  const conflicts: ContextPackage['conflicts'] = [];
  const diagnostics: string[] = [];
  const candidates: ContextItem[] = [];
  const {
    deletedNodes,
    nodes: explicitlyExcluded,
    blocks: blockedBlocks,
    derivedBlocks,
  } = excludedSources(snapshot, set.excluded_node_ids);
  let blocked = false;
  if (deletedNodes.has(set.current_node_id)) {
    blocked = true;
    diagnostics.push('目前的對話已刪除，請先還原再送出。');
  }
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const blockById = new Map(snapshot.blocks.map((b) => [b.id, b]));
  const excerptById = new Map(snapshot.excerpts.map((e) => [e.id, e]));
  const omit = (nodeId: string, reason: string, sourceId: string | null = null) =>
    excluded.push({ node_id: nodeId, source_id: sourceId, reason });
  for (const nodeId of explicitlyExcluded) {
    omit(nodeId, deletedNodes.has(nodeId) ? 'deleted from canvas' : 'explicitly excluded');
  }
  const roles = new Map<string, ContextItem['role']>();
  const explicitNodes = new Set([...set.selected_node_ids, ...set.pinned_node_ids]);
  const collectionStates = new Map<string, ContextState>();
  const collectionRoots = new Map<string, string>();
  const priorities: Record<ContextItem['role'], number> = {
    selected: 1,
    pinned: 0.98,
    branch_origin: 0.9,
    current: 0.85,
    related: 0.6,
    historical: 0.3,
  };
  const add = (nodeId: string, role: ContextItem['role'], expand = true) => {
    const node = nodeById.get(nodeId);
    const collection =
      expand && node?.ref_type === 'excerpt'
        ? excerptById.get(node.ref_id)?.collection_source_ids
        : undefined;
    if (collection) {
      if (node?.context_state === 'rejected' && !explicitNodes.has(nodeId)) {
        omit(nodeId, 'rejected collection by lifecycle policy');
        return;
      }
      for (const id of collection) {
        const member = snapshot.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === id);
        if (member) {
          if (explicitNodes.has(nodeId) || role === 'branch_origin') explicitNodes.add(member.id);
          if (node && node.context_state !== 'active')
            collectionStates.set(member.id, node.context_state);
          collectionRoots.set(member.id, nodeId);
          add(member.id, role, false);
        } else {
          blocked = true;
          conflicts.push({
            a: id,
            b: nodeId,
            type: 'missing_reference',
            resolution: 'restore the collection source',
            status: 'unresolved',
          });
        }
      }
      return;
    }
    // An excerpt chosen as a branch origin is a required reference, including
    // cross-canvas snapshots and frozen excerpt inputs inherited by a fork.
    if (
      node?.ref_type === 'excerpt' &&
      role === 'branch_origin' &&
      node.context_state !== 'rejected'
    )
      explicitNodes.add(nodeId);
    if (!roles.has(nodeId) || priorities[role] > priorities[roles.get(nodeId)!])
      roles.set(nodeId, role);
  };
  add(set.current_node_id, 'current');
  set.selected_node_ids.forEach((n) => add(n, 'selected'));
  set.pinned_node_ids.forEach((n) => add(n, 'pinned'));
  const conversation = snapshot.conversations.find((c) => c.id === set.conversation_id);
  const origin = snapshot.nodes.find(
    (n) => n.ref_type === 'excerpt' && n.ref_id === conversation?.branch_origin_excerpt_id,
  );
  if (origin) add(origin.id, 'branch_origin');
  const links = new Map<string, NonNullable<ContextItem['link']>>();
  const forkSources = new Map<string, Set<string>>();
  if (conversation?.fork_origin) {
    for (const blockId of conversation.fork_origin.source_block_ids) {
      const block = blockById.get(blockId);
      const turn = snapshot.turns.find((t) => t.id === block?.turn_id);
      const source = snapshot.nodes.find(
        (n) => n.ref_type === 'conversation' && n.ref_id === turn?.conversation_id,
      );
      if (source) {
        const ids = forkSources.get(source.id) ?? new Set<string>();
        ids.add(blockId);
        forkSources.set(source.id, ids);
        add(source.id, 'branch_origin');
      } else {
        blocked = true;
        conflicts.push({
          a: blockId,
          b: null,
          type: 'missing_reference',
          resolution: 'restore the fork background',
          status: 'unresolved',
        });
      }
    }
    for (const id of conversation.fork_origin.source_excerpt_ids) {
      const source = snapshot.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === id);
      if (source) add(source.id, 'branch_origin', false);
      else blocked = true;
    }
  }
  // Only directly addressable excerpts are retrieved structurally. Traversing the
  // parent conversation would import unrelated siblings into a new branch.
  for (const edge of snapshot.edges) {
    const neighbor =
      edge.source_node_id === set.current_node_id
        ? edge.target_node_id
        : edge.target_node_id === set.current_node_id
          ? edge.source_node_id
          : null;
    if (
      neighbor &&
      edge.edge_class === 'structural' &&
      nodeById.get(neighbor)?.ref_type === 'excerpt'
    )
      add(neighbor, 'related');
    // Any confirmed relation brings the linked card in, labelled with how it relates.
    if (neighbor && edge.edge_class === 'semantic' && edge.confirmed) {
      add(neighbor, 'related');
      if (!links.has(neighbor))
        links.set(neighbor, {
          type: edge.type,
          direction: edge.source_node_id === set.current_node_id ? 'from_current' : 'to_current',
        });
    }
    // Direction convention: the new source supersedes the old target.
    if (
      edge.edge_class === 'semantic' &&
      edge.confirmed &&
      edge.type === 'supersedes' &&
      (roles.has(edge.source_node_id) || roles.has(edge.target_node_id))
    )
      conflicts.push({
        a: edge.target_node_id,
        b: edge.source_node_id,
        type: 'superseded_by',
        resolution: 'prefer the newer source; older target is historical',
        status: 'resolved',
      });
  }
  const threadGroups = new Map<string, Set<string>>();
  const superseded = new Set(conflicts.filter((c) => c.type === 'superseded_by').map((c) => c.a));
  for (const [nodeId, originalRole] of roles) {
    if (explicitlyExcluded.has(nodeId)) continue;
    const node = nodeById.get(nodeId);
    const explicit = explicitNodes.has(nodeId);
    if (!node || node.workspace_id !== set.workspace_id) {
      conflicts.push({
        a: nodeId,
        b: null,
        type: 'missing_reference',
        resolution: 'remove or restore the missing reference',
        status: 'unresolved',
      });
      omit(nodeId, 'missing reference');
      if (explicit || originalRole === 'current') blocked = true;
      continue;
    }
    const state = collectionStates.get(nodeId) ?? node.context_state;
    const isSuperseded =
      superseded.has(nodeId) || superseded.has(collectionRoots.get(nodeId) ?? '');
    if (state === 'rejected' && !explicit) {
      omit(nodeId, 'rejected by lifecycle policy');
      continue;
    }
    const historical = ['superseded', 'rejected'].includes(state) || isSuperseded;
    const role = historical ? 'historical' : originalRole;
    // A large frozen parent history must not crowd out this branch's own
    // instructions and replies. Explicit picks/pins retain their normal priority.
    const inheritedFork = originalRole === 'branch_origin' && forkSources.has(nodeId);
    const score =
      (inheritedFork ? priorities.related : priorities[originalRole]) +
      (state === 'confirmed' ? 0.02 : 0) -
      (state === 'deprecated' ? 0.2 : 0);
    const blockIds = blocksForNode(snapshot, node).filter(
      (id) =>
        originalRole !== 'branch_origin' ||
        !forkSources.has(nodeId) ||
        forkSources.get(nodeId)!.has(id),
    );
    // A conversation that is here as background (not explicitly chosen) may give up
    // older messages under budget pressure, and may be represented by a summary.
    if (node.ref_type === 'conversation' && !explicit) threadGroups.set(nodeId, new Set(blockIds));
    if (blockIds.length === 0 && node.ref_type !== 'conversation') {
      omit(nodeId, 'missing source');
      if (explicit) blocked = true;
    }
    for (const blockId of blockIds) {
      const block = blockById.get(blockId);
      if (blockedBlocks.has(blockId)) {
        omit(
          nodeId,
          derivedBlocks.has(blockId)
            ? 'answer depends on an excluded source'
            : 'source overlaps explicitly excluded content',
          blockId,
        );
        continue;
      }
      if (!block || block.text_content === null) {
        omit(nodeId, 'source has no supported text', blockId);
        if (explicit) blocked = true;
        continue;
      }
      const excerpt = node.ref_type === 'excerpt' ? excerptById.get(node.ref_id) : null;
      const content = excerpt?.snapshot_text ?? block.text_content;
      const sourceTurn = snapshot.turns.find((t) => t.id === block.turn_id);
      if (
        hash(block.text_content) !== block.content_hash ||
        (excerpt &&
          (excerpt.source_content_hash !== block.content_hash ||
            block.text_content.slice(excerpt.selector.start_char, excerpt.selector.end_char) !==
              excerpt.snapshot_text))
      ) {
        conflicts.push({
          a: nodeId,
          b: blockId,
          type: 'content_mismatch',
          resolution: 'reselect the excerpt from the current source',
          status: 'unresolved',
        });
        omit(nodeId, 'source content hash or selector mismatch', blockId);
        if (explicit || originalRole === 'branch_origin') blocked = true;
        continue;
      }
      candidates.push({
        source_type: excerpt ? 'excerpt' : 'content_block',
        source_id: excerpt?.id ?? block.id,
        source_block_id: block.id,
        node_id: nodeId,
        ...(sourceTurn ? { thread_id: sourceTurn.conversation_id } : {}),
        ...(links.has(nodeId) ? { link: links.get(nodeId) } : {}),
        actor: sourceTurn?.actor ?? null,
        sequence: sourceTurn?.sequence ?? null,
        role,
        state: isSuperseded ? 'superseded' : state,
        content,
        content_hash: hash(content),
        score,
        reason: `${originalRole}${historical ? '; historical, not a current fact' : ''}${explicit ? '; explicit user control' : '; deterministic structural retrieval'}`,
        token_estimate: estimateTokens(content),
        compressed: false,
      });
    }
  }
  const grouped = (item: ContextItem) =>
    item.source_type === 'content_block' && threadGroups.has(item.node_id);
  const rank = (list: ContextItem[]) =>
    list.sort(
      (a, b) =>
        b.score - a.score ||
        a.node_id.localeCompare(b.node_id) ||
        // Within a background conversation the latest messages are kept first.
        (grouped(a) && grouped(b)
          ? (b.sequence ?? 0) - (a.sequence ?? 0)
          : (a.sequence ?? 0) - (b.sequence ?? 0)) ||
        a.source_id.localeCompare(b.source_id),
    );
  // Keep schema/framing headroom as well as the configured output reserve.
  const inputLimit = set.budget.max_input_tokens - set.budget.reserved_output_tokens;
  const threadsFor = contextThreads(snapshot, conversation, blockedBlocks, collectionRoots);
  const inputSize = (next: ContextItem[]) =>
    estimateTokens(
      ANSWER_INSTRUCTIONS +
        modelInput({
          current_prompt: set.prompt_text,
          items: next,
          threads: threadsFor(next),
          conflicts,
        }),
    ) + 1024;
  // Pure selection, so it can be repeated after a summary replaces older messages.
  const select = (list: ContextItem[], covered: Set<string>) => {
    const items: ContextItem[] = [];
    const omitted: { item: ContextItem; reason: string }[] = [];
    const seen = new Set<string>();
    let used = 0;
    let deduplicated = 0;
    let overflow = false;
    for (const item of list) {
      const dedupe = `${item.source_block_id}:${item.content_hash}`;
      if (seen.has(dedupe)) {
        deduplicated++;
        omitted.push({ item, reason: 'duplicate source content' });
        continue;
      }
      const explicit = explicitNodes.has(item.node_id);
      if (
        used + item.token_estimate > set.budget.target_context_tokens ||
        inputSize([...items, item]) > inputLimit
      ) {
        omitted.push({
          item,
          reason: explicit
            ? 'explicit source exceeds budget; sending blocked'
            : grouped(item) && covered.has(item.source_block_id)
              ? 'represented by a conversation summary'
              : 'omitted to fit context budget',
        });
        if (explicit) overflow = true;
        continue;
      }
      seen.add(dedupe);
      items.push(item);
      used += item.token_estimate;
    }
    return { items, omitted, used, deduplicated, overflow };
  };
  // The largest still-valid summary whose sources all belong to what this
  // conversation may contribute. A fork frozen before later parent messages must
  // never receive a summary that covers them.
  const summaryFor = (nodeId: string) => {
    const allowed = threadGroups.get(nodeId)!;
    const usable = conversationSummaries(snapshot, nodeById.get(nodeId)!.ref_id).filter(
      ({ block, summary }) =>
        summary.status === 'active' &&
        !blockedBlocks.has(block.id) &&
        hash(block.text_content!) === block.content_hash &&
        summary.source_block_ids.every(
          (id, index) =>
            allowed.has(id) &&
            !blockedBlocks.has(id) &&
            blockById.get(id)?.content_hash === summary.source_content_hashes[index],
        ),
    );
    return usable.sort(
      (a, b) => b.summary.source_block_ids.length - a.summary.source_block_ids.length,
    )[0];
  };
  let pool = rank([...candidates]);
  const covered = new Set<string>();
  const summarized = new Set<string>();
  let selection = select(pool, covered);
  for (;;) {
    const nodeId = [...threadGroups.keys()]
      .sort()
      .find(
        (id) =>
          !summarized.has(id) &&
          selection.omitted.some(
            ({ item, reason }) =>
              item.node_id === id && grouped(item) && reason === 'omitted to fit context budget',
          ),
      );
    if (!nodeId) break;
    summarized.add(nodeId);
    const found = summaryFor(nodeId);
    const members = pool.filter((item) => item.node_id === nodeId && grouped(item));
    const replaced = members.filter((item) =>
      found?.summary.source_block_ids.includes(item.source_block_id),
    );
    // Only worthwhile when the summary stands in for something that was dropped.
    if (
      !found ||
      !selection.omitted.some(
        ({ item, reason }) => replaced.includes(item) && reason === 'omitted to fit context budget',
      )
    )
      continue;
    const content = found.block.text_content!;
    const model = members[0];
    const next = rank([
      ...pool,
      {
        ...model,
        source_type: 'content_block',
        source_id: found.block.id,
        source_block_id: found.block.id,
        actor: 'assistant',
        // Read before the messages it summarizes, admitted ahead of them.
        sequence: Math.min(...replaced.map((item) => item.sequence ?? 0)),
        score: model.score + 0.001,
        content,
        content_hash: hash(content),
        reason: `${model.reason}; summary standing in for ${replaced.length} older sources`,
        token_estimate: estimateTokens(content),
        compressed: true,
        summarized_block_ids: found.summary.source_block_ids,
      },
    ]);
    const trial = new Set([...covered, ...found.summary.source_block_ids]);
    const attempt = select(next, trial);
    // Keep the summary only if it actually entered the input.
    if (attempt.items.some((item) => item.source_id === found.block.id)) {
      pool = next;
      found.summary.source_block_ids.forEach((id) => covered.add(id));
      selection = attempt;
    }
  }
  const { items, used } = selection;
  const deduplicated = selection.deduplicated;
  for (const { item, reason } of selection.omitted) omit(item.node_id, reason, item.source_id);
  if (selection.overflow) {
    blocked = true;
    diagnostics.push('选中或固定的原文超过预算；请增加预算或减少选择。不会静默删减后发送。');
  }
  if (inputSize(items) > inputLimit) {
    blocked = true;
    diagnostics.push('当前问题和必要元数据超过输入预算。');
  }
  if (
    snapshot.workspace.id !== set.workspace_id ||
    !conversation ||
    conversation.workspace_id !== set.workspace_id
  ) {
    blocked = true;
    diagnostics.push('上下文工作区或对话不匹配。');
  }
  return ContextPackageSchema.parse({
    package_id: `pkg_${set.id}`,
    context_set_id: set.id,
    policy_version: set.policy_version,
    graph_snapshot_version: set.graph_snapshot_version,
    current_prompt: set.prompt_text,
    items,
    threads: threadsFor(items),
    excluded,
    conflicts,
    diagnostics: [...new Set(diagnostics)],
    sendable: !blocked,
    budget: { ...set.budget, used_context_tokens: used, estimated_input_tokens: inputSize(items) },
    trace: {
      resolved_candidates: candidates.length,
      included_items: items.length,
      deduplicated_items: deduplicated,
    },
  });
}

// Input for summarizing one conversation: exactly its own complete messages, in
// order, with the same exclusion, hash and budget guarantees as an answer. Nothing
// from ancestors, siblings or selections enters, so the summary can stand in for
// this conversation alone.
export function compileSummaryInput(snapshot: GraphSnapshot, raw: ContextSet): ContextPackage {
  const set = ContextSetSchema.parse(raw);
  const diagnostics: string[] = [];
  const excluded: ContextPackage['excluded'] = [];
  const conflicts: ContextPackage['conflicts'] = [];
  const { blocks: blockedBlocks, nodes: excludedNodes } = excludedSources(
    snapshot,
    set.excluded_node_ids,
  );
  const node = snapshot.nodes.find((n) => n.id === set.current_node_id);
  const conversation = snapshot.conversations.find((c) => c.id === set.conversation_id);
  let blocked =
    !node ||
    !conversation ||
    node.ref_type !== 'conversation' ||
    node.ref_id !== conversation.id ||
    node.workspace_id !== set.workspace_id ||
    snapshot.workspace.id !== set.workspace_id;
  if (blocked) diagnostics.push('上下文工作区或对话不匹配。');
  if (node && excludedNodes.has(node.id)) {
    blocked = true;
    diagnostics.push('这条对话已排除或删除，不能生成摘要。');
  }
  const turns = new Map(snapshot.turns.map((t) => [t.id, t]));
  const items: ContextItem[] = [];
  if (node && conversation && !blocked)
    for (const block of snapshot.blocks
      .filter((b) => {
        const turn = turns.get(b.turn_id ?? '');
        return turn?.conversation_id === conversation.id && turn.status === 'complete';
      })
      .sort(
        (a, b) =>
          turns.get(a.turn_id!)!.sequence - turns.get(b.turn_id!)!.sequence ||
          a.ordinal - b.ordinal,
      )) {
      if (blockedBlocks.has(block.id)) {
        // A summary of a partly excluded conversation would be misleading.
        blocked = true;
        excluded.push({
          node_id: node.id,
          source_id: block.id,
          reason: 'source overlaps explicitly excluded content',
        });
        continue;
      }
      if (block.text_content === null) continue;
      if (hash(block.text_content) !== block.content_hash) {
        blocked = true;
        conflicts.push({
          a: node.id,
          b: block.id,
          type: 'content_mismatch',
          resolution: 'restore the original source before summarizing',
          status: 'unresolved',
        });
        continue;
      }
      const turn = turns.get(block.turn_id!)!;
      items.push({
        source_type: 'content_block',
        source_id: block.id,
        source_block_id: block.id,
        node_id: node.id,
        thread_id: conversation.id,
        actor: turn.actor,
        sequence: turn.sequence,
        role: 'current',
        state: node.context_state,
        content: block.text_content,
        content_hash: block.content_hash,
        score: 1,
        reason: 'current; complete conversation for summarization',
        token_estimate: estimateTokens(block.text_content),
        compressed: false,
      });
    }
  if (excluded.length > 0) diagnostics.push('对话中有已排除的内容，不能生成摘要。');
  if (!blocked && items.length < 2) {
    blocked = true;
    diagnostics.push('对话内容太少，不需要摘要。');
  }
  const used = items.reduce((total, item) => total + item.token_estimate, 0);
  const threads: ContextThread[] = conversation
    ? [{ thread_id: conversation.id, title: null, relation: 'current', depth: null, via: null }]
    : [];
  const estimated =
    estimateTokens(
      ANSWER_INSTRUCTIONS +
        modelInput({ current_prompt: set.prompt_text, items, threads, conflicts }),
    ) + 1024;
  if (
    used > set.budget.target_context_tokens ||
    estimated > set.budget.max_input_tokens - set.budget.reserved_output_tokens
  ) {
    blocked = true;
    diagnostics.push('这条对话超过一次摘要可处理的长度。');
  }
  return ContextPackageSchema.parse({
    package_id: `pkg_${set.id}`,
    context_set_id: set.id,
    policy_version: set.policy_version,
    graph_snapshot_version: set.graph_snapshot_version,
    current_prompt: set.prompt_text,
    items,
    threads,
    excluded,
    conflicts,
    diagnostics: [...new Set(diagnostics)],
    sendable: !blocked,
    budget: { ...set.budget, used_context_tokens: used, estimated_input_tokens: estimated },
    trace: {
      resolved_candidates: items.length,
      included_items: items.length,
      deduplicated_items: 0,
    },
  });
}
export { SUMMARY_PROMPT };
