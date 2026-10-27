import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Plus,
  Network,
  MessageSquare,
  ArrowUpRight,
  X,
  GitBranch,
  ScanLine,
  CircleHelp,
  FolderArchive,
  LoaderCircle,
  MousePointer2,
  Hand,
  Trash2,
  RotateCcw,
  Palette,
  MoreHorizontal,
} from 'lucide-react';
import {
  DEFAULT_BUDGET,
  type CanvasNode,
  type ContextPackage,
  type Excerpt,
  type Conversation,
} from '@acc/domain';
import { useApi, ApiError, streamAnswer, type ClientState } from './api';
import { ContextMenu } from './ContextMenu';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Focus, type SelectedText, type SourceHighlight, type ForkDraft } from './Focus';
import { ProjectDialog } from './ProjectDialog';
import { ModelDialog } from './ModelDialog';
import { LocalDialog } from './LocalDialog';
import { LocalControl } from './LocalControl';
import { UpdateControl } from './UpdateControl';
import { TraceDialog } from './TaskTrace';
import { TrashDialog } from './TrashDialog';
import './styles.css';
import './canvas-first.css';
import './canvas-themes.css';
import './thought-islands.css';
import { AppearanceDialog, appearanceKey, readAppearance } from './AppearanceDialog';
import { readDrafts, writeDrafts, type CanvasSession } from './canvas-session';

