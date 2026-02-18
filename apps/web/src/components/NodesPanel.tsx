'use client';

import { useEffect, useState } from 'react';

type NodeItem = { id: string; label: string; note?: string; createdAt?: string };

type NodesResp = { ok?: boolean; items?: NodeItem[]; error?: string };

export function NodesPanel({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<NodeItem[]>([]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>('');

  const load = async () => {
    const res = await fetch('/api/nodes', { cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as NodesResp;
    setItems(json.items || []);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const add = async () => {
    setStatus('saving…');
    const res = await fetch('/api/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, note }),
    });
    const json = (await res.json().catch(() => ({}))) as NodesResp;
    if (!res.ok) {
      setStatus(`error: ${json.error || res.status}`);
      return;
    }
    setLabel('');
    setNote('');
    setStatus('saved');
    await load();
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
