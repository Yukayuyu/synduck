import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
} from '@xyflow/react';
import { MessageSquare, Quote, ArrowUpRight, Pin, Plus, Check, Ban } from 'lucide-react';
import type { CanvasNode } from '@acc/domain';
import { api, type ClientState } from './api';
import { TraceCardContent, type CanvasTrace } from './TaskTrace';
import '@xyflow/react/dist/style.css';

type CardData = {
  title: string;
  preview: string;
  type: CanvasNode['type'];
  count: number;
  active: boolean;
  context: boolean;
  pinned: boolean;
  excluded: boolean;
  node: CanvasNode;
  onOpen: () => void;
  onSelect: () => void;
  onPin: () => void;
  onExclude: () => void;
  [key: string]: unknown;
};
type CardNode = Node<CardData, 'card'>;
// React Flow mirrors node data through effects. Keep text and editor props
// outside that queue, and keep layout nodes stable while the user types.
const CardContentContext = createContext<(node: CanvasNode) => ReactNode>(() => null);

function Card({ data }: NodeProps<CardNode>) {
  const zoom = useStore((s) => s.transform[2]);
  const renderContent = useContext(CardContentContext);
  return (
    <article
      className={`canvas-card ${data.type} ${data.active ? 'active' : ''} ${data.context ? 'context-selected' : ''} ${data.excluded ? 'excluded' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="card-eyebrow">
        <span>
          {data.type === 'excerpt' ? <Quote size={13} /> : <MessageSquare size={13} />}
          {data.type === 'excerpt' ? '摘录' : '对话'}
        </span>
        {data.pinned && <Pin size={13} aria-label="已固定" />}
        {data.excluded && <Ban size={13} aria-label="已排除" />}
      </div>
      <button className="card-title nodrag" onClick={data.onOpen}>
        {data.title}
        <ArrowUpRight size={16} />
      </button>
      {data.active || zoom > 0.45 ? (
        <div className="card-content nodrag nopan nowheel nokey">{renderContent(data.node)}</div>
      ) : (
        <p className="card-preview">{data.preview || '放大以閱讀與提問'}</p>
      )}
      {zoom > 0.55 && (
        <div className="card-footer">
          <span>{data.type === 'excerpt' ? '来源已保留' : `${data.count} 条消息`}</span>
          <div className="card-actions nodrag">
            <button
              title={data.context ? '取消本轮选择' : '选为本轮上下文'}
              aria-label={data.context ? '取消本轮选择' : '选为本轮上下文'}
              className={data.context ? 'toggled' : ''}
              onClick={data.onSelect}
            >
              {data.context ? <Check size={14} /> : <Plus size={14} />}
            </button>
            <button
              title={data.pinned ? '取消固定' : '固定上下文'}
              aria-label={data.pinned ? '取消固定' : '固定上下文'}
              className={data.pinned ? 'toggled' : ''}
              onClick={data.onPin}
            >
              <Pin size={14} />
            </button>
            <button
              title={data.excluded ? '恢复上下文' : '排除上下文'}
              aria-label={data.excluded ? '恢复上下文' : '排除上下文'}
              onClick={data.onExclude}
            >
              <Ban size={14} />
            </button>
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </article>
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
  activeNode: string | null;
  selected: string[];
  locate: { id: string; tick: number } | null;
  onOpen: (node: CanvasNode) => void;
  onSelect: (id: string) => void;
  onControl: (id: string, action: 'pin' | 'unpin' | 'exclude' | 'restore') => void;
  onMove: (id: string, x: number, y: number) => void;
  onViewport: (v: Viewport) => void;
  renderContent: (node: CanvasNode) => ReactNode;
  tool: 'select' | 'hand';
  onCreateAt: (position: { x: number; y: number }) => void;
  onOpenTrace: (id: string) => void;
  traceEpoch: number;
  onTraceCount: (count: number) => void;
}

export function Canvas({
  state,
  activeNode,
  selected,
  locate,
  onOpen,
  onSelect,
  onControl,
  onMove,
  onViewport,
  renderContent,
  tool,
  onCreateAt,
  onOpenTrace,
  traceEpoch,
  onTraceCount,
}: Props) {
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
  const latest = useRef({ nodes: state.nodes, activeNode });
  const lastLocated = useRef('');
  latest.current = { nodes: state.nodes, activeNode };
  const mapped = useMemo<CardNode[]>(
    () =>
      state.nodes.map((n) => ({
        id: n.id,
        type: 'card',
        dragHandle: '.card-eyebrow',
        zIndex: activeNode === n.id ? 10 : 0,
        position: { x: n.x, y: n.y },
        data: {
          node: n,
          title: n.title,
          type: n.type,
          preview:
            n.ref_type === 'excerpt'
              ? state.excerpts.find((e) => e.id === n.ref_id)?.snapshot_text || ''
              : n.representation.summary,
          count: state.turns.filter((t) => t.conversation_id === n.ref_id).length,
          active: activeNode === n.id,
          context: selected.includes(n.id),
          pinned: state.workspace.settings.pinned_node_ids.includes(n.id),
          excluded: state.workspace.settings.excluded_node_ids.includes(n.id),
          onOpen: () => onOpen(n),
          onSelect: () => onSelect(n.id),
          onPin: () =>
            onControl(
              n.id,
              state.workspace.settings.pinned_node_ids.includes(n.id) ? 'unpin' : 'pin',
            ),
          onExclude: () =>
            onControl(
              n.id,
              state.workspace.settings.excluded_node_ids.includes(n.id) ? 'restore' : 'exclude',
            ),
        },
      })),
    [state, activeNode, selected, onOpen, onSelect, onControl],
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
  useEffect(() => setNodes([...mapped, ...traceNodes]), [mapped, traceNodes]);
  useEffect(() => {
    if (!locate) return;
    const key = locate.id + ':' + locate.tick;
    if (lastLocated.current === key) return;
    const node = latest.current.nodes.find((n) => n.id === locate.id);
    if (node) {
      lastLocated.current = key;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const zoom = Math.min(1, (width - 36) / 360, (height - 175) / 670);
      void flow.setCenter(node.x + 180, node.y + (node.ref_type === 'excerpt' ? 190 : 325), {
        zoom: Math.max(0.5, zoom),
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
  const edges = state.edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.type === 'branch_from' ? '从此分支' : e.type === 'excerpt_from' ? '摘录' : e.type,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#a8b4ae', width: 16, height: 16 },
    style: {
      stroke: '#a8b4ae',
      strokeWidth: 1.3,
      strokeDasharray: e.edge_class === 'semantic' && !e.confirmed ? '5 5' : undefined,
    },
    labelStyle: { fill: '#78847e', fontSize: 10 },
    labelBgStyle: { fill: '#f6f5f1' },
    labelBgPadding: [6, 4] as [number, number],
  }));
  const traceEdges = traces.flatMap((trace) => {
    const pkg = state.packages.find((pkg) => pkg.package_id === trace.context_package_id);
    const context = state.context_sets.find((context) => context.id === pkg?.context_set_id);
    if (!context || !state.nodes.some((node) => node.id === context.current_node_id)) return [];
    return [
      {
        id: 'trace-source:' + trace.task_id,
        source: context.current_node_id,
        target: 'trace:' + trace.task_id,
        label: '輸入上下文',
        type: 'smoothstep',
        style: { stroke: '#798be2', strokeWidth: 1.5 },
        labelStyle: { fill: '#6472aa', fontSize: 10 },
        labelBgStyle: { fill: '#f6f5f1' },
      },
    ];
  });
  return (
    <CardContentContext.Provider value={renderContent}>
      <ReactFlow
        nodes={nodes}
        edges={[...edges, ...traceEdges]}
        nodeTypes={nodeTypes}
        onNodesChange={changes}
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
        defaultViewport={state.workspace.settings.viewport}
        minZoom={0.25}
        maxZoom={2}
        nodesConnectable={false}
        deleteKeyCode={null}
        panOnScroll
        selectionOnDrag={tool === 'select' && !window.matchMedia('(pointer: coarse)').matches}
        panOnDrag={
          tool === 'hand' || window.matchMedia('(pointer: coarse)').matches ? true : [1, 2]
        }
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
    </CardContentContext.Provider>
  );
}
