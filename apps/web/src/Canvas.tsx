import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { ClientState } from './api';
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
  onOpen: () => void;
  onSelect: () => void;
  onPin: () => void;
  onExclude: () => void;
  [key: string]: unknown;
};
type CardNode = Node<CardData, 'card'>;

function Card({ data }: NodeProps<CardNode>) {
  const zoom = useStore((s) => s.transform[2]);
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
      {zoom > 0.55 && (
        <p className="card-preview">{data.preview || '每个想法，都可以从这里生长。'}</p>
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
const nodeTypes = { card: Card };

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
}: Props) {
  const flow = useReactFlow();
  const latest = useRef({ nodes: state.nodes, activeNode });
  latest.current = { nodes: state.nodes, activeNode };
  const mapped = useMemo<CardNode[]>(
    () =>
      state.nodes.map((n) => ({
        id: n.id,
        type: 'card',
        position: { x: n.x, y: n.y },
        data: {
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
  const [nodes, setNodes] = useState(mapped);
  useEffect(() => setNodes(mapped), [mapped]);
  useEffect(() => {
    if (!locate) return;
    const node = latest.current.nodes.find((n) => n.id === locate.id);
    if (node)
      void flow.setCenter(node.x + 150 + (latest.current.activeNode ? 185 : 0), node.y + 90, {
        zoom: 1,
        duration: 350,
      });
  }, [locate, flow]);
  const changes = useCallback(
    (changes: NodeChange<CardNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
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
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={changes}
      onNodeDoubleClick={(_e, node) => {
        const n = state.nodes.find((n) => n.id === node.id);
        if (n) onOpen(n);
      }}
      onNodeDragStop={(_e, node) => onMove(node.id, node.position.x, node.position.y)}
      onMoveEnd={(_e, viewport) => onViewport(viewport)}
      defaultViewport={state.workspace.settings.viewport}
      minZoom={0.25}
      maxZoom={2}
      nodesConnectable={false}
      deleteKeyCode={null}
      panOnScroll
      selectionOnDrag={!window.matchMedia('(pointer: coarse)').matches}
      panOnDrag={window.matchMedia('(pointer: coarse)').matches ? true : [1, 2]}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d6d9d3" gap={22} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) => (n.data.type === 'excerpt' ? '#c4b4dc' : '#9fb7a8')}
        maskColor="rgba(246,245,241,.75)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}
