'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { createEdge, createNode, fetchEdges, fetchNodes } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import { config } from '@/lib/config';
import { EditableNode, type EditableNodeData } from '@/components/EditableNode';

type Status = 'idle' | 'loading' | 'error';

function hashToUnit(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) / 2 ** 32;
}

function defaultPos(id: string) {
  const u1 = hashToUnit(id + ':x');
  const u2 = hashToUnit(id + ':y');
  return { x: (u1 - 0.5) * 900, y: (u2 - 0.5) * 600 };
}

async function tryFetchJson(url: string) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function GraphViewInner() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [nodes, setNodes] = useState<Node<EditableNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [canEdit] = useState(() => isLoggedIn());
  const [pendingLinkFrom, setPendingLinkFrom] = useState<string | null>(null);

  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ editable: EditableNode }), []);

  const debug = useMemo(() => {
    const apiBase = config.apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || '';
    return {
      href: typeof window !== 'undefined' ? window.location.href : '',
      apiBase,
      nodesUrl: apiBase ? apiBase.replace(/\/$/, '') + '/nodes' : '',
      edgesUrl: apiBase ? apiBase.replace(/\/$/, '') + '/edges' : '',
      healthUrl: apiBase ? apiBase.replace(/\/$/, '') + '/health' : '',
    };
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [ns, es] = await Promise.all([fetchNodes(), fetchEdges()]);

      const nextNodes: Node<EditableNodeData>[] = ns.map((n) => ({
        id: n.id,
        type: 'editable',
        position: defaultPos(n.id),
        data: { label: n.label },
      }));

      const nextEdges: Edge[] = es.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.note || undefined,
      }));

      setNodes(nextNodes);
      setEdges(nextEdges);
      setStatus('idle');
    } catch (e) {
      let extra = '';
      try {
        if (debug.healthUrl) {
          const h = await tryFetchJson(debug.healthUrl);
          extra += `\nhealth: ${h.status} ok=${String(h.ok)} body=${JSON.stringify(h.json)}`;
        }
      } catch (e2) {
        extra += `\nhealth_fetch_error: ${String(e2)}`;
      }
      setStatus('error');
      setError(`${String(e)}${extra}`);
    }
  }, [debug.healthUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const onDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      if (!canEdit) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = rf.project({
        x: evt.clientX - bounds.left,
        y: evt.clientY - bounds.top,
      });

      const tempId = `temp#${Date.now()}#${Math.random().toString(16).slice(2)}`;

      const onCancel = () => {
        setNodes((prev) => prev.filter((n) => n.id !== tempId));
      };

      const onCommit = async (value: string) => {
        // optimistic: keep temp node but mark as saving
        try {
          const res = await createNode({ label: value });
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== tempId) return n;
              return {
                ...n,
                id: res.id,
                data: { label: value, editing: false },
              };
            }),
          );
        } catch (e) {
          setError(`createNode failed: ${String(e)}`);
          setStatus('error');
          onCancel();
        }
      };

      const newNode: Node<EditableNodeData> = {
        id: tempId,
        type: 'editable',
        position,
        data: { label: '', editing: true, onCommit, onCancel },
      };

      setNodes((prev) => [...prev, newNode]);
    },
    [canEdit, rf],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    async (_evt, node) => {
      if (!canEdit) return;
      // ignore temp/editing nodes
      if (node.id.startsWith('temp#')) return;

      if (!pendingLinkFrom) {
        setPendingLinkFrom(node.id);
        return;
      }

      if (pendingLinkFrom === node.id) {
        setPendingLinkFrom(null);
        return;
      }

      const from = pendingLinkFrom;
      const to = node.id;
      setPendingLinkFrom(null);

      try {
        const res = await createEdge({ from, to });
        setEdges((prev) => [
          ...prev,
          {
            id: res.id,
            source: from,
            target: to,
          },
        ]);
      } catch (e) {
        setError(`createEdge failed: ${String(e)}`);
        setStatus('error');
      }
    },
    [canEdit, pendingLinkFrom],
  );

  const header = useMemo(() => {
    if (status === 'loading') return 'Loading board…';
    if (status === 'error') return 'Board (error)';
    return `Board (${nodes.length} nodes / ${edges.length} edges)`;
  }, [status, nodes.length, edges.length]);

  const decoratedNodes = useMemo(() => {
    return nodes.map((n) => {
      const selected = pendingLinkFrom === n.id;
      if (!selected) return n;
      return {
        ...n,
        data: { ...n.data },
        style: { ...(n.style || {}), outline: '2px solid #7aa2ff', outlineOffset: 2 },
      };
    });
  }, [nodes, pendingLinkFrom]);

  return (
    <section style={{ width: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{header}</h2>
          <div className="muted" style={{ marginTop: 6 }}>
            Double-click empty space to add a node. Click two nodes to connect.{' '}
            {pendingLinkFrom ? 'Select target node… (click same node to cancel)' : null}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void load()} disabled={status === 'loading'}>
            Refresh
          </button>
        </div>
      </div>

      {status === 'error' ? (
        <>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff9aa2' }}>{error}</pre>
          <details>
            <summary>debug</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(debug, null, 2)}</pre>
          </details>
        </>
      ) : null}

      <div
        ref={wrapperRef}
        style={{ height: '62vh', minHeight: 520, width: '100%', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}
      >
        <ReactFlow
          nodes={decoratedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onDoubleClick={onDoubleClick}
          onNodeClick={onNodeClick}
                  fitView
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </section>
  );
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphViewInner />
    </ReactFlowProvider>
  );
}
