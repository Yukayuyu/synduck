'use client';

import { useEffect, useMemo, useState } from 'react';
import { createEdge, EdgeItem, fetchEdges, fetchNodes, NodeItem, updateEdge, EDGE_TYPES } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';

export function EdgesPanel() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [edgeType, setEdgeType] = useState('references');
  const [status, setStatus] = useState('');
  const [canEdit, setCanEdit] = useState(false);

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label);
    return m;
  }, [nodes]);

  const load = async () => {
    const [n, e] = await Promise.all([fetchNodes(), fetchEdges()]);
    setNodes(n);
    setEdges(e);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanEdit(isLoggedIn());
    void load();
  }, []);

  const saveEdge = async () => {
    setStatus('saving…');
    try {
      const type = edgeType;
      const existing = edges.find((e) =>
        (e.from === from && e.to === to) || (e.from === to && e.to === from)
      );
      if (existing) {
        await updateEdge({ from, to, type, note });
      } else {
        await createEdge({ from, to, type, note });
      }
      setNote('');
      setStatus('saved');
      await load();
    } catch (e) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section>
      <h2>Edges</h2>

      {canEdit ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">from…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">to…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
          <select value={edgeType} onChange={(e) => setEdgeType(e.target.value)}>
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button onClick={() => void saveEdge()} disabled={!from || !to || from === to}>
            {edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from)) ? 'Update' : 'Add'} edge
          </button>
          <div className="muted">{status}</div>
        </div>
      ) : (
        <p className="muted">Log in to add edges.</p>
      )}

      <ul style={{ display: 'grid', gap: 6 }}>
        {edges.map((e) => (
          <li key={e.id}>
            <b>{labelById.get(e.from) || e.from}</b>{' '}
            <span style={{ color: 'var(--muted)' }}>[{e.type || '?'}]</span>{' '}
            <b>{labelById.get(e.to) || e.to}</b>
            {e.note ? <span className="muted"> ({e.note})</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
