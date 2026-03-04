'use client';

import { useSearchParams } from 'next/navigation';
import { updateNode } from '@/lib/api';
import { Suspense, useEffect, useState, useMemo } from 'react';
import { fetchGraph, GraphDetail, fetchNodes, NodeItem, fetchEdges, EdgeItem } from '@/lib/api';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { useCallback } from 'react';
import { MarkdownViewer } from '@/components/MarkdownViewer';

function NotesPageInner() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token') || undefined;
  const graphId = searchParams.get('id') || '';
  const [graph, setGraph] = useState<GraphDetail | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  useEffect(() => {
    const loadData = async () => {
      if (!graphId) {
        setStatus('error');
        return;
      }
      setStatus('loading');
      try {
        const graphData = await fetchGraph(graphId, shareToken);
        setGraph(graphData);
        const [ns, es] = await Promise.all([
          fetchNodes(graphId, shareToken),
          fetchEdges(graphId, shareToken),
        ]);
        setNodes(ns);
        setEdges(es);
        setStatus('idle');
        if (ns.length > 0) {
          setSelectedNodeId((prev) => prev ?? ns[0].id);
        }
      } catch (e) {
        console.error('Load error:', e);
        setStatus('error');
      }
    };
    void loadData();
  }, [graphId, shareToken]);

  const backlinks = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((e) => e.to === selectedNodeId)
      .map((e) => nodes.find((n) => n.id === e.from)?.label || e.from)
      .filter(Boolean);
  }, [edges, nodes, selectedNodeId]);

  if (status === 'loading') {
    return (
      <div
        style={{
          padding: '50vh 20px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-sm)' }}>
          Loading notes...
        </div>
        <div className="muted">Fetching graph and notes.</div>
      </div>
    );
  }

  if (status === 'error' || !graph) {
    return (
      <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-sm)' }}>Notes not found</div>
        <div className="muted">
          Check the URL or your permissions.{' '}
          <a href="/graphs" className="btn secondary">
            Back to graphs
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Left: Note list panel */}
      <div
        style={{
          width: 320,
          borderRight: '1px solid var(--border-light)',
          overflow: 'auto',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: 'var(--spacing-xl)',
            borderBottom: '1px solid var(--border-light)',
          }}
        >
          <h2 style={{ margin: 0 }}>
            Notes
            <span className="muted" style={{ fontSize: '0.875rem', fontWeight: 'normal' }}>
              ({nodes.length})
            </span>
          </h2>
          <div className="muted" style={{ fontSize: '0.75rem' }}>
            Graph: {graph.name}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {nodes.map((node) => (
              <li
                key={node.id}
                style={{
                  padding: 'var(--spacing-lg) var(--spacing-xl)',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  background: selectedNodeId === node.id ? 'var(--bg-hover)' : 'transparent',
                }}
                onClick={() => setSelectedNodeId(node.id)}
              >
                <div style={{ fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>
                  {node.label}
                </div>
                {node.note ? (
                  <div
                    className="muted"
                    style={{
                      fontSize: '0.875rem',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {node.note.slice(0, 100)}…
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    No content
                  </div>
                )}
              </li>
            ))}
            {nodes.length === 0 && (
              <li
                style={{
                  padding: 'var(--spacing-xl)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                }}
              >
                <div style={{ fontSize: '1rem', marginBottom: 'var(--spacing-sm)' }}>
                  No notes yet
                </div>
                <div className="muted">Create nodes in /g view first.</div>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Center: editor placeholder area */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-xl)' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--spacing-lg)',
          }}
        >
          <h2 style={{ margin: 0 }}>{selectedNode ? selectedNode.label : 'Select a note'}</h2>
          <div className="muted" style={{ fontSize: '0.875rem' }}>
            T3: Explicit save coming
          </div>
        </div>
        {selectedNode ? (
          <MarkdownEditor
            value={selectedNode.note || ''}
            onChange={() => {}} // placeholder, no save
          />
        ) : (
          <div
            className="muted"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontStyle: 'italic',
            }}
          >
            Select a note to edit
          </div>
        )}
      </div>

      {/* Right: preview/backlinks placeholder area */}
      <div
        style={{
          width: 350,
          minWidth: 350,
          borderLeft: '1px solid var(--border-light)',
          overflow: 'auto',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: 'var(--spacing-xl) var(--spacing-xl) 0' }}>
          <h3 style={{ margin: 0, paddingBottom: 'var(--spacing-sm)' }}>Preview</h3>
          {selectedNode ? (
            <div style={{ paddingBottom: 'var(--spacing-xl)' }}>
              <MarkdownViewer text={selectedNode.note || ''} />
            </div>
          ) : null}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              padding: '0 var(--spacing-xl) var(--spacing-xl)',
              borderTop: '1px solid var(--border-light)',
            }}
          >
            <h3 style={{ margin: 0, padding: 'var(--spacing-lg) 0 var(--spacing-md)' }}>
              Backlinks
            </h3>
            {backlinks.length > 0 ? (
              backlinks.map((label, i) => (
                <div
                  key={i}
                  className="muted"
                  style={{
                    fontSize: '0.875rem',
                    padding: 'var(--spacing-xs) var(--spacing-md)',
                    background: 'var(--bg-hover)',
                    marginBottom: 'var(--spacing-xs)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const node = nodes.find((n) => n.label === label);
                    if (node) setSelectedNodeId(node.id);
                  }}
                >
                  [[{label}]]
                </div>
              ))
            ) : (
              <div
                className="muted"
                style={{
                  padding: 'var(--spacing-xl)',
                  textAlign: 'center',
                  fontStyle: 'italic',
                }}
              >
                No backlinks yet
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NotesPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading...
        </div>
      }
    >
      <NotesPageInner />
    </Suspense>
  );
}
