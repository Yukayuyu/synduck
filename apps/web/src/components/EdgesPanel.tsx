'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createEdge, EdgeItem, fetchEdges, fetchNodes, NodeItem, updateEdge, EDGE_TYPES } from '@/lib/api';
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
  const [annotation, setAnnotation] = useState('');
  const [edgeType, setEdgeType] = useState<string>('references');
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const saveEdge = async () => {
    if (!canEdit || !from || !to || from === to) return;
    setStatus('saving…');
    try {
      const existing = edges.find((e) =>
        (e.from === from && e.to === to) || (e.from === to && e.to === from)
      );
      if (existing) {
        await updateEdge(graphId, existing.id, { type: edgeType, note, annotation });
      } else {
        await createEdge(graphId, { from, to, type: edgeType, note, annotation });
      }
      setNote('');
      setAnnotation('');
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
          <select value={edgeType} onChange={(e) => setEdgeType(e.target.value)}>
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="annotation (optional)" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
          <button onClick={() => void saveEdge()} disabled={!from || !to || from === to}>
            {edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from)) ? 'Update' : 'Add'} edge
          </button>
          <div className="muted">{status}</div>
        </div>
      ) : (
        <p className="muted">Log in to add edges.</p>
      )}

      <ul style={{ display: 'grid', gap: 6, maxHeight: '60vh', overflow: 'auto' }}>
        {edges.map((e) => (
          <li key={e.id}>
            <b>{labelById.get(e.from) || e.from}</b>{' '}
            <span style={{ color: 'var(--muted)' }}>[{e.type || '?'}]</span>{' '}
            <b>{labelById.get(e.to) || e.to}</b>
            {e.annotation ? <span className="muted"> ⟨{e.annotation}⟩</span> : null}
            {e.note ? <span className="muted"> ({e.note})</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
