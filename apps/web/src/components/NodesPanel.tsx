'use client';

import { useEffect, useState } from 'react';
import { createNode, fetchNodes, NodeItem } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';

export function NodesPanel() {
  const [items, setItems] = useState<NodeItem[]>([]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>('');
  const [canEdit, setCanEdit] = useState(false);

  const load = async () => {
    const nodes = await fetchNodes();
    setItems(nodes);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanEdit(isLoggedIn());
    void load();
  }, []);

  const add = async () => {
    setStatus('saving…');
    try {
      await createNode({ label, note });
      setLabel('');
      setNote('');
      setStatus('saved');
      await load();
    } catch (e) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section style={{ maxWidth: 720, width: '100%' }}>
      <h2>Nodes</h2>

      {canEdit ? (
        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
          <button onClick={() => void add()} disabled={!label.trim()}>
            Add
          </button>
          <div style={{ color: '#888' }}>{status}</div>
        </div>
      ) : (
        <p style={{ color: '#888' }}>Login to add nodes.</p>
      )}

      <ul style={{ display: 'grid', gap: 6 }}>
        {items.map((n) => (
          <li key={n.id}>
            <b>{n.label}</b> {n.note ? <span style={{ color: '#666' }}>— {n.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
