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
  Trash2,
  Pencil,
  Copy,
  RotateCcw,
  GitBranch,
} from 'lucide-react';
import type { CanvasNode } from '@acc/domain';
import { api, type ClientState } from './api';
import { TraceCardContent, type CanvasTrace } from './TaskTrace';
import { ContextMenu, type MenuAction } from './ContextMenu';
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
  onMenu: (event: MouseEvent) => void;
  [key: string]: unknown;
};
type CardNode = Node<CardData, 'card'>;
// React Flow mirrors node data through effects. Keep text and editor props
// outside that queue, and keep layout nodes stable while the user types.
const CardContentContext = createContext<(node: CanvasNode, ready: boolean) => ReactNode>(
  () => null,
);

function Card({ data, width, height }: NodeProps<CardNode>) {
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
        <button
          className="card-menu-button nodrag nopan nokey"
          aria-label={'卡片操作：' + data.title}
          title="卡片操作"
          onClick={data.onMenu}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      <button className="card-title nodrag" onClick={data.onOpen}>
        {data.title}
        <ArrowUpRight size={16} />
      </button>
      {data.active || zoom > 0.45 ? (
        <div className="card-content nodrag nopan nowheel nokey">
          {renderContent(data.node, Boolean(width && height))}
        </div>
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
  renderContent: (node: CanvasNode, ready: boolean) => ReactNode;
  tool: 'select' | 'hand';
  onCreateAt: (position: { x: number; y: number }) => void;
  onOpenTrace: (id: string) => void;
  traceEpoch: number;
  onTraceCount: (count: number) => void;
  locked: boolean;
  onDelete: (node: CanvasNode) => void;
  onRename: (node: CanvasNode) => void;
  onBranch: (node: CanvasNode) => void;
  onSource: (node: CanvasNode) => void;
  onTrash: () => void;
  onError: (error: unknown) => void;
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
  locked,
  onDelete,
  onRename,
  onBranch,
  onSource,
  onTrash,
  onError,
}: Props) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id?: string;
    point?: { x: number; y: number };
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
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
  const latest = useRef({ nodes: state.nodes, activeNode });
  const lastLocated = useRef('');
  latest.current = { nodes: state.nodes, activeNode };
  const mapped = useMemo<CardNode[]>(
    () =>
      state.nodes
        .filter((n) => n.visibility !== 'hidden')
        .map((n) => ({
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
            onMenu: (event: MouseEvent) => openCardMenu(n.id, event),
          },
        })),
    [state, activeNode, selected, onOpen, onSelect, onControl, openCardMenu],
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
  const visibleIds = new Set(mapped.map((n) => n.id));
  const edges = state.edges
    .filter((e) => visibleIds.has(e.source_node_id) && visibleIds.has(e.target_node_id))
    .map((e) => {
      const color =
        e.type === 'excerpt_from' ? '#bf9d68' : e.type === 'branch_from' ? '#9583c3' : '#a8b4ae';
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label:
          e.type === 'branch_from' ? '延伸提問' : e.type === 'excerpt_from' ? '摘錄原文' : e.type,
        className: `relation-${e.type}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        style: {
          stroke: color,
          strokeWidth: 1.3,
          strokeDasharray:
            e.edge_class === 'semantic' && !e.confirmed
              ? '5 5'
              : e.type === 'excerpt_from'
                ? '3 4'
                : undefined,
        },
        labelStyle: { fill: e.type === 'excerpt_from' ? '#917347' : '#807194', fontSize: 10 },
        labelBgStyle: { fill: '#f6f5f9' },
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
        type: 'smoothstep',
        style: { stroke: '#798be2', strokeWidth: 1.5 },
        labelStyle: { fill: '#6472aa', fontSize: 10 },
        labelBgStyle: { fill: '#f6f5f1' },
      },
    ];
  });
  const menuNode = state.nodes.find((node) => node.id === menu?.id && node.visibility !== 'hidden');
  const menuTrace = traces.find((trace) => 'trace:' + trace.task_id === menu?.id);
  const actions: MenuAction[] = menuNode
    ? [
        {
          label: menuNode.ref_type === 'excerpt' ? '檢視摘錄' : '繼續提問',
          icon: <MessageSquare size={16} />,
          run: () => onOpen(menuNode),
        },
        {
          label: '重新命名',
          icon: <Pencil size={16} />,
          disabled: locked,
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
        ...(menuNode.ref_type === 'excerpt'
          ? [
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
          disabled: locked,
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
          if (node && ['Delete', 'Backspace', 'F2'].includes(event.key)) {
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
        defaultViewport={state.workspace.settings.viewport}
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
    </CardContentContext.Provider>
  );
}
