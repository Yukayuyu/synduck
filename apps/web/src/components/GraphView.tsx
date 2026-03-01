'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnSelectionChangeParams,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { createEdge, createNode, deleteEdge, fetchEdges, fetchNodes } from '@/lib/api';
import { config } from '@/lib/config';
import { EditableNode, type EditableNodeData } from '@/components/EditableNode';

type Status = 'idle' | 'loading' | 'error';

export interface GraphViewProps {
  graphId: string;
  shareToken?: string;
  canEdit: boolean;
}

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
  return edges.find(
    (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
  );
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

function GraphViewInner({ graphId, shareToken, canEdit }: GraphViewProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [nodes, setNodes] = useState<Node<EditableNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [pendingLinkFrom, setPendingLinkFrom] = useState<string | null>(null);
  const [touchAddMode, setTouchAddMode] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({
    nodes: [],
    edges: [],
  });
  const [ctxMenu, setCtxMenu] = useState<
    | null
    | (
        | { kind: 'pane'; clientX: number; clientY: number }
        | { kind: 'node'; nodeId: string; clientX: number; clientY: number }
        | { kind: 'edge'; edgeId: string; clientX: number; clientY: number }
      )
  >(null);

  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const nodeTypes = useMemo(() => ({ editable: EditableNode }), []);

  const debug = useMemo(() => {
    const apiBase =
      config.apiBaseUrl ||
      (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : '') ||
      '';
    return {
      href: typeof window !== 'undefined' ? window.location.href : '',
      apiBase,
      graphId,
      shareToken: shareToken || undefined,
      nodesUrl: `${apiBase.replace(/\/$/, '')}/nodes?graphId=${graphId}${shareToken ? `&shareToken=${shareToken}` : ''}`,
      edgesUrl: `${apiBase.replace(/\/$/, '')}/edges?graphId=${graphId}${shareToken ? `&shareToken=${shareToken}` : ''}`,
      healthUrl: apiBase ? apiBase.replace(/\/$/, '') + '/health' : '',
    };
  }, [graphId, shareToken]);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [ns, es] = await Promise.all([
        fetchNodes(graphId, shareToken),
        fetchEdges(graphId, shareToken),
      ]);

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
    } catch (e: unknown) {
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
  }, [graphId, shareToken, debug.healthUrl]);

  useEffect(() => {
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
        setCtxMenu(null);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.edges.length === 0) return;
        e.preventDefault();

        const toDelete = selection.edges.slice();
        setSelection((prev) => ({ ...prev, edges: [] }));

        void (async () => {
          for (const edgeId of toDelete) {
            const edge = edges.find((x) => x.id === edgeId);
            if (!edge) continue;
            try {
              await deleteEdge(graphId, { from: edge.source!, to: edge.target! });
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
  }, [canEdit, edges, selection.edges, graphId]);

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
          const res = await createNode(graphId, { label: value });
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== tempId) return n;
              return { ...n, id: res.id, data: { label: value, editing: false } };
            }),
          );
        } catch (e: unknown) {
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
    [canEdit, rf, graphId],
  );

  const onDoubleClick = useCallback(
    (evt: React.MouseEvent) => {
      if (!canEdit) return;
      createTempNodeAtClient(evt.clientX, evt.clientY);
    },
    [canEdit, createTempNodeAtClient],
  );

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!canEdit) return;
      if (!conn.source || !conn.target) return;
      if (conn.source === conn.target) return;

      const existing = findEdgeBetween(edges, conn.source, conn.target);
      if (existing) {
        try {
          await deleteEdge(graphId, { from: conn.source, to: conn.target });
          setEdges((prev) => prev.filter((e) => e.id !== existing.id));
        } catch (e: unknown) {
          setError(`deleteEdge failed: ${String(e)}`);
          setStatus('error');
        }
        return;
      }

      try {
        const res = await createEdge(graphId, { from: conn.source, to: conn.target });
        setEdges((prev) => [
          ...prev,
          {
            id: res.id,
            source: conn.source!,
            target: conn.target!,
          },
        ]);
      } catch (e: unknown) {
        setError(`createEdge failed: ${String(e)}`);
        setStatus('error');
      }
    },
    [canEdit, edges, graphId],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const deleteEdgeById = useCallback(
    async (edgeId: string) => {
      if (!canEdit) return;
      const edge = edges.find((x) => x.id === edgeId);
      if (!edge) return;
      try {
        await deleteEdge(graphId, { from: edge.source!, to: edge.target! });
        setEdges((prev) => prev.filter((x) => x.id !== edgeId));
      } catch (err: unknown) {
        setError(`deleteEdge failed: ${String(err)}`);
        setStatus('error');
      }
    },
    [edges, graphId, canEdit],
  );

  const startLinkFromNode = useCallback(
    (nodeId: string) => {
      if (!canEdit) return;
      if (nodeId.startsWith('temp#')) return;
      setPendingLinkFrom(nodeId);
    },
    [canEdit],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    async (_evt, node) => {
      if (!canEdit) return;
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
          await deleteEdge(graphId, { from, to });
          setEdges((prev) => prev.filter((e) => e.id !== existing.id));
        } catch (e: unknown) {
          setError(`deleteEdge failed: ${String(e)}`);
          setStatus('error');
        }
        return;
      }

      try {
        const res = await createEdge(graphId, { from, to });
        setEdges((prev) => [
          ...prev,
          {
            id: res.id,
            source: from,
            target: to,
          },
        ]);
      } catch (e: unknown) {
        setError(`createEdge failed: ${String(e)}`);
        setStatus('error');
      }
    },
    [canEdit, pendingLinkFrom, edges, graphId],
  );

  const header = useMemo(() => {
    if (status === 'loading') return 'Loading graph…';
    if (status === 'error') return 'Error loading graph';
    return `Graph ${graphId.slice(0, 8)}`;
  }, [status, graphId]);

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
          if (!canEdit || !touchAddMode) return;
          createTempNodeAtClient(e.clientX, e.clientY);
          setTouchAddMode(false);
        }}
        onPointerUp={() => setIsPanning(false)}
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          borderTop: '1px solid var(--border)',
          overflow: 'hidden',
          cursor: spaceDown ? (isPanning ? 'grabbing' : 'grab') : canEdit ? 'default' : 'default',
          touchAction: 'none',
        }}
      >
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
            className="row"
            style={{
              pointerEvents: 'auto',
              gap: 'var(--spacing-sm)',
              alignItems: 'center',
              padding: 'var(--spacing-sm) var(--spacing-md)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(17,24,39,0.8)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <strong style={{ fontSize: '1rem' }}>{header}</strong>
            <span className="muted">
              {nodes.length} nodes · {edges.length} edges
            </span>
            {!canEdit && (
              <span className="muted" style={{ fontSize: 12 }}>
                Read-only
              </span>
            )}
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
              disabled={!canEdit}
              title="Add node (tap then tap canvas)"
            >
              {touchAddMode ? 'Tap canvas…' : '+ Node'}
            </button>
            <button className="btn" onClick={() => void load()} disabled={status === 'loading'}>
              Refresh
            </button>
            <a href="/graphs" className="btn secondary" style={{ opacity: 0.7 }}>
              ← Graphs
            </a>
          </div>
        </div>

        <ReactFlow
          nodes={decoratedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onDoubleClick={onDoubleClick}
          onNodeClick={onNodeClick}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onPaneClick={() => setCtxMenu(null)}
          onPaneContextMenu={
            canEdit
              ? (e) => {
                  e.preventDefault();
                  setCtxMenu({ kind: 'pane', clientX: e.clientX, clientY: e.clientY });
                }
              : undefined
          }
          onNodeContextMenu={
            canEdit
              ? (_e, node) => {
                  _e.preventDefault();
                  setCtxMenu({
                    kind: 'node',
                    nodeId: node.id,
                    clientX: _e.clientX,
                    clientY: _e.clientY,
                  });
                }
              : undefined
          }
          onEdgeContextMenu={
            canEdit
              ? (_e, edge) => {
                  _e.preventDefault();
                  setCtxMenu({
                    kind: 'edge',
                    edgeId: edge.id,
                    clientX: _e.clientX,
                    clientY: _e.clientY,
                  });
                }
              : undefined
          }
          fitView
          minZoom={0.1}
          maxZoom={2}
          zoomOnScroll
          zoomOnPinch
          panOnScroll
          multiSelectionKeyCode={['Shift']}
          selectionOnDrag={canEdit && !spaceDown}
          panOnDrag={spaceDown ? [0, 1] : [1]}
          onMoveStart={() => {
            if (spaceDown) setIsPanning(true);
          }}
          onMoveEnd={() => setIsPanning(false)}
          connectionMode={ConnectionMode.Loose}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
          {ctxMenu ? (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: ctxMenu.clientX,
                top: ctxMenu.clientY,
                zIndex: 1000,
                background: 'rgba(10,10,10,0.92)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 6,
                minWidth: 180,
                boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
              }}
            >
              {ctxMenu.kind === 'pane' ? (
                <>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={() => {
                      createTempNodeAtClient(ctxMenu.clientX, ctxMenu.clientY);
                      closeCtxMenu();
                    }}
                  >
                    + Add node here
                  </button>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                    onClick={() => {
                      setTouchAddMode(true);
                      closeCtxMenu();
                    }}
                  >
                    Enter add mode…
                  </button>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                    onClick={closeCtxMenu}
                  >
                    Cancel
                  </button>
                </>
              ) : null}

              {ctxMenu.kind === 'node' ? (
                <>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={() => {
                      startLinkFromNode(ctxMenu.nodeId);
                      closeCtxMenu();
                    }}
                  >
                    Connect from this node
                  </button>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                    onClick={() => {
                      setPendingLinkFrom(null);
                      closeCtxMenu();
                    }}
                  >
                    Cancel linking
                  </button>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                    onClick={closeCtxMenu}
                  >
                    Close
                  </button>
                </>
              ) : null}

              {ctxMenu.kind === 'edge' ? (
                <>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={() => {
                      void deleteEdgeById(ctxMenu.edgeId);
                      closeCtxMenu();
                    }}
                  >
                    Delete edge
                  </button>
                  <button
                    className="btn"
                    style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
                    onClick={closeCtxMenu}
                  >
                    Close
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </ReactFlow>
      </div>
    </section>
  );
}

export function GraphView({ graphId, shareToken, canEdit }: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
    </ReactFlowProvider>
  );
}
export default GraphView;
