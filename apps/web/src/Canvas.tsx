import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Node,
  type NodeProps,
  type NodeChange,
  type Viewport,
  MarkerType,
  NodeResizer,
  type ResizeParams,
} from '@xyflow/react';
import {
  MessageSquare,
  Quote,
  ArrowUpRight,
  Pin,
  Plus,
  Check,
  Ban,
  MoreHorizontal,
  LoaderCircle,
  ScrollText,
  Trash2,
  Pencil,
  Copy,
  RotateCcw,
  GitBranch,
  ChevronDown,
  ChevronUp,
  FileText,
  FilePlus2,
  StickyNote,
  Lightbulb,
  Link2,
  Unlink,
} from 'lucide-react';
import {
  referenceBlock,
  sourceNodeForTurn,
  collectionSources,
  noteBlock,
  noteMetadata,
  LINK_TYPES,
  type CanvasNode,
} from '@acc/domain';
import { SourceHandles, type SourceAnchor } from './SourceHandles';
import { useApi, type ClientState } from './api';
import { TraceCardContent, type CanvasTrace } from './TaskTrace';
import { ContextMenu, type MenuAction } from './ContextMenu';
import '@xyflow/react/dist/style.css';

type CardData = {
  title: string;
  preview: string;
  type: CanvasNode['type'];
  branch: boolean;
  reference: boolean;
  note: 'note' | 'idea' | null;
  noteColor: string;
  linking: boolean;
  displayTitle: string;
  count: number;
  active: boolean;
  context: boolean;
  pinned: boolean;
  excluded: boolean;
  node: CanvasNode;
  onOpen: () => void;
  onMenu: (event: MouseEvent) => void;
  sources: SourceAnchor[];
  onFold: () => void;
  mode: string;
  sourceCount: number;
  busy: boolean;
  onResize: (size: ResizeParams) => void;
  [key: string]: unknown;
};
type CardNode = Node<CardData, 'card'>;
const noAnchors: SourceAnchor[] = [];
// React Flow mirrors node data through effects. Keep text and editor props
// outside that queue, and keep layout nodes stable while the user types.
const CardContentContext = createContext<(node: CanvasNode, ready: boolean) => ReactNode>(
  () => null,
);

