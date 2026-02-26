'use client';

import { useEffect, useState, useCallback } from 'react';
import { createNode, fetchNodes, NodeItem } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';

interface Props {
  graphId: string;
}

export function NodesPanel({ graphId }: Props) {
  const [items, setItems] = useState<NodeItem[]>([]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>('');
  const canEdit = isLoggedIn();

  const load = useCallback(async () => {
    const nodes = await fetchNodes(graphId);
    setItems(nodes);
  }, [graphId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!canEdit || !label.trim()) return;
    setStatus('saving…');
    try {
      await createNode(graphId, { label, note });
      setLabel('');
      setNote('');
      setStatus('saved');
      await load();
    } catch (e) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section style={{ minWidth: 300 }}>
      <h2>Nodes ({items.length})</h2>

      {canEdit ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
          <button onClick={add} disabled={!label.trim()}>
            Add
          </button>
          <div className="muted">{status}</div>
        </div>
      ) : (
        <p className="muted">Log in to edit.</p>
      )}

      <ul style={{ display: 'grid', gap: 6, maxHeight: '60vh', overflow: 'auto' }}>
        {items.map((n) => (
          <li key={n.id}>
            <b>{n.label}</b> {n.note ? <span className="muted">— {n.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}