'use client';

import { useEffect, useState, useCallback } from 'react';
import { createNode, fetchNodes, type NodeItem } from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownViewer } from './MarkdownViewer';

interface Props {
  graphId: string;
  shareToken?: string;
  canEdit: boolean;
}

function NodesPanel({ graphId, shareToken, canEdit }: Props) {
  const [items, setItems] = useState<NodeItem[]>([]);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>('');

  const load = useCallback(async () => {
    const nodes = await fetchNodes(graphId, shareToken);
    setItems(nodes);
  }, [graphId, shareToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!canEdit || !label.trim()) return;
    setStatus('saving...');
    try {
      await createNode(graphId, { label: label.trim(), note: note.trim() });
      setLabel('');
      setNote('');
      setStatus('saved');
      await load();
    } catch (e: unknown) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section style={{ minWidth: '100%' }}>
      <h2>
        <span>Nodes</span>{' '}
        <span className="muted" style={{ fontSize: '0.875rem', fontWeight: 'normal' }}>
          ({items.length})
        </span>
      </h2>
      {canEdit ? (
        <div
          style={{ display: 'grid', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}
        >
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: 'var(--spacing-xs)',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
              }}
            >
              Node label
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Enter node label"
              autoFocus
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: 'var(--spacing-xs)',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
              }}
            >
              Note (optional)
            </label>
            <MarkdownEditor value={note} onChange={setNote} placeholder="Markdown note..." />
          </div>
          <button className="btn" onClick={add} disabled={!label.trim()}>
            + Add Node
          </button>
          {status && (
            <div className="muted" style={{ fontSize: '0.75rem' }}>
              {status}
            </div>
          )}
        </div>
      ) : (
        <div
          className="muted"
          style={{ padding: 'var(--spacing-lg)', textAlign: 'center', fontStyle: 'italic' }}
        >
          Read-only view
        </div>
      )}
      <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
        <ul style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          {items.map((n) => (
            <li key={n.id}>
              <div style={{ fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>{n.label}</div>
              {n.note ? (
                <div className="muted" style={{ fontSize: '0.875rem' }}>
                  <MarkdownViewer text={n.note} />
                </div>
              ) : null}
            </li>
          ))}
          {items.length === 0 && (
            <li
              style={{
                padding: 'var(--spacing-md)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <div style={{ fontSize: '1rem', marginBottom: 'var(--spacing-sm)' }}>
                No nodes yet
              </div>
              <div className="muted">
                Double-click the canvas to add your first node
                <br />
                or use the form above.
              </div>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

export default NodesPanel;