interface GenerationJob {
  prompt: string;
  text: string;
  retryTurnId: string | null;
  contextSetId: string | null;
  turnId?: string;
  controller: AbortController;
}
interface RequestError {
  message: string;
  contextSetId: string | null;
}
export default function App({ canvas }: { canvas: CanvasSession }) {
  const api = useApi();

  const [appearance, setAppearance] = useState(readAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);
  const closeWorkspaceMenu = useCallback(() => setWorkspaceMenu(null), []);
  useEffect(() => {
    try {
      localStorage.setItem(appearanceKey, appearance);
    } catch {
      /* Appearance still works for this tab. */
    }
  }, [appearance]);
  const [state, setState] = useState<ClientState | null>(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(canvas.initialView?.activeId ?? null);
  const [selected, setSelected] = useState<string[]>(canvas.initialView?.selected ?? []);
  const [initialDrafts] = useState(() => readDrafts(canvas.id));
  const [prompts, setPrompts] = useState<Record<string, string>>(initialDrafts.prompts);
  const [forkDrafts, setForkDrafts] = useState<Record<string, ForkDraft[]>>(
    initialDrafts.forkDrafts,
  );
  const [preparingForks, setPreparingForks] = useState<string[]>([]);
  const preparingRef = useRef(new Set<string>());
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [budget, setBudget] = useState(canvas.initialView?.budget ?? 6000);
  const [preview, setPreview] = useState<ContextPackage | null>(null);
  const [inspected, setInspected] = useState<{ pkg: ContextPackage; historical: boolean } | null>(
    null,
  );
  const [jobs, setJobs] = useState<Record<string, GenerationJob>>({});
  const jobsRef = useRef<Record<string, GenerationJob>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, RequestError>>({});
  const streamingTurns = state?.turns.filter((turn) => turn.status === 'streaming') || [];
  const streamingConversations = new Set(streamingTurns.map((turn) => turn.conversation_id));
  const streamingTurnIds = new Set(streamingTurns.map((turn) => turn.id));
  const runningConversations = new Set([...Object.keys(jobs), ...streamingConversations]);
  const busy = runningConversations.size > 0 || preparingForks.length > 0;
  const dirty =
    Object.values(prompts).some((text) => text.trim()) ||
    Object.values(forkDrafts).some((drafts) => drafts.length > 0);
  const lastSavedDrafts = useRef(JSON.stringify(initialDrafts));
  useEffect(() => {
    const next = JSON.stringify({ prompts, forkDrafts });
    if (next === lastSavedDrafts.current) return;
    try {
      writeDrafts(canvas.id, prompts, forkDrafts);
      lastSavedDrafts.current = next;
    } catch {
      setError('草稿暂未保存到浏览器，请保留此页面并备份未发送的文字。');
    }
  }, [canvas.id, prompts, forkDrafts]);
  useEffect(() => {
    canvas.onRuntime(canvas.id, { busy, dirty });
  }, [canvas.id, canvas.onRuntime, busy, dirty]);
  useEffect(() => {
    canvas.onView(canvas.id, { activeId, selected, budget, viewport: localViewport.current });
  }, [canvas.id, canvas.onView, activeId, selected, budget]);
  const remoteGeneration = streamingTurns.some((turn) => !jobs[turn.conversation_id]);
  const conversationBusy = (id: string) => !!jobsRef.current[id] || streamingConversations.has(id);
  const draftFor = (id: string) =>
    prompts[id] ??
    (state?.turns.some((t) => t.conversation_id === id)
      ? ''
      : (state?.conversations.find((c) => c.id === id)?.fork_origin?.initial_prompt ?? ''));
  const nodeBusy = (node: CanvasNode) =>
    node.ref_type === 'conversation'
      ? conversationBusy(node.ref_id)
      : node.ref_type === 'turn' && streamingTurnIds.has(node.ref_id);
  const updateJob = (id: string, job?: GenerationJob) => {
    const next = { ...jobsRef.current };
    if (job) next[id] = job;
    else delete next[id];
    jobsRef.current = next;
    setJobs(next);
  };
  const [locate, setLocate] = useState<{ id: string; tick: number } | null>(null);
  const [highlight, setHighlight] = useState<SourceHighlight | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [help, setHelp] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [localDialog, setLocalDialog] = useState(false);
  const [localSeed, setLocalSeed] = useState<{ prompt: string; contextId?: string } | null>(null);
  const [preparingLocal, setPreparingLocal] = useState('');
  const localRequest = useRef(0);
  const [traceId, setTraceId] = useState('');
  const [traceEpoch, setTraceEpoch] = useState(0);
  const [traceCount, setTraceCount] = useState(0);
  const [panel, setPanel] = useState<'conversations' | 'context' | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashTarget, setTrashTarget] = useState<{
    id: string;
    highlight?: SourceHighlight;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<CanvasNode | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CanvasNode | null>(null);
  const [cardActionBusy, setCardActionBusy] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<{
    id: string;
    title: string;
    prompt: string;
    selected: boolean;
    forks: ForkDraft[];
  } | null>(null);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const localViewport = useRef(canvas.initialView?.viewport);
  useEffect(
    () => () => {
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
      if (pendingViewport.current)
        void api('/workspace', { viewport: pendingViewport.current }, 'PATCH').catch(() => {});
    },
    [api],
  );
  useEffect(() => {
    if (canvas.visible) return;
    if (viewportTimer.current) clearTimeout(viewportTimer.current);
    if (pendingViewport.current) {
      void api('/workspace', { viewport: pendingViewport.current }, 'PATCH').catch(fail);
      pendingViewport.current = null;
    }
    setPanel(null);
    setModelDialog(false);
    setLocalDialog(false);
    setLocalSeed(null);
    localRequest.current++;
    setPreparingLocal('');
    setProjectDialog(false);
    setWorkspaceMenu(null);
    setAppearanceOpen(false);
    setHelp(false);
    setNewDialog(false);
    setRenameTarget(null);
    setPendingDelete(null);
    setTrashOpen(false);
    setTraceId('');
  }, [canvas.visible]);
  const compileVersion = useRef(0);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refreshSequence = useRef(0);
  const appliedRefresh = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const s = await api<ClientState>('/state');
    if (sequence >= appliedRefresh.current) {
      appliedRefresh.current = sequence;
      setState(s);
    }
    return s;
  }, [api]);
  useEffect(() => {
    if (!canvas.visible) return;
    setAppearance(readAppearance());
    void refresh().catch((e) => setError(e.message));
  }, [refresh, canvas.visible]);
  useEffect(() => {
    if (!remoteGeneration) return;
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [remoteGeneration, refresh]);
  const fail = useCallback(
    (error: unknown) => setError(error instanceof Error ? error.message : '操作失败'),
    [],
  );
  const invalidate = useCallback(() => {
    compileVersion.current++;
    setPreview(null);
    setInspected((prev) => (prev?.historical ? prev : null));
  }, []);
  const active = state?.nodes.find((n) => n.id === activeId) || null;
  const conversationId = active?.ref_type === 'conversation' ? active.ref_id : '';
  const prompt = draftFor(conversationId);
  const open = useCallback(
    (n: CanvasNode) => {
      if (n.collapsed)
        void api('/nodes/' + encodeURIComponent(n.id), { collapsed: false }, 'PATCH')
          .then(refresh)
          .catch(fail);
      setPanel(null);
      setActiveId(n.id);
      setHighlight(null);
      invalidate();
    },
    [invalidate, refresh, fail],
  );
  const moveTo = useCallback((id: string) => {
    setLocate({ id, tick: Date.now() });
  }, []);
  const openOnCanvas = useCallback(
    (node: CanvasNode) => {
      open(node);
      moveTo(node.id);
    },
    [open, moveTo],
  );
  const select = useCallback(
    (id: string) => {
      setSelected((ids) => (ids.includes(id) ? ids.filter((n) => n !== id) : [...ids, id]));
      invalidate();
    },
    [invalidate],
  );
  const control = useCallback(
    (nodeId: string, action: 'pin' | 'unpin' | 'exclude' | 'restore') => {
      void api('/context-control', { node_id: nodeId, action })
        .then(() => {
          if (action === 'exclude') setSelected((ids) => ids.filter((id) => id !== nodeId));
          invalidate();
          return refresh();
        })
        .catch(fail);
    },
    [refresh, invalidate, fail],
  );
  const create = async (title: string, position?: { x: number; y: number }) => {
    try {
      const result = await api<{ node: CanvasNode }>('/conversations', {
        title,
        position,
      });
      await refresh();
      open(result.node);
      moveTo(result.node.id);
      setNewDialog(false);
      setNewTitle('');
    } catch (e) {
      fail(e);
    }
  };
  const deleteCard = async (node: CanvasNode) => {
    if (cardActionBusy || nodeBusy(node)) return;
    setCardActionBusy(true);
    try {
      await api('/nodes/' + encodeURIComponent(node.id), {}, 'DELETE');
      setLastDeleted({
        id: node.id,
        title: node.title,
        prompt: draftFor(node.ref_id),
        selected: selected.includes(node.id),
        forks: forkDrafts[node.ref_id] ?? [],
      });
      setPrompts((previous) => ({ ...previous, [node.ref_id]: '' }));
      setForkDrafts((previous) => ({ ...previous, [node.ref_id]: [] }));
      if (collectingId === node.ref_id) setCollectingId(null);
      setSelected((previous) => previous.filter((id) => id !== node.id));
      setActiveId((previous) => (previous === node.id ? null : previous));
      setPendingDelete(null);
      invalidate();
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setCardActionBusy(false);
    }
  };
  const requestDelete = (node: CanvasNode) => {
    if (draftFor(node.ref_id).length || forkDrafts[node.ref_id]?.length) setPendingDelete(node);
    else void deleteCard(node);
  };
  const keepCard = () => {
    if (cardActionBusy) return;
    const input = pendingDelete ? document.getElementById('prompt-' + pendingDelete.id) : null;
    setPendingDelete(null);
    if (input instanceof HTMLTextAreaElement) input.focus({ preventScroll: true });
  };
  const restoreCard = async (id: string) => {
    if (cardActionBusy) return;
    setCardActionBusy(true);
    try {
      const { node } = await api<{ node: CanvasNode }>(
        '/nodes/' + encodeURIComponent(id) + '/restore',
        {},
      );
      if (lastDeleted?.id === id) {
        setPrompts((previous) => ({ ...previous, [node.ref_id]: lastDeleted.prompt }));
        setForkDrafts((previous) => ({ ...previous, [node.ref_id]: lastDeleted.forks }));
        if (lastDeleted.selected) setSelected((previous) => [...new Set([...previous, id])]);
        setLastDeleted(null);
      }
      await refresh();
      openOnCanvas(node);
      setTrashOpen(false);
    } catch (error) {
      fail(error);
    } finally {
      setCardActionBusy(false);
    }
  };
  const excerpt = async (selection: SelectedText, branch: boolean) => {
    try {
      const result = await api<{ node: CanvasNode; branch: { node: CanvasNode } | null }>(
        '/excerpts',
        {
          source_block_id: selection.block.id,
          source_content_hash: selection.block.content_hash,
          selector: selection.selector,
          branch,
        },
      );
      await refresh();
      const target = result.branch?.node || result.node;
      open(target);
      moveTo(target.id);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      fail(e);
    }
  };
  const branch = async (e: Excerpt) => {
    try {
      const result = await api<{ node: CanvasNode }>('/branches', { excerpt_id: e.id });
      await refresh();
      open(result.node);
      moveTo(result.node.id);
    } catch (e) {
      fail(e);
    }
  };
  const collect = async (selection: SelectedText) => {
    if (!collectingId) return;
    try {
      await api('/excerpts/' + encodeURIComponent(collectingId) + '/sources', {
        source_block_id: selection.block.id,
        source_content_hash: selection.block.content_hash,
        selector: selection.selector,
      });
      invalidate();
      await refresh();
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      fail(error);
    }
  };
  const removeSource = async (excerptId: string, sourceId: string) => {
    try {
      await api(
        '/excerpts/' + encodeURIComponent(excerptId) + '/sources/' + encodeURIComponent(sourceId),
        {},
        'DELETE',
      );
      invalidate();
      await refresh();
    } catch (error) {
      fail(error);
    }
  };
  const source = (e: Excerpt) => {
    if (e.external_origin) {
      canvas.onSourceJump(e.external_origin);
      return;
    }
    if (!state) return;
    const b = state.blocks.find((b) => b.id === e.source_block_id);
    const t = state.turns.find((t) => t.id === b?.turn_id);
    const n = state.nodes.find(
      (n) => n.ref_type === 'conversation' && n.ref_id === t?.conversation_id,
    );
    if (n) {
      if (n.visibility === 'hidden') {
        setTrashTarget({
          id: n.id,
          highlight: {
            blockId: e.source_block_id,
            start: e.selector.start_char,
            end: e.selector.end_char,
          },
        });
        setTrashOpen(true);
        return;
      }
      open(n);
      setHighlight({
        blockId: e.source_block_id,
        start: e.selector.start_char,
        end: e.selector.end_char,
      });
      moveTo(n.id);
    }
  };
  const handledNavigation = useRef('');
  useEffect(() => {
    const navigation = canvas.navigation;
    if (!navigation || !canvas.visible || handledNavigation.current === navigation.token) return;
    handledNavigation.current = navigation.token;
    let alive = true;
    void api<ClientState>('/state')
      .then((fresh) => {
        if (!alive) return;
        setState(fresh);
        if (navigation.nodeId) {
          const node = fresh.nodes.find(
            (n) => n.id === navigation.nodeId && n.visibility !== 'hidden',
          );
          if (!node) throw new Error('引用节点已变化，请从画布中重新查找。');
          open(node);
          moveTo(node.id);
        } else if (navigation.origin) {
          const origin = navigation.origin;
          const block = fresh.blocks.find((b) => b.id === origin.source_block_id);
          const turn = fresh.turns.find((t) => t.id === block?.turn_id);
          const node = fresh.nodes.find(
            (n) => n.ref_type === 'conversation' && n.ref_id === origin.conversation_id,
          );
          if (
            fresh.workspace.id !== origin.workspace_id ||
            !node ||
            !block ||
            turn?.id !== origin.turn_id ||
            turn.conversation_id !== origin.conversation_id ||
            block.content_hash !== origin.source_content_hash ||
            block.text_content?.slice(origin.selector.start_char, origin.selector.end_char) !==
              origin.selector.exact
          )
            throw new Error('来源已变化或已不在这张画布，引用快照仍完整保留。');
          const highlight = {
            blockId: block.id,
            start: origin.selector.start_char,
            end: origin.selector.end_char,
          };
          if (node.visibility === 'hidden') {
            setTrashTarget({ id: node.id, highlight });
            setTrashOpen(true);
          } else {
            open(node);
            setHighlight(highlight);
            moveTo(node.id);
          }
        }
        canvas.onNavigated(navigation.token);
      })
      .catch((error) => {
        if (alive) {
          fail(error);
          canvas.onNavigated(navigation.token);
        }
      });
    return () => {
      alive = false;
    };
  }, [canvas.navigation, canvas.visible, api, canvas.onNavigated, open, moveTo, fail]);
  const compile = async (inspect = true) => {
    const version = ++compileVersion.current;
    try {
      const result = await api<{ package: ContextPackage }>('/compile', {
        conversation_id: conversationId,
        prompt,
        selected_node_ids: selected,
        budget: { ...DEFAULT_BUDGET, target_context_tokens: budget },
      });
      if (version === compileVersion.current) {
        setPreview(result.package);
        setInspected({ pkg: result.package, historical: false });
        if (inspect) setPanel('context');
        return result.package;
      }
    } catch (e) {
      fail(e);
    }
  };
  const generate = async (
    targetConversation: string,
    retryId?: string,
    direct = false,
    submission?: { prompt: string; selected: string[]; nodeId: string; requestId?: string },
  ) => {
    const retryTurn = state?.turns.find((turn) => turn.id === retryId);
    let pkg = retryId
      ? state?.packages.find((p) => p.context_set_id === retryTurn?.input_context_set_id)
      : direct
        ? undefined
        : preview;
    if (!targetConversation || conversationBusy(targetConversation) || (!direct && !pkg)) return;
    const submittedPrompt = submission?.prompt ?? draftFor(targetConversation);
    if (direct && !submittedPrompt.trim()) return;
    const submittedSelection = submission?.selected ?? selected;
    const targetNodeId =
      submission?.nodeId ??
      state?.nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === targetConversation)
        ?.id;
    const requestId = submission?.requestId ?? crypto.randomUUID();
    const job: GenerationJob = {
      prompt: pkg?.current_prompt || submittedPrompt.trim(),
      text: '',
      retryTurnId: retryId || null,
      contextSetId: pkg?.context_set_id || `direct-${requestId}`,
      controller: new AbortController(),
    };
    let started = false;
    updateJob(targetConversation, job);
    setRequestErrors((previous) => {
      const next = { ...previous };
      delete next[targetConversation];
      return next;
    });
    setPanel(null);
    try {
      await streamAnswer(
        retryId ? '/retry' : direct ? '/send' : '/answer',
        retryId
          ? { turn_id: retryId }
          : direct
            ? {
                request_id: requestId,
                conversation_id: targetConversation,
                prompt: submittedPrompt,
                selected_node_ids: submittedSelection,
                budget: { ...DEFAULT_BUDGET, target_context_tokens: budget },
              }
            : { context_set_id: pkg!.context_set_id },
        (text) => {
          job.text = text;
          updateJob(targetConversation, { ...job });
        },
        {
          canvasId: canvas.id,
          signal: job.controller.signal,
          onStarted: (event) => {
            started = true;
            job.turnId = event.turn_id;
            job.contextSetId = event.context_set_id;
            pkg = event.package || pkg;
            if (!retryId)
              setPrompts((previous) =>
                previous[targetConversation] === submittedPrompt ||
                previous[targetConversation] === undefined
                  ? { ...previous, [targetConversation]: '' }
                  : previous,
              );
            updateJob(targetConversation, { ...job });
            void refresh().catch(fail);
          },
        },
      );
      if (!retryId)
        setPrompts((previous) =>
          previous[targetConversation] === submittedPrompt ||
          previous[targetConversation] === undefined
            ? { ...previous, [targetConversation]: '' }
            : previous,
        );
      if (activeRef.current === targetNodeId && selectedRef.current === submittedSelection)
        setSelected([]);
      if (pkg)
        setInspected((previous) =>
          previous?.pkg.context_set_id === pkg!.context_set_id
            ? { pkg: pkg!, historical: true }
            : previous,
        );
    } catch (error) {
      if (started && !retryId)
        setPrompts((previous) =>
          previous[targetConversation] === ''
            ? { ...previous, [targetConversation]: submittedPrompt }
            : previous,
        );
      const message = job.controller.signal.aborted
        ? '已停止這段回答，可使用原上下文重試。'
        : error instanceof Error
          ? error.message
          : '生成失敗';
      setRequestErrors((previous) => ({
        ...previous,
        [targetConversation]: { message, contextSetId: job.contextSetId },
      }));
      if (error instanceof ApiError && error.contextPackage && activeRef.current === targetNodeId) {
        pkg = error.contextPackage;
        setPreview(pkg);
        setInspected({ pkg, historical: false });
        setPanel('context');
      }
    } finally {
      try {
        await refresh();
      } catch (error) {
        fail(error);
      } finally {
        updateJob(targetConversation);
        setPreview((previous) =>
          started && previous?.context_set_id === job.contextSetId ? null : previous,
        );
      }
    }
  };
  const handoffLocal = async (node: CanvasNode) => {
    const token = ++localRequest.current;
    const lastQuestion = state?.turns
      .filter((turn) => turn.conversation_id === node.ref_id && turn.actor === 'human')
      .sort((a, b) => b.sequence - a.sequence)[0];
    const currentDraft = draftFor(node.ref_id);
    const question =
      (currentDraft.trim() ? currentDraft : '') ||
      state?.blocks
        .filter((block) => block.turn_id === lastQuestion?.id)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((block) => block.text_content ?? '')
        .join('\n\n') ||
      '';
    setPreparingLocal(node.id);
    try {
      const result = question
        ? await api<{ package: ContextPackage }>('/compile', {
            conversation_id: node.ref_id,
            prompt: question,
            selected_node_ids: selected,
            budget: { ...DEFAULT_BUDGET, target_context_tokens: budget },
          })
        : undefined;
      if (token !== localRequest.current || activeRef.current !== node.id) return;
      if (result && !result.package.sendable) {
        setPreview(result.package);
        setInspected({ pkg: result.package, historical: false });
        setPanel('context');
        return;
      }
      if (result) await refresh();
      if (token !== localRequest.current || activeRef.current !== node.id) return;
      setLocalSeed({ prompt: question, contextId: result?.package.context_set_id });
      setLocalDialog(true);
    } catch (error) {
      if (token === localRequest.current) fail(error);
    } finally {
      if (token === localRequest.current) setPreparingLocal('');
    }
  };
  const sendForks = async (node: CanvasNode) => {
    if (preparingRef.current.has(node.ref_id)) return;
    const drafts = forkDrafts[node.ref_id] ?? [];
    if (!drafts.length || drafts.some((d) => !d.prompt.trim())) return;
    preparingRef.current.add(node.ref_id);
    setPreparingForks([...preparingRef.current]);
    const mainPrompt = draftFor(node.ref_id);
    const sendMain = !conversationBusy(node.ref_id) && !!mainPrompt.trim();
    const submittedSelection = selected;
    try {
      const { branches } = await api<{
        branches: { conversation: Conversation; node: CanvasNode }[];
      }>('/forks', {
        conversation_id: node.ref_id,
        branches: drafts.map((d) => ({ request_id: d.id, mode: d.mode, prompt: d.prompt })),
      });
      await refresh();
      setForkDrafts((previous) => ({
        ...previous,
        [node.ref_id]: (previous[node.ref_id] ?? []).filter(
          (d) => !drafts.some((sent) => sent.id === d.id),
        ),
      }));
      setPrompts((previous) => ({
        ...previous,
        ...Object.fromEntries(
          branches.map((b) => [b.conversation.id, b.conversation.fork_origin!.initial_prompt]),
        ),
      }));
      invalidate();
      const tasks = branches.map((b) =>
        generate(b.conversation.id, undefined, true, {
          prompt: b.conversation.fork_origin!.initial_prompt,
          selected: [],
          nodeId: b.node.id,
          requestId: b.conversation.fork_origin!.request_id,
        }),
      );
      if (sendMain)
        tasks.push(
          generate(node.ref_id, undefined, true, {
            prompt: mainPrompt,
            selected: submittedSelection,
            nodeId: node.id,
          }),
        );
      void Promise.allSettled(tasks);
    } catch (error) {
      fail(error);
    } finally {
      preparingRef.current.delete(node.ref_id);
      setPreparingForks([...preparingRef.current]);
    }
  };
  const cancel = async (targetConversation: string) => {
    const job = jobsRef.current[targetConversation];
    const turnId =
      job?.turnId ||
      state?.turns.find(
        (turn) => turn.conversation_id === targetConversation && turn.status === 'streaming',
      )?.id;
    if (turnId) {
      try {
        await api('/answers/' + encodeURIComponent(turnId) + '/cancel', {});
      } catch (error) {
        fail(error);
      }
    } else job?.controller.abort();
  };
  if (!canvas.visible) return null;
  if (!state)
    return (
      <div className="loading-screen">
        <Network size={32} />
        <h1>Context Canvas</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="primary"
              onClick={() => {
                setError('');
                void refresh().catch(fail);
              }}
            >
              重试连接
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={16} />
            正在打开你的思考空间…
          </p>
        )}
      </div>
    );
  return (
    <div
      className="app-shell canvas-first"
      data-canvas-style={appearance}
      onKeyDown={(event) => {
        // The browser owns text editing, shortcuts and IME candidate keys.
        // Let keyup bubble so a modifier pressed before entering the editor can
        // release React Flow's global shortcut state; never prevent default input.
        if (
          event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable],.nokey')
        )
          event.stopPropagation();
      }}
    >
      <header className="board-header">
        <div className="board-identity">
          <Network size={20} />
          <strong>
            context<span>canvas</span>
          </strong>
          <span className="board-divider" />
          {canvas.switcher}
          {busy && (
            <span className="output-status generation-count" role="status">
              <LoaderCircle className="spin" size={12} />
              {runningConversations.size
                ? `${runningConversations.size} 段回答生成中`
                : '正在准备分支'}
            </span>
          )}
        </div>
        <div className="board-menu">
          <LocalControl
            onOpen={() => {
              localRequest.current++;
              setPreparingLocal('');
              setLocalSeed(null);
              setLocalDialog(true);
            }}
          />
          <UpdateControl
            canInstall={
              !busy &&
              !canvas.globalBusy &&
              !canvas.globalDirty &&
              !preparingForks.length &&
              !Object.values(prompts).some((text) => text.trim()) &&
              !Object.values(forkDrafts).some((drafts) => drafts.length)
            }
          />
          <button
            className="mode-pill"
            aria-label="模型與登入"
            disabled={busy || canvas.globalBusy}
            onClick={() => setModelDialog(true)}
          >
            <span className="status-dot" />
            {state.provider.demo
              ? '本地演示'
              : state.provider.name === 'codex'
                ? 'ChatGPT / Codex'
                : state.provider.model || '待配置模型'}
          </button>
          <button
            className="icon-button"
            aria-label="工作区菜单"
            title="工作区菜单"
            aria-haspopup="menu"
            aria-expanded={!!workspaceMenu}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setWorkspaceMenu((previous) =>
                previous ? null : { x: rect.right - 210, y: rect.bottom + 8 },
              );
            }}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>
      {collectingId && (
        <aside className="collecting-bar" role="status">
          <GitBranch size={15} />
          <span>收集中 · 选取文字后「加入汇合点」</span>
          <button
            onClick={() => {
              const target = state.nodes.find(
                (n) => n.ref_type === 'excerpt' && n.ref_id === collectingId,
              );
              if (target) openOnCanvas(target);
            }}
          >
            查看汇合点
          </button>
          <button onClick={() => setCollectingId(null)}>完成</button>
        </aside>
      )}
      <main className="canvas-stage" aria-label="思考畫布">
        <ReactFlowProvider key={canvasEpoch}>
          <Canvas
            state={state}
            onResize={async (id, patch) => {
              await api('/nodes/' + encodeURIComponent(id), patch, 'PATCH');
              await refresh();
            }}
            initialViewport={localViewport.current}
            activeNode={activeId}
            selected={selected}
            locate={locate}
            tool={tool}
            traceEpoch={traceEpoch}
            onTraceCount={setTraceCount}
            onOpenTrace={setTraceId}
            locked={cardActionBusy}
            busyNodeIds={state.nodes.filter(nodeBusy).map((node) => node.id)}
            onDelete={requestDelete}
            onRename={(node) => {
              setRenameTarget(node);
              setRenameTitle(node.title);
            }}
            onBranch={(node) => {
              const excerpt = state.excerpts.find((e) => e.id === node.ref_id);
              if (excerpt) void branch(excerpt);
            }}
            onSource={(node) => {
              const excerpt = state.excerpts.find((e) => e.id === node.ref_id);
              if (excerpt) source(excerpt);
            }}
            onTrash={() => {
              setTrashTarget(null);
              setTrashOpen(true);
            }}
            onError={fail}
            onFold={(node) => {
              void api(
                '/nodes/' + encodeURIComponent(node.id),
                { collapsed: !node.collapsed },
                'PATCH',
              )
                .then(refresh)
                .catch(fail);
            }}
            onOpen={openOnCanvas}
            onSelect={select}
            onControl={control}
            onCreateAt={(position) => {
              void create('新的提問', position);
            }}
            onMove={(id, x, y) => {
              void api(`/nodes/${id}`, { x, y }, 'PATCH')
                .then(() => refresh())
                .catch(fail);
            }}
            onViewport={(v) => {
              localViewport.current = v;
              canvas.onView(canvas.id, { activeId, selected, budget, viewport: v });
              pendingViewport.current = v;
              if (viewportTimer.current) clearTimeout(viewportTimer.current);
              viewportTimer.current = setTimeout(() => {
                pendingViewport.current = null;
                void api('/workspace', { viewport: v }, 'PATCH').catch(fail);
              }, 350);
            }}
            renderContent={(node, ready) => (
              <Focus
                state={state}
                node={node}
                active={node.id === activeId && canvas.visible}
                inputReady={ready}
                locked={conversationBusy(node.ref_id)}
                prompt={draftFor(node.ref_id)}
                forkDrafts={forkDrafts[node.ref_id] ?? []}
                preparingForks={preparingForks.includes(node.ref_id)}
                onForkDrafts={(drafts) => {
                  setForkDrafts((previous) => ({ ...previous, [node.ref_id]: drafts }));
                }}
                onSendForks={() => void sendForks(node)}
                collectingId={collectingId}
                onCollect={collect}
                onCollecting={(id) => setCollectingId((previous) => (previous === id ? null : id))}
                onRemoveSource={(id) => void removeSource(node.ref_id, id)}
                onOpenNode={openOnCanvas}
                budget={budget}
                preview={node.id === activeId ? preview : null}
                busy={conversationBusy(node.ref_id)}
                draft={jobs[node.ref_id]?.text || ''}
                pendingInput={jobs[node.ref_id] || null}
                requestError={
                  state.turns.some(
                    (turn) =>
                      turn.conversation_id === node.ref_id &&
                      turn.input_context_set_id === requestErrors[node.ref_id]?.contextSetId &&
                      turn.status === 'error' &&
                      turn.error === requestErrors[node.ref_id]?.message,
                  )
                    ? ''
                    : requestErrors[node.ref_id]?.message || ''
                }
                onCancel={() => void cancel(node.ref_id)}
                highlight={node.id === activeId ? highlight : null}
                onOpen={() => {
                  open(node);
                  moveTo(node.id);
                }}
                onClose={() => {
                  setActiveId(null);
                  invalidate();
                }}
                onPrompt={(value) => {
                  setPrompts((p) => ({ ...p, [node.ref_id]: value }));
                  invalidate();
                }}
                onBudget={(value) => {
                  setBudget(value);
                  invalidate();
                }}
                onCompile={() => void compile()}
                onSend={() => void generate(node.ref_id)}
                onSendDirect={() => void generate(node.ref_id, undefined, true)}
                onExcerpt={(s, b) => void excerpt(s, b)}
                onBranch={(e) => void branch(e)}
                onSource={source}
                onReference={canvas.onReference}
                onExternalSource={canvas.onSourceJump}
                onLocalTask={() => void handoffLocal(node)}
                preparingLocal={preparingLocal === node.id}
                onInspect={(pkg) => {
                  setInspected({ pkg, historical: true });
                  setPanel('context');
                }}
                onRetry={(id) => void generate(node.ref_id, id)}
              />
            )}
          />
        </ReactFlowProvider>
        {!state.nodes.some((n) => n.visibility !== 'hidden') && !traceCount && (
          <div className="board-empty">
            <span className="empty-symbol">
              <Network size={30} strokeWidth={1.4} />
            </span>
            <h1>把想法，攤開來。</h1>
            <p>在畫布上提問，選取文字，讓下一個想法接著生長。</p>
            <button className="primary" onClick={() => setNewDialog(true)}>
              <Plus size={16} />
              開始第一段對話
            </button>
            <small>也可以雙擊空白處，在那裡開始。</small>
          </div>
        )}
      </main>
      <nav className="canvas-tools" aria-label="工作區分頁">
        <button
          className="desktop-tool"
          title="選取工具"
          aria-label="選取工具"
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          className="desktop-tool"
          title="平移工具"
          aria-label="平移工具"
          aria-pressed={tool === 'hand'}
          onClick={() => setTool('hand')}
        >
          <Hand size={18} />
        </button>
        <span className="tool-divider desktop-tool" />
        <button
          className="new-canvas-conversation"
          aria-label="新建对话"
          title="新建对话"
          onClick={() => {
            setNewDialog(true);
          }}
        >
          <Plus size={18} />
          <span>提問</span>
        </button>
        <span className="tool-divider" />
        <button
          aria-label="畫布"
          aria-pressed={panel === null}
          title="回到畫布"
          onClick={() => setPanel(null)}
        >
          <Network size={18} />
          <span>畫布</span>
        </button>
        <button
          aria-label="對話"
          aria-pressed={panel === 'conversations'}
          title="對話列表"
          onClick={() => setPanel(panel === 'conversations' ? null : 'conversations')}
        >
          <MessageSquare size={18} />
          <span>對話</span>
        </button>
        <button
          aria-label="上下文"
          aria-pressed={panel === 'context'}
          title="上下文檢查器"
          onClick={() => setPanel(panel === 'context' ? null : 'context')}
        >
          <ScanLine size={18} />
          <span>上下文{selected.length > 0 ? ` · ${selected.length}` : ''}</span>
        </button>
        <button
          aria-label="回收桶"
          title="回收桶"
          onClick={() => {
            setTrashTarget(null);
            setTrashOpen(true);
          }}
        >
          <Trash2 size={18} />
        </button>
      </nav>
      {panel && (
        <section
          className={`board-drawer ${panel}`}
          aria-label={panel === 'context' ? '上下文面板' : '對話面板'}
        >
          <button
            className="drawer-close icon-button"
            aria-label="關閉面板"
            onClick={() => setPanel(null)}
          >
            <X size={18} />
          </button>
          {panel === 'context' ? (
            <Inspector
              state={state}
              pkg={inspected?.pkg || null}
              historical={inspected?.historical || false}
              selected={selected}
              onLocate={(id) => {
                setPanel(null);
                if (state.nodes.some((node) => node.id === id && node.visibility === 'hidden')) {
                  setTrashTarget({ id });
                  setTrashOpen(true);
                } else {
                  const node = state.nodes.find((n) => n.id === id);
                  const owner =
                    node?.ref_type === 'excerpt'
                      ? state.excerpts.find(
                          (e) =>
                            e.id !== node.ref_id && e.collection_source_ids?.includes(node.ref_id),
                        )
                      : undefined;
                  const target = owner
                    ? state.nodes.find(
                        (n) =>
                          n.ref_type === 'excerpt' &&
                          n.ref_id === owner.id &&
                          n.visibility !== 'hidden',
                      )
                    : node;
                  if (target) openOnCanvas(target);
                }
              }}
            />
          ) : (
            <>
              <h2>對話</h2>
              <p className="drawer-caption">所有思路，都在同一張畫布上。</p>
              <nav className="conversation-list" aria-label="对话列表">
                {state.conversations
                  .filter((c) =>
                    state.nodes.some(
                      (n) =>
                        n.ref_type === 'conversation' &&
                        n.ref_id === c.id &&
                        n.visibility !== 'hidden',
                    ),
                  )
                  .map((c) => (
                    <button
                      key={c.id}
                      className={c.id === conversationId ? 'current' : ''}
                      onClick={() => {
                        const n = state.nodes.find(
                          (n) => n.ref_type === 'conversation' && n.ref_id === c.id,
                        );
                        if (n) {
                          open(n);
                          moveTo(n.id);
                        }
                      }}
                    >
                      {c.branch_origin_excerpt_id || c.fork_origin ? (
                        <GitBranch size={14} />
                      ) : (
                        <MessageSquare size={14} />
                      )}
                      <span>{c.title}</span>
                      {conversationBusy(c.id) && (
                        <LoaderCircle className="spin" size={12} aria-label="生成中" />
                      )}
                    </button>
                  ))}
              </nav>
              {!state.nodes.some(
                (n) => n.ref_type === 'conversation' && n.visibility !== 'hidden',
              ) && <p className="drawer-caption">點擊下方「提問」，開始第一段對話。</p>}
            </>
          )}
        </section>
      )}
      {lastDeleted && (
        <div className="canvas-undo" role="status">
          <span>已刪除「{lastDeleted.title}」</span>
          <button
            disabled={cardActionBusy}
            onClick={() => {
              void restoreCard(lastDeleted.id);
            }}
          >
            <RotateCcw size={15} />
            復原
          </button>
          <button
            className="icon-button"
            aria-label="關閉刪除提示"
            onClick={() => setLastDeleted(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {trashOpen && (
        <TrashDialog
          state={state}
          target={trashTarget}
          busy={cardActionBusy}
          onRestore={restoreCard}
          onClose={() => setTrashOpen(false)}
        />
      )}
      {renameTarget && (
        <div className="modal-backdrop" onClick={() => !cardActionBusy && setRenameTarget(null)}>
          <form
            className="modal nokey"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !cardActionBusy) setRenameTarget(null);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (nodeBusy(renameTarget) || cardActionBusy) return;
              setCardActionBusy(true);
              void api('/nodes/' + encodeURIComponent(renameTarget.id) + '/rename', {
                title: renameTitle.trim(),
              })
                .then(async () => {
                  await refresh();
                  setRenameTarget(null);
                  invalidate();
                })
                .catch(fail)
                .finally(() => setCardActionBusy(false));
            }}
          >
            <h2 id="rename-title">重新命名卡片</h2>
            <label htmlFor="rename-card">卡片名稱</label>
            <input
              autoFocus
              id="rename-card"
              value={renameTitle}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRenameTitle(event.target.value)}
              maxLength={160}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={cardActionBusy}
                onClick={() => setRenameTarget(null)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={nodeBusy(renameTarget) || cardActionBusy || !renameTitle.trim()}
              >
                儲存名稱
              </button>
            </div>
          </form>
        </div>
      )}
      {pendingDelete && (
        <div className="modal-backdrop" onClick={keepCard}>
          <section
            className="modal nokey"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') keepCard();
            }}
          >
            <h2 id="delete-title">卡片還有未送出的文字</h2>
            <p>
              要刪除「{pendingDelete.title}
              」嗎？卡片可從回收桶還原，尚未送出的草稿只會保留在這次「復原」提示中，關閉頁面後不會保存。
            </p>
            <div className="modal-actions">
              <button autoFocus className="secondary" disabled={cardActionBusy} onClick={keepCard}>
                保留卡片
              </button>
              <button
                className="primary danger"
                disabled={nodeBusy(pendingDelete) || cardActionBusy}
                onClick={() => {
                  void deleteCard(pendingDelete);
                }}
              >
                刪除卡片
              </button>
            </div>
          </section>
        </div>
      )}
      {modelDialog && (
        <ModelDialog
          provider={state.provider.name}
          onClose={() => setModelDialog(false)}
          onChanged={async () => {
            invalidate();
            await refresh();
          }}
        />
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="关闭错误">
            <X size={16} />
          </button>
        </div>
      )}
      {newDialog && (
        <div className="modal-backdrop" onClick={() => setNewDialog(false)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void create(newTitle.trim() || '新的探索');
            }}
          >
            <span className="overline">NEW CONVERSATION</span>
            <h2 id="new-title">从哪里开始探索？</h2>
            <label htmlFor="conversation-title">给这段对话起个名字</label>
            <input
              autoFocus
              id="conversation-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={160}
              placeholder="例如：我的下一个产品"
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setNewDialog(false)}>
                取消
              </button>
              <button className="primary" type="submit">
                创建对话
                <ArrowUpRight size={15} />
              </button>
            </div>
          </form>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" aria-label="关闭帮助" onClick={() => setHelp(false)}>
              <X size={18} />
            </button>
            <span className="overline">HOW IT WORKS</span>
            <h2 id="help-title">从对话，到思考地图。</h2>
            <ol>
              <li>
                <MessageSquare size={18} />
                <span>
                  <strong>提出一个问题</strong>
                  雙擊畫布空白處建立對話；不同對話可以同時生成，各自停止。同一段對話依序提問。
                </span>
              </li>
              <li>
                <GitBranch size={18} />
                <span>
                  <strong>选中文字，长出分支</strong>
                  在任何卡片選取文字，點「延伸提問」建立相連的分支，原文與來源會一起保留。
                </span>
              </li>
              <li>
                <ScanLine size={18} />
                <span>
                  <strong>决定模型会看到什么</strong>
                  選擇、固定或排除卡片，需要時打開下方的上下文檢查器。
                </span>
              </li>
            </ol>
            <p className="quiet-note">
              示範模式不呼叫 AI。點擊上方「模型與登入」可連接 ChatGPT 帳號或選擇 API 模式。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
      {workspaceMenu && (
        <ContextMenu
          x={workspaceMenu.x}
          y={workspaceMenu.y}
          onClose={closeWorkspaceMenu}
          actions={[
            { label: '画布外观', icon: <Palette size={16} />, run: () => setAppearanceOpen(true) },
            {
              label: '备份与恢复',
              icon: <FolderArchive size={16} />,
              disabled: busy,
              run: () => setProjectDialog(true),
            },
            { label: '使用帮助', icon: <CircleHelp size={16} />, run: () => setHelp(true) },
          ]}
        />
      )}
      {appearanceOpen && (
        <AppearanceDialog
          value={appearance}
          onChange={setAppearance}
          onClose={() => setAppearanceOpen(false)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          onClose={() => setProjectDialog(false)}
          onImported={async () => {
            if (viewportTimer.current) clearTimeout(viewportTimer.current);
            pendingViewport.current = null;
            localViewport.current = undefined;
            canvas.onView(canvas.id, { activeId: null, selected: [], budget });
            invalidate();
            setActiveId(null);
            setSelected([]);
            setPrompts({});
            setForkDrafts({});
            setCollectingId(null);
            setRequestErrors({});
            setInspected(null);
            setHighlight(null);
            setLocate(null);
            await refresh();
            setCanvasEpoch((epoch) => epoch + 1);
            setProjectDialog(false);
            canvas.onCatalogChange();
          }}
        />
      )}
      {localDialog && (
        <LocalDialog
          onShowTrace={async (id) => {
            const current = await api<{ traces: { task_id: string }[] }>('/local/canvas');
            const traces = await api<{ task_id: string; x: number; y: number }[]>('/local/canvas', {
              task_id: id,
              pinned: true,
              ...(current.traces.some((trace) => trace.task_id === id)
                ? {}
                : {
                    x: Math.max(0, ...state.nodes.map((node) => node.x)) + 480,
                    y: current.traces.length * 520,
                  }),
            });
            setTraceEpoch((epoch) => epoch + 1);
            const trace = traces.find((trace) => trace.task_id === id);
            if (trace) setLocate({ id: 'trace:' + id, tick: Date.now() });
          }}
          onClose={() => {
            setLocalDialog(false);
            setLocalSeed(null);
          }}
          initialPrompt={localSeed?.prompt}
          contextId={
            localSeed ? localSeed.contextId : preview?.sendable ? preview.context_set_id : undefined
          }
          onUseResult={async (text) => {
            let node = active?.ref_type === 'conversation' ? active : null;
            if (!node) {
              const created = await api<{ node: CanvasNode }>('/conversations', {
                title: '本地任務記錄',
              });
              await refresh();
              node = created.node;
              setActiveId(node.id);
              moveTo(node.id);
            }
            const refId = node.ref_id;
            setPrompts((previous) => ({
              ...previous,
              [refId]: [previous[refId], text].filter(Boolean).join('\n\n'),
            }));
            invalidate();
          }}
        />
      )}
      {traceId && (
        <TraceDialog
          id={traceId}
          onClose={() => setTraceId('')}
          onContext={(id) => {
            const pkg = state.packages.find((pkg) => pkg.package_id === id);
            if (pkg) {
              setInspected({ pkg, historical: true });
              setPanel('context');
              setTraceId('');
            } else setError('此任務的上下文包不在目前畫布；可在匯出紀錄中查看來源 ID。');
          }}
        />
      )}
    </div>
  );
}
