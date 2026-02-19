'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnSelectionChangeParams,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { createEdge, createNode, deleteEdge, fetchEdges, fetchNodes } from '@/lib/api';
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


function findEdgeBetween(edges: Edge[], a: string, b: string): Edge | undefined {
  return edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
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
  const [touchAddMode, setTouchAddMode] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setSpaceDown(true);
      }

      if (!canEdit) return;

      if (e.key === 'Escape') {
        setPendingLinkFrom(null);
        setTouchAddMode(false);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // For now: delete selected edges only (nodes delete API not implemented yet)
        if (selection.edges.length === 0) return;
        e.preventDefault();

        const toDelete = selection.edges.slice();
        setSelection((prev) => ({ ...prev, edges: [] }));

        void (async () => {
          for (const edgeId of toDelete) {
            const edge = edges.find((x) => x.id === edgeId);
            if (!edge) continue;
            try {
              await deleteEdge({ from: edge.source, to: edge.target });
              setEdges((prev) => prev.filter((x) => x.id !== edgeId));
            } catch (err) {
              setError(`deleteEdge failed: ${String(err)}`);
              setStatus('error');
            }
          }
        })();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [canEdit, edges, selection.edges]);

  const onSelectionChange = useCallback((p: OnSelectionChangeParams) => {
    setSelection({
      nodes: p.nodes.map((n) => n.id),
      edges: p.edges.map((e) => e.id),
    });
  }, []);

  const createTempNodeAtClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!canEdit) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = rf.project({
        x: clientX - bounds.left,
        y: clientY - bounds.top,
      });

      const tempId = `temp#${Date.now()}#${Math.random().toString(16).slice(2)}`;

      const onCancel = () => {
        setNodes((prev) => prev.filter((n) => n.id !== tempId));
      };

      const onCommit = async (value: string) => {
        try {
          const res = await createNode({ label: value });
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== tempId) return n;
              return { ...n, id: res.id, data: { label: value, editing: false } };
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

  const onDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      if (!canEdit) return;
      createTempNodeAtClient(evt.clientX, evt.clientY);
    },
    [canEdit, createTempNodeAtClient],
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

      const existing = findEdgeBetween(edges, from, to);
      if (existing) {
        try {
          await deleteEdge({ from, to });
          setEdges((prev) => prev.filter((e) => e.id !== existing.id));
        } catch (e) {
          setError(`deleteEdge failed: ${String(e)}`);
          setStatus('error');
        }
        return;
      }

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
    [canEdit, pendingLinkFrom, edges],
  );

  const header = useMemo(() => {
    if (status === 'loading') return 'Loading…';
    if (status === 'error') return 'Error';
    return 'Board';
  }, [status]);

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
    <section style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {status === 'error' ? (
        <div style={{ padding: 12 }}>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff9aa2', margin: 0 }}>{error}</pre>
          <details style={{ marginTop: 8 }}>
            <summary>debug</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(debug, null, 2)}</pre>
          </details>
        </div>
      ) : null}

      <div
        ref={wrapperRef}
        onPointerDown={(e) => {
          if (!canEdit) return;
          if (!touchAddMode) return;
          // tap to add
          createTempNodeAtClient(e.clientX, e.clientY);
          setTouchAddMode(false);
        }}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          borderTop: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        {/* Draw.io-ish toolbar overlay */}
        <div
          className="row"
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 10,
            justifyContent: 'space-between',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <strong style={{ fontSize: 13 }}>{header}</strong>
            <span className="muted" style={{ fontSize: 12 }}>
              {nodes.length} nodes / {edges.length} edges
            </span>
            {pendingLinkFrom ? (
              <span className="muted" style={{ fontSize: 12 }}>
                Linking… (tap target)
              </span>
            ) : null}
            {touchAddMode ? (
              <span className="muted" style={{ fontSize: 12 }}>
                Add mode… (tap canvas)
              </span>
            ) : null}
            {spaceDown ? (
              <span className="muted" style={{ fontSize: 12 }}>
                Pan (space)
              </span>
            ) : null}
          </div>

          <div style={{ pointerEvents: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => setTouchAddMode((v) => !v)}
              title="Add node (tap then tap canvas)"
            >
              {touchAddMode ? 'Tap canvas…' : '+ Node'}
            </button>
            <button className="btn" onClick={() => void load()} disabled={status === 'loading'}>
              Refresh
            </button>
          </div>
        </div>

        <ReactFlow
          nodes={decoratedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onDoubleClick={onDoubleClick}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          fitView
          minZoom={0.1}
          maxZoom={2}
          zoomOnScroll
          zoomOnPinch
          panOnScroll
          selectionOnDrag={!spaceDown}
          panOnDrag={spaceDown ? [0, 1] : [1]}
        >
          <Background />
          <Controls showInteractive={false} />
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