function Card({ data, width, height, selected }: NodeProps<CardNode>) {
  const zoom = useStore((s) => s.transform[2]);
  const renderContent = useContext(CardContentContext);
  const card = useRef<HTMLElement>(null);
  const [resizing, setResizing] = useState(false);
  return (
    <>
      <article
        ref={card}
        data-manual-size={resizing || data.node.size_mode === 'manual'}
        className={`canvas-card ${data.reference ? 'reference' : ''} ${data.note ? `note note-${data.noteColor} ${data.note}` : ''} ${data.linking ? 'link-target' : ''} ${data.branch ? 'branch' : ''} ${data.type} ${data.node.collapsed ? 'collapsed' : ''} ${data.active ? 'active' : ''} ${data.context ? 'context-selected' : ''} ${data.excluded ? 'excluded' : ''}`}
      >
        <Handle type="target" position={Position.Left} />
        <div className="card-eyebrow">
          <span
            className="node-kind"
            aria-label={
              data.note === 'idea'
                ? '延伸方向'
                : data.note
                  ? '筆記'
                  : data.reference
                    ? '參考文件'
                    : data.type === 'excerpt'
                      ? '摘录'
                      : data.branch
                        ? '分支对话'
                        : '对话'
            }
          >
            {data.note === 'idea' ? (
              <Lightbulb size={15} />
            ) : data.note ? (
              <StickyNote size={15} />
            ) : data.reference ? (
              <FileText size={15} />
            ) : data.type === 'excerpt' ? (
              <Quote size={15} />
            ) : data.branch ? (
              <GitBranch size={15} />
            ) : (
              <MessageSquare size={15} />
            )}
          </span>
          <button
            className={`card-title nodrag ${data.note === 'note' ? 'note-title' : ''}`}
            aria-label={data.title}
            onClick={data.onOpen}
          >
            {data.displayTitle}
          </button>
          {data.type === 'conversation' && data.busy && (
            <span className="thread-mode" role="status" aria-label="生成中" title="生成中">
              <LoaderCircle className="spin" size={13} />
            </span>
          )}
          {data.type === 'excerpt' && data.sourceCount > 1 && (
            <span className="collection-count">{data.sourceCount}</span>
          )}
          {data.pinned && <Pin size={13} aria-label="已固定" />}
          {data.excluded && <Ban size={13} aria-label="已排除" />}
          {data.type === 'conversation' && (
            <button
              className="fold-thread nodrag"
              aria-label={data.node.collapsed ? '展开对话' : '折叠对话'}
              onClick={data.onFold}
            >
              {data.node.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          )}
          <button
            className="card-menu-button nodrag nopan nokey"
            aria-label={'卡片操作：' + data.title}
            title="卡片操作"
            onClick={data.onMenu}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
        {!data.node.collapsed && (data.active || zoom > 0.45) ? (
          <div className="card-content nodrag nopan nowheel nokey">
            {renderContent(data.node, Boolean(width && height))}
          </div>
        ) : (
          !data.node.collapsed && <p className="card-preview">{data.preview}</p>
        )}
        {zoom > 0.55 && data.type !== 'excerpt' && data.count > 0 && (
          <div className="card-footer">
            <span>{data.count} 条消息</span>
          </div>
        )}
        <Handle type="source" position={Position.Right} />
        {!data.node.collapsed && data.sources.length > 0 && (
          <SourceHandles nodeId={data.node.id} container={card} sources={data.sources} />
        )}
      </article>
      {data.type === 'conversation' && !data.node.collapsed && (
        <NodeResizer
          isVisible={data.active || selected}
          handleClassName="card-resize-handle nodrag nopan nokey"
          lineClassName="card-resize-edge nodrag nopan nokey"
          minWidth={340}
          minHeight={360}
          maxWidth={1600}
          maxHeight={1800}
          onResizeStart={() => setResizing(true)}
          onResizeEnd={(_event, size) => {
            data.onResize(size);
            setResizing(false);
          }}
        />
      )}
    </>
  );
}
type TraceNode = Node<{ trace: CanvasTrace; onOpen: () => void; onRemove: () => void }, 'trace'>;
type BoardNode = CardNode | TraceNode;
function TraceCard({ data }: NodeProps<TraceNode>) {
  return (
    <div className="trace-node">
      <Handle type="target" position={Position.Left} />
      <TraceCardContent trace={data.trace} onOpen={data.onOpen} />
      <button className="trace-remove nodrag" aria-label="從畫布移除紀錄" onClick={data.onRemove}>
        移除卡片
      </button>
    </div>
  );
}
const nodeTypes = { card: Card, trace: TraceCard };

interface Props {
  state: ClientState;
  initialViewport?: Viewport;
  activeNode: string | null;
  selected: string[];
  locate: { id: string; tick: number } | null;
  // Show a group of cards at once, e.g. a brainstorm source with its new ideas.
  reveal: { ids: string[]; tick: number } | null;
  onOpen: (node: CanvasNode) => void;
  onSelect: (id: string) => void;
  onControl: (id: string, action: 'pin' | 'unpin' | 'exclude' | 'restore') => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (
    id: string,
    patch: Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>> & {
      size_mode: 'auto' | 'manual';
    },
  ) => Promise<void>;
  onViewport: (v: Viewport) => void;
  renderContent: (node: CanvasNode, ready: boolean) => ReactNode;
  tool: 'select' | 'hand';
  onCreateAt: (position: { x: number; y: number }) => void;
  onImportAt: (position: { x: number; y: number }) => void;
  onOpenTrace: (id: string) => void;
  traceEpoch: number;
  onTraceCount: (count: number) => void;
  locked: boolean;
  busyNodeIds: string[];
  onDelete: (node: CanvasNode) => void;
  onRename: (node: CanvasNode) => void;
  onBranch: (node: CanvasNode) => void;
  onSource: (node: CanvasNode) => void;
  onSummarize: (node: CanvasNode) => void;
  summarizing: string | null;
  onNoteAt: (position: { x: number; y: number }) => void;
  onEditNote: (node: CanvasNode) => void;
  onEditMemo: (node: CanvasNode) => void;
  onAskNote: (node: CanvasNode) => void;
  onBrainstorm: (node: CanvasNode) => void;
  onGraphChanged: () => Promise<void>;
  onTrash: () => void;
  onError: (error: unknown) => void;
  onFold: (node: CanvasNode) => void;
}

export const linkNames: Record<(typeof LINK_TYPES)[number], string> = {
  supports: '支持',
  contradicts: '反對',
  elaborates: '補充',
  example_of: '例子',
  depends_on: '依賴',
  alternative_to: '替代',
  related_to: '相關',
  supersedes: '取代',
};
const linkColors: Record<string, string> = {
  supports: '#4f9d69',
  contradicts: '#d1495b',
  elaborates: '#3f8fa0',
  example_of: '#8b7bd8',
  depends_on: '#c48a2c',
  alternative_to: '#c4689e',
  related_to: '#8a9aa6',
  supersedes: '#6b6b6b',
};
export function Canvas({
  state,
  initialViewport,
  activeNode,
  selected,
  locate,
  reveal,
  onOpen,
  onSelect,
  onControl,
  onMove,
  onResize,
  onViewport,
  renderContent,
  tool,
  onCreateAt,
  onImportAt,
  onOpenTrace,
  traceEpoch,
  onTraceCount,
  locked,
  busyNodeIds,
  onDelete,
  onRename,
  onBranch,
  onSource,
  onSummarize,
  summarizing,
  onNoteAt,
  onEditNote,
  onEditMemo,
  onAskNote,
  onBrainstorm,
  onGraphChanged,
  onTrash,
  onError,
  onFold,
}: Props) {
  const api = useApi();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id?: string;
    point?: { x: number; y: number };
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Link mode: choose a card, then the relation; edges can be retyped or removed later.
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [relationMenu, setRelationMenu] = useState<{
    x: number;
    y: number;
    source: string;
    target: string;
  } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  useEffect(() => {
    if (!linkFrom) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkFrom(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [linkFrom]);
  const pickLinkTarget = useCallback(
    (target: CanvasNode) => {
      if (!linkFrom || target.id === linkFrom) return;
      const element = document.querySelector(`.react-flow__node[data-id="${target.id}"]`);
      const rect = element?.getBoundingClientRect();
      setRelationMenu({
        x: rect ? rect.left + 24 : window.innerWidth / 2,
        y: rect ? rect.top + 40 : window.innerHeight / 2,
        source: linkFrom,
        target: target.id,
      });
      setLinkFrom(null);
    },
    [linkFrom],
  );
  const saveLink = (run: () => Promise<unknown>) => void run().then(onGraphChanged).catch(onError);
  const openCardMenu = useCallback((id: string, event: MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ id, x: box.right, y: box.bottom + 4 });
  }, []);
  const [traces, setTraces] = useState<CanvasTrace[]>([]);
  const [traceError, setTraceError] = useState('');
  useEffect(() => {
    onTraceCount(traces.length);
  }, [traces.length, onTraceCount]);
  const loadTraces = useCallback(async () => {
    const result = await api<{ traces: CanvasTrace[]; busy: boolean }>('/local/canvas');
    setTraces((previous) =>
      JSON.stringify(previous) === JSON.stringify(result.traces) ? previous : result.traces,
    );
    setTraceError('');
    return result.busy;
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let busy = false;
      try {
        if (alive) busy = await loadTraces();
      } catch (e) {
        if (alive) setTraceError(e instanceof Error ? e.message : '無法載入操作卡片');
      }
      if (alive) timer = setTimeout(() => void load(), busy ? 1500 : 10000);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loadTraces, traceEpoch]);
  const flow = useReactFlow();
  const foldHandler = useRef(onFold);
  foldHandler.current = onFold;
  const resizeHandler = useRef(onResize);
  resizeHandler.current = onResize;
  const busyKey = busyNodeIds.join(',');
  const busyIds = useMemo(() => new Set(busyKey.split(',')), [busyKey]);
  const latest = useRef({ nodes: state.nodes, activeNode });
  const lastLocated = useRef('');
  latest.current = { nodes: state.nodes, activeNode };
  const collectionOwner = useMemo(() => {
    const owners = new Map<string, string>();
    for (const node of state.nodes.filter(
      (n) => n.ref_type === 'excerpt' && n.visibility !== 'hidden',
    )) {
      const excerpt = state.excerpts.find((e) => e.id === node.ref_id);
      for (const id of excerpt?.collection_source_ids ?? []) owners.set(id, node.id);
    }
    return owners;
  }, [state.nodes, state.excerpts]);
  const anchors = useMemo(() => {
    const result = new Map<string, SourceAnchor[]>();
    for (const excerpt of state.excerpts) {
      const block = state.blocks.find((b) => b.id === excerpt.source_block_id);
      const turn = state.turns.find((t) => t.id === block?.turn_id);
      const source = sourceNodeForTurn(state.nodes, turn, state.turns);
      if (!source) continue;
      const items = result.get(source.id) ?? [];
      items.push({
        id: 'pick:' + excerpt.id,
        blockId: excerpt.source_block_id,
        start: excerpt.selector.start_char,
        end: excerpt.selector.end_char,
        quote: true,
      });
      result.set(source.id, items);
    }
    for (const child of state.conversations.filter((c) => c.fork_origin)) {
      const origin = child.fork_origin!;
      const source = state.nodes.find(
        (n) => n.ref_type === 'conversation' && n.ref_id === origin.conversation_id,
      );
      const block = state.blocks.filter((b) => b.turn_id === origin.turn_id).at(-1);
      if (!source || !block?.text_content) continue;
      const items = result.get(source.id) ?? [];
      items.push({
        id: 'fork:' + child.id,
        blockId: block.id,
        start: 0,
        end: block.text_content.length,
        quote: false,
      });
      result.set(source.id, items);
    }
    return result;
  }, [state.blocks, state.turns, state.excerpts, state.nodes, state.conversations]);
  const mapped = useMemo<CardNode[]>(
    () =>
      state.nodes
        .filter(
          (n) =>
            n.visibility !== 'hidden' &&
            (!collectionOwner.has(n.ref_id) || collectionOwner.get(n.ref_id) === n.id),
        )
        .map((n) => ({
          id: n.id,
          type: 'card',
          className: `node-${n.ref_type} ${referenceBlock(state, n) ? 'node-reference' : ''}`,
          dragHandle: '.card-eyebrow',
          zIndex: activeNode === n.id ? 10 : 0,
          position: { x: n.x, y: n.y },
          style:
            n.size_mode === 'manual' && !n.collapsed
              ? { width: n.width, height: n.height }
              : undefined,
          data: {
            node: n,
            title: n.title,
            displayTitle:
              n.ref_type === 'excerpt' &&
              n.title === state.excerpts.find((e) => e.id === n.ref_id)?.snapshot_text.slice(0, 60)
                ? state.excerpts.find((e) => e.id === n.ref_id)?.collection_source_ids
                  ? '汇合摘录'
                  : n.title.slice(0, 24)
                : n.title,
            type: n.type,
            reference: Boolean(referenceBlock(state, n)),
            note: noteMetadata(noteBlock(state, n))?.kind ?? null,
            noteColor: noteMetadata(noteBlock(state, n))?.color ?? 'plain',
            linking: !!linkFrom && linkFrom !== n.id,
            branch:
              !!state.conversations.find((c) => c.id === n.ref_id)?.branch_origin_excerpt_id ||
              !!state.conversations.find((c) => c.id === n.ref_id)?.fork_origin,
            mode:
              state.conversations.find((c) => c.id === n.ref_id)?.fork_origin?.mode === 'btw'
                ? '顺手问'
                : state.conversations.find((c) => c.id === n.ref_id)?.fork_origin ||
                    state.conversations.find((c) => c.id === n.ref_id)?.branch_origin_excerpt_id
                  ? '分支'
                  : '主线',
            busy: busyIds.has(n.id),
            sourceCount:
              n.ref_type === 'excerpt'
                ? collectionSources(state, state.excerpts.find((e) => e.id === n.ref_id)!).length
                : 0,
            sources: anchors.get(n.id) ?? noAnchors,
            onFold: () => foldHandler.current(n),
            onResize: (size) => resizeCard(n.id, size),
            preview:
              n.ref_type === 'excerpt'
                ? state.excerpts.find((e) => e.id === n.ref_id)?.snapshot_text || ''
                : (referenceBlock(state, n)?.text_content?.slice(0, 240) ??
                  noteBlock(state, n)?.text_content?.slice(0, 240) ??
                  n.representation.summary),
            count: state.turns.filter((t) => t.conversation_id === n.ref_id).length,
            active: activeNode === n.id,
            context: selected.includes(n.id),
            pinned: state.workspace.settings.pinned_node_ids.includes(n.id),
            excluded: state.workspace.settings.excluded_node_ids.includes(n.id),
            // While linking, a click picks the other end of the link instead of opening.
            onOpen: () => (linkFrom ? pickLinkTarget(n) : onOpen(n)),
            onMenu: (event: MouseEvent) => openCardMenu(n.id, event),
          },
        })),
    [
      state,
      activeNode,
      selected,
      onOpen,
      openCardMenu,
      collectionOwner,
      anchors,
      busyIds,
      linkFrom,
      pickLinkTarget,
    ],
  );
  const traceNodes = useMemo<TraceNode[]>(
    () =>
      traces.map((trace) => ({
        id: 'trace:' + trace.task_id,
        type: 'trace',
        dragHandle: '.trace-drag',
        position: { x: trace.x, y: trace.y },
        data: {
          trace,
          onOpen: () => onOpenTrace(trace.task_id),
          onRemove: () =>
            void api('/local/canvas', { task_id: trace.task_id, pinned: false })
              .then(loadTraces)
              .catch((e) => setTraceError(e.message)),
        },
      })),
    [traces, onOpenTrace, loadTraces],
  );
  const [nodes, setNodes] = useState<BoardNode[]>(mapped);
  useEffect(
    () =>
      setNodes((previous) =>
        [...mapped, ...traceNodes].map((node) => ({
          ...node,
          ...(previous.find((old) => old.id === node.id)?.resizing
            ? {
                style: previous.find((old) => old.id === node.id)?.style,
                width: previous.find((old) => old.id === node.id)?.width,
                height: previous.find((old) => old.id === node.id)?.height,
                resizing: true,
              }
            : {}),
          measured: previous.find((old) => old.id === node.id)?.measured,
          selected: previous.find((old) => old.id === node.id)?.selected ?? false,
        })),
      ),
    [mapped, traceNodes],
  );
  const resizeCard = (id: string, size: ResizeParams) => {
    const patch = {
      x: size.x,
      y: size.y,
      width: size.width,
      height: size.height,
      size_mode: 'manual' as const,
    };
    setNodes((previous) =>
      previous.map((node) =>
        node.id === id && node.type === 'card'
          ? {
              ...node,
              position: { x: size.x, y: size.y },
              width: size.width,
              height: size.height,
              style: { width: size.width, height: size.height },
              data: { ...node.data, node: { ...node.data.node, ...patch } },
            }
          : node,
      ),
    );
    void resizeHandler.current(id, patch).catch(onError);
  };
  useEffect(() => {
    if (!reveal) return;
    let frame = 0;
    let tries = 0;
    // New cards are measured a frame or two after they appear.
    const fit = () => {
      const ready = reveal.ids.every((id) => flow.getNode(id)?.measured?.width);
      if (!ready && tries++ < 30) {
        frame = requestAnimationFrame(fit);
        return;
      }
      void flow.fitView({
        nodes: reveal.ids.map((id) => ({ id })),
        padding: 0.2,
        maxZoom: 1,
        duration: 300,
      });
    };
    frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [reveal, flow]);
  useEffect(() => {
    if (!locate) return;
    const key = locate.id + ':' + locate.tick;
    if (lastLocated.current === key) return;
    const node = latest.current.nodes.find((n) => n.id === locate.id);
    if (node) {
      lastLocated.current = key;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const measured = flow.getNode(node.id)?.measured;
      const nodeWidth = measured?.width || (node.ref_type === 'excerpt' ? 280 : 420);
      const nodeHeight =
        node.ref_type === 'excerpt'
          ? measured?.height || 280
          : Math.max(420, measured?.height || 560);
      const zoom = Math.min(
        1,
        (width - 36) / nodeWidth,
        (height - 175) / Math.max(560, nodeHeight),
      );
      void flow.setCenter(node.x + nodeWidth / 2, node.y + nodeHeight / 2, {
        zoom: Math.max(node.size_mode === 'manual' ? 0.1 : 0.5, zoom),
        duration: 250,
      });
    } else {
      const trace = traces.find((trace) => 'trace:' + trace.task_id === locate.id);
      if (trace) {
        lastLocated.current = key;
        void flow.setCenter(trace.x + 180, trace.y + 180, {
          zoom: Math.min(1, (window.innerWidth - 36) / 380),
          duration: 250,
        });
      }
    }
  }, [locate, flow, traces]);
  const changes = useCallback(
    (changes: NodeChange<BoardNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const visibleIds = new Set(mapped.map((n) => n.id));
  const edges = state.edges
    .filter((e) => {
      const target = state.nodes.find((n) => n.id === e.target_node_id);
      const owner = target?.ref_type === 'excerpt' ? collectionOwner.get(target.ref_id) : undefined;
      if (e.type === 'excerpt_from' && target?.ref_type === 'excerpt') {
        const excerpt = state.excerpts.find((item) => item.id === target.ref_id);
        if (excerpt?.collection_source_ids && !excerpt.collection_source_ids.includes(excerpt.id))
          return false;
      }
      return visibleIds.has(e.source_node_id) && visibleIds.has(owner ?? e.target_node_id);
    })
    .map((e) => {
      const source = state.nodes.find((n) => n.id === e.source_node_id);
      const target = state.nodes.find((n) => n.id === e.target_node_id);
      const owner = target?.ref_type === 'excerpt' ? collectionOwner.get(target.ref_id) : undefined;
      const color =
        e.edge_class === 'semantic'
          ? (linkColors[e.type] ?? '#64a3ae')
          : e.type === 'excerpt_from'
            ? '#d3a14b'
            : '#64a3ae';
      return {
        id: e.id,
        source: e.source_node_id,
        target: owner ?? e.target_node_id,
        sourceHandle:
          !source?.collapsed && e.type === 'excerpt_from'
            ? 'pick:' + target?.ref_id
            : !source?.collapsed &&
                e.type === 'continue_from' &&
                state.conversations.find((c) => c.id === target?.ref_id)?.fork_origin?.turn_id
              ? 'fork:' + target?.ref_id
              : undefined,
        label:
          e.edge_class === 'semantic'
            ? linkNames[e.type as keyof typeof linkNames]
            : ['branch_from', 'excerpt_from', 'continue_from', 'generated_from'].includes(e.type)
              ? undefined
              : e.type,
        interactionWidth: e.edge_class === 'semantic' ? 18 : undefined,
        className: `relation-${e.type}`,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: {
          stroke: color,
          strokeWidth: 1.3,
          strokeDasharray:
            (e.edge_class === 'semantic' && !e.confirmed) || e.type === 'generated_from'
              ? '5 5'
              : undefined,
        },
        labelStyle: { fill: 'var(--muted-ink)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--canvas)' },
        labelBgPadding: [6, 4] as [number, number],
      };
    });
  const traceEdges = traces.flatMap((trace) => {
    const pkg = state.packages.find((pkg) => pkg.package_id === trace.context_package_id);
    const context = state.context_sets.find((context) => context.id === pkg?.context_set_id);
    if (!context || !visibleIds.has(context.current_node_id)) return [];
    return [
      {
        id: 'trace-source:' + trace.task_id,
        source: context.current_node_id,
        target: 'trace:' + trace.task_id,
        label: '輸入上下文',
        type: 'default',
        style: { stroke: '#798be2', strokeWidth: 1.5 },
        labelStyle: { fill: '#6472aa', fontSize: 10 },
        labelBgStyle: { fill: 'var(--canvas)' },
      },
    ];
  });
  const menuNode = state.nodes.find((node) => node.id === menu?.id && node.visibility !== 'hidden');
  const menuTrace = traces.find((trace) => 'trace:' + trace.task_id === menu?.id);
  const actions: MenuAction[] = menuNode
    ? [
        {
          label: referenceBlock(state, menuNode)
            ? '檢視參考'
            : menuNode.ref_type === 'excerpt'
              ? '檢視摘錄'
              : '繼續提問',
          icon: <MessageSquare size={16} />,
          run: () => onOpen(menuNode),
        },
        {
          label: '重新命名',
          icon: <Pencil size={16} />,
          disabled: locked || busyNodeIds.includes(menuNode.id),
          run: () => onRename(menuNode),
        },
        {
          label: '複製內容',
          icon: <Copy size={16} />,
          run: () => {
            const excerpt = state.excerpts.find((e) => e.id === menuNode.ref_id);
            const turns = new Set(
              state.turns
                .filter((t) =>
                  menuNode.ref_type === 'turn'
                    ? t.id === menuNode.ref_id
                    : t.conversation_id === menuNode.ref_id,
                )
                .map((t) => t.id),
            );
            const text =
              excerpt?.snapshot_text ||
              state.blocks
                .filter((b) => b.turn_id && turns.has(b.turn_id))
                .map((b) => b.text_content || '')
                .join('\n\n');
            if (!navigator.clipboard) {
              onError(new Error('無法寫入剪貼簿，請選取文字後複製。'));
              return;
            }
            void navigator.clipboard
              .writeText(text || menuNode.title)
              .catch(() => onError(new Error('無法寫入剪貼簿，請選取文字後複製。')));
          },
        },
        ...(menuNode.ref_type === 'conversation'
          ? [
              {
                label: '恢復自動尺寸',
                icon: <RotateCcw size={16} />,
                disabled: menuNode.size_mode !== 'manual',
                run: () => {
                  void resizeHandler.current(menuNode.id, { size_mode: 'auto' }).catch(onError);
                },
              },
            ]
          : []),
        ...(menuNode.ref_type === 'conversation'
          ? [
              {
                label:
                  summarizing === menuNode.ref_id
                    ? '正在生成背景摘要…'
                    : state.conversations.find((c) => c.id === menuNode.ref_id)?.summary_block_id
                      ? '重新生成背景摘要'
                      : '生成背景摘要',
                icon: <ScrollText size={16} />,
                disabled:
                  locked ||
                  summarizing !== null ||
                  busyNodeIds.includes(menuNode.id) ||
                  state.turns.filter(
                    (t) => t.conversation_id === menuNode.ref_id && t.status === 'complete',
                  ).length < 2,
                run: () => onSummarize(menuNode),
              },
            ]
          : []),
        ...(menuNode.ref_type === 'excerpt'
          ? [
              {
                label: '編輯摘錄備註',
                icon: <Pencil size={16} />,
                disabled: locked,
                run: () => onEditMemo(menuNode),
              },
              {
                label: '從摘錄延伸提問',
                icon: <GitBranch size={16} />,
                disabled: locked,
                run: () => onBranch(menuNode),
              },
              {
                label: '回到來源',
                icon: <ArrowUpRight size={16} />,
                run: () => onSource(menuNode),
              },
            ]
          : []),
        ...(noteBlock(state, menuNode)
          ? [
              {
                label: '編輯筆記',
                icon: <StickyNote size={16} />,
                disabled: locked,
                run: () => onEditNote(menuNode),
              },
              {
                label: '以此提問',
                icon: <MessageSquare size={16} />,
                disabled: locked,
                run: () => onAskNote(menuNode),
              },
            ]
          : []),
        {
          label: '腦力激盪',
          icon: <Lightbulb size={16} />,
          disabled: locked || busyNodeIds.includes(menuNode.id),
          run: () => onBrainstorm(menuNode),
        },
        {
          label: '連結到…',
          icon: <Link2 size={16} />,
          disabled: locked,
          run: () => setLinkFrom(menuNode.id),
        },
        {
          label: selected.includes(menuNode.id) ? '取消本輪上下文' : '選為本輪上下文',
          icon: <Check size={16} />,
          divider: true,
          disabled: locked,
          run: () => onSelect(menuNode.id),
        },
        {
          label: state.workspace.settings.pinned_node_ids.includes(menuNode.id)
            ? '取消固定'
            : '固定上下文',
          icon: <Pin size={16} />,
          disabled: locked,
          run: () =>
            onControl(
              menuNode.id,
              state.workspace.settings.pinned_node_ids.includes(menuNode.id) ? 'unpin' : 'pin',
            ),
        },
        {
          label: state.workspace.settings.excluded_node_ids.includes(menuNode.id)
            ? '恢復上下文'
            : '排除上下文',
          icon: <Ban size={16} />,
          disabled: locked,
          run: () =>
            onControl(
              menuNode.id,
              state.workspace.settings.excluded_node_ids.includes(menuNode.id)
                ? 'restore'
                : 'exclude',
            ),
        },
        {
          label: '刪除卡片',
          icon: <Trash2 size={16} />,
          divider: true,
          danger: true,
          disabled: locked || busyNodeIds.includes(menuNode.id),
          run: () => onDelete(menuNode),
        },
      ]
    : menuTrace
      ? [
          { label: '檢視操作回看', run: () => onOpenTrace(menuTrace.task_id) },
          {
            label: '移除紀錄卡片',
            danger: true,
            run: () => {
              void api('/local/canvas', { task_id: menuTrace.task_id, pinned: false })
                .then(loadTraces)
                .catch(onError);
            },
          },
        ]
      : [
          {
            label: '在這裡提問',
            icon: <Plus size={16} />,
            disabled: locked,
            run: () => {
              if (menu?.point) onCreateAt(menu.point);
            },
          },
          {
            label: '在這裡新增筆記',
            icon: <StickyNote size={16} />,
            disabled: locked,
            run: () => {
              if (menu?.point) onNoteAt(menu.point);
            },
          },
          {
            label: '在這裡匯入參考',
            icon: <FilePlus2 size={16} />,
            disabled: locked,
            run: () => {
              if (menu?.point) onImportAt(menu.point);
            },
          },
          {
            label: '顯示全部卡片',
            icon: <ArrowUpRight size={16} />,
            run: () => {
              void flow.fitView({ padding: 0.15, duration: 200 });
            },
          },
          { label: '回收桶', icon: <RotateCcw size={16} />, divider: true, run: onTrash },
        ];
  return (
    <CardContentContext.Provider value={renderContent}>
      <ReactFlow
        nodes={nodes}
        edges={[...edges, ...traceEdges]}
        onEdgeClick={(event, edge) => {
          const stored = state.edges.find((e) => e.id === edge.id);
          if (stored?.edge_class === 'semantic' && stored.provenance === 'user')
            setEdgeMenu({ x: event.clientX, y: event.clientY, id: stored.id });
        }}
        nodeTypes={nodeTypes}
        onNodesChange={changes}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            (event.target as Element).closest('input,textarea,select,[contenteditable],.nokey') ||
            locked ||
            window.getSelection()?.toString()
          )
            return;
          const selectedNodes = flow
            .getNodes()
            .filter((node) => node.selected && node.type === 'card');
          if (selectedNodes.length !== 1) return;
          const node = state.nodes.find(
            (node) => node.id === selectedNodes[0].id && node.visibility !== 'hidden',
          );
          if (
            node &&
            !busyNodeIds.includes(node.id) &&
            ['Delete', 'Backspace', 'F2'].includes(event.key)
          ) {
            event.preventDefault();
            if (event.key === 'F2') onRename(node);
            else onDelete(node);
          }
        }}
        onNodeContextMenu={(event, node) => {
          if (
            (event.target as Element).closest('input,textarea,select,[contenteditable]') ||
            window.getSelection()?.toString()
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          setMenu({ id: node.id, x: event.clientX, y: event.clientY });
        }}
        onPaneContextMenu={(event) => {
          if (
            (event.target as Element).closest(
              '.react-flow__node,input,textarea,select,[contenteditable]',
            )
          )
            return;
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          });
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).classList.contains('react-flow__pane'))
            onCreateAt(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
        zoomOnDoubleClick={false}
        onMoveStart={() => window.dispatchEvent(new Event('canvas-view-changed'))}
        onNodeDragStop={(_e, node) => {
          if (node.type === 'trace')
            void api('/local/canvas', {
              task_id: node.data.trace.task_id,
              pinned: true,
              x: node.position.x,
              y: node.position.y,
            })
              .then(loadTraces)
              .catch((e) => setTraceError(e.message));
          else onMove(node.id, node.position.x, node.position.y);
        }}
        onMoveEnd={(_e, viewport) => onViewport(viewport)}
        defaultViewport={initialViewport ?? state.workspace.settings.viewport}
        minZoom={0.01}
        maxZoom={2}
        nodesConnectable={false}
        deleteKeyCode={null}
        panOnScroll
        selectionOnDrag={tool === 'select' && !window.matchMedia('(pointer: coarse)').matches}
        panOnDrag={tool === 'hand' || window.matchMedia('(pointer: coarse)').matches ? [0, 1] : [1]}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d5d7dc" gap={24} size={1} />
        {traceError && (
          <div className="trace-load-error" role="alert">
            {traceError}
          </div>
        )}
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => (n.data.type === 'excerpt' ? '#c4b4dc' : '#9fb7a8')}
          maskColor="rgba(246,245,241,.75)"
          pannable
          zoomable
        />
      </ReactFlow>
      {menu && <ContextMenu x={menu.x} y={menu.y} actions={actions} onClose={closeMenu} />}
      {linkFrom && (
        <div className="link-banner" role="status">
          <Link2 size={15} />
          <span>選擇要連結的卡片</span>
          <button aria-label="取消連結" onClick={() => setLinkFrom(null)}>
            <Unlink size={14} />
          </button>
        </div>
      )}
      {relationMenu && (
        <ContextMenu
          x={relationMenu.x}
          y={relationMenu.y}
          onClose={() => setRelationMenu(null)}
          actions={LINK_TYPES.map((type) => ({
            label: linkNames[type],
            icon: <span className="link-dot" style={{ background: linkColors[type] }} />,
            run: () =>
              saveLink(() =>
                api('/links', {
                  source_node_id: relationMenu.source,
                  target_node_id: relationMenu.target,
                  type,
                }),
              ),
          }))}
        />
      )}
      {edgeMenu && (
        <ContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          onClose={() => setEdgeMenu(null)}
          actions={[
            ...LINK_TYPES.map((type) => ({
              label: linkNames[type],
              icon: <span className="link-dot" style={{ background: linkColors[type] }} />,
              run: () =>
                saveLink(() => api('/links/' + encodeURIComponent(edgeMenu.id), { type }, 'PATCH')),
            })),
            {
              label: '移除連結',
              icon: <Unlink size={16} />,
              danger: true,
              divider: true,
              run: () =>
                saveLink(() => api('/links/' + encodeURIComponent(edgeMenu.id), {}, 'DELETE')),
            },
          ]}
        />
      )}
    </CardContentContext.Provider>
  );
}
