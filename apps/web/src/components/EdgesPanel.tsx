'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  createEdge,
  type EdgeItem,
  fetchEdges,
  fetchNodes,
  type NodeItem,
  updateEdge,
  EDGE_TYPES,
} from '@/lib/api';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownViewer } from './MarkdownViewer';

interface Props {
  graphId: string;
  shareToken?: string;
  canEdit: boolean;
}

function EdgesPanel({ graphId, shareToken, canEdit }: Props) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [annotation, setAnnotation] = useState('');
  const [edgeType, setEdgeType] = useState<string>('references');
  const [status, setStatus] = useState('');

  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.label);
    return m;
  }, [nodes]);

  const load = useCallback(async () => {
    const [ns, es] = await Promise.all([
      fetchNodes(graphId, shareToken),
      fetchEdges(graphId, shareToken),
    ]);
    setNodes(ns);
    setEdges(es);
  }, [graphId, shareToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEdge = async () => {
    if (!canEdit || !from || !to || from === to) return;
    setStatus('saving...');
    try {
      const existing = edges.find(
        (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
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
    } catch (e: unknown) {
      setStatus(`error: ${String(e)}`);
    }
  };

  return (
    <section style={{ minWidth: '100%' }}>
      <h2>
        <span>Edges</span>{' '}
        <span className="muted" style={{ fontSize: '0.875rem', fontWeight: 'normal' }}>
          ({edges.length})
        </span>
      </h2>
      {canEdit ? (
        <div
          style={{ display: 'grid', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}
        >
          <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
            <label
              style={{
                display: 'block',
                marginBottom: 'var(--spacing-xs)',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
              }}
            >
              From → To
            </label>
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Select from node</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select to node</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
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
              Type
            </label>
            <select value={edgeType} onChange={(e) => setEdgeType(e.target.value)}>
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ').toUpperCase()}
                </option>
              ))}
            </select>
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
              Label (optional)
            </label>
            <input
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              placeholder="e.g. 'v1.2'"
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
          <button className="btn" onClick={saveEdge} disabled={!from || !to || from === to}>
            {edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))
              ? 'Update'
              : 'Create'}{' '}
            Edge
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
          {edges.map((e) => (
            <li key={e.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-sm)',
                  fontWeight: 500,
                }}
              >
                <span>{labelById.get(e.from!) || e.from}</span>
                <span style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>
                  → [{e.type?.replace('_', ' ').toUpperCase() || '?'}]
                </span>
                <span>{labelById.get(e.to!) || e.to}</span>
              </div>
              {e.annotation && (
                <div
                  className="muted"
                  style={{ fontSize: '0.875rem', marginTop: 'var(--spacing-xs)' }}
                >
                  Label: {e.annotation}
                </div>
              )}
              {e.note ? (
                <div
                  className="muted"
                  style={{ fontSize: '0.875rem', marginTop: 'var(--spacing-xs)' }}
                >
                  <MarkdownViewer text={e.note} />
                </div>
              ) : null}
            </li>
          ))}
          {edges.length === 0 && (
            <li
              style={{
                padding: 'var(--spacing-md)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <div style={{ fontSize: '1rem', marginBottom: 'var(--spacing-sm)' }}>
                No edges yet
              </div>
              <div className="muted">
                Click nodes to connect them
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

export default EdgesPanel;
