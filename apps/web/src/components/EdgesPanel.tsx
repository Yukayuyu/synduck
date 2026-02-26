'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createEdge, EdgeItem, fetchEdges, fetchNodes, NodeItem } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';

interface Props {
  graphId: string;
}

export function EdgesPanel({ graphId }: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const canEdit = isLoggedIn();

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label);
    return m;
  }, [nodes]);

  const load = useCallback(async () => {
    const [n, e] = await Promise.all([fetchNodes(graphId), fetchEdges(graphId)]);
    setNodes(n);
    setEdges(e);
  }, [graphId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!canEdit || !from || !to || from === to) return;
    setStatus('saving…');
    try {
      await createEdge(graphId, { from, to, note });
      setNote('');
      setStatus('saved');
      await load();
    } catch (e) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section style={{ minWidth: 300 }}>
      <h2>Edges ({edges.length})</h2>

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
          <button onClick={add} disabled={!from || !to || from === to}>
            Add edge
          </button>
          <div className="muted">{status}</div>
        </div>
      ) : (
        <p className="muted">Log in to edit.</p>
      )}

      <ul style={{ display: 'grid', gap: 6, maxHeight: '60vh', overflow: 'auto' }}>
        {edges.map((e) => (
          <li key={e.id}>
            <b>{labelById.get(e.from) || e.from}</b> → <b>{labelById.get(e.to) || e.to}</b>
            {e.note ? <span className="muted"> ({e.note})</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}