'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { fetchEdges, fetchNodes } from '@/lib/api';

type Status = 'idle' | 'loading' | 'error';

function hashToUnit(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) / 2 ** 32;
}

function defaultPos(id: string) {
  const u1 = hashToUnit(id + ':x');
  const u2 = hashToUnit(id + ':y');
  // spread them a bit
  return { x: (u1 - 0.5) * 900, y: (u2 - 0.5) * 600 };
}

export function GraphView() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string>('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [ns, es] = await Promise.all([fetchNodes(), fetchEdges()]);

      const nextNodes: Node[] = ns.map((n) => ({
        id: n.id,
        position: defaultPos(n.id),
        data: { label: n.label },
      }));

      // Treat as undirected visually, but ReactFlow edges are directed.
      const nextEdges: Edge[] = es.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.note || undefined,
        animated: false,
      }));

      setNodes(nextNodes);
      setEdges(nextEdges);
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const header = useMemo(() => {
    if (status === 'loading') return 'Loading graph…';
    if (status === 'error') return 'Failed to load graph';
    return `Graph (${nodes.length} nodes / ${edges.length} edges)`;
  }, [status, nodes.length, edges.length]);

  return (
    <section style={{ width: '100%', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{header}</h2>
        <button onClick={() => void load()} disabled={status === 'loading'}>
          Refresh
        </button>
      </div>

      {status === 'error' ? (
        <pre style={{ whiteSpace: 'pre-wrap', color: '#b00' }}>{error}</pre>
      ) : null}

      <div style={{ height: 520, width: '100%', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      <p style={{ color: '#666', marginTop: 8 }}>
        MVP: random-ish layout per node id. Next step: persist positions + simple auto-layout.
      </p>
    </section>
  );
}
