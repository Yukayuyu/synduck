'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useMemo } from 'react';
import { fetchGraph, GraphDetail, fetchNodes, NodeItem, fetchEdges, EdgeItem, updateNode, fetchGraphs, GraphItem } from '@/lib/api';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { MarkdownViewer } from '@/components/MarkdownViewer';

function NotesPageInner() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token') || undefined;
  const graphId = searchParams.get('id') || '';
  const [graph, setGraph] = useState<GraphDetail | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [edges, setEdges] = useState<EdgeItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string>('');
  const [myGraphs, setMyGraphs] = useState<GraphItem[]>([]);
  const [publicGraphs, setPublicGraphs] = useState<GraphItem[]>([]);
  const [selectorLoading, setSelectorLoading] = useState(false);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  useEffect(() => {
    if (graphId) return;
    const loadGraphSelector = async () => {
      setSelectorLoading(true);
      try {
        const [my, pub] = await Promise.all([fetchGraphs('my'), fetchGraphs('public')]);
        setMyGraphs(my);
        setPublicGraphs(pub);
      } catch (e) {
        console.error('Selector load error:', e);
      } finally {
        setSelectorLoading(false);
      }
    };
    void loadGraphSelector();
  }, [graphId]);

  useEffect(() => {
    const loadData = async () => {
      if (!graphId) {
        setStatus('idle');
        return;
      }
      setStatus('loading');
      setLoadError('');
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
        setLoadError(String(e));
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

  const canEdit = graph?.userRole === 'owner' || graph?.userRole === 'editor';

  useEffect(() => {
    if (!selectedNode) {
      setDraftLabel('');
      setDraftNote('');
      setSaveStatus('idle');
      return;
    }
    setDraftLabel(selectedNode.label || '');
    setDraftNote(selectedNode.note || '');
    setSaveStatus('idle');
    setSaveError('');
  }, [selectedNode?.id]);

  const onSave = async () => {
    if (!selectedNode || !canEdit) return;
    setSaveStatus('saving');
    setSaveError('');
    try {
      await updateNode(graphId, selectedNode.id, {
        label: draftLabel.trim() || selectedNode.label,
        note: draftNote,
      });
      setNodes((prev) =>
        prev.map((n) =>
          n.id === selectedNode.id ? { ...n, label: draftLabel.trim() || n.label, note: draftNote } : n,
        ),
      );
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
      setSaveError(String(e));
    }
  };

  if (!graphId) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
        <h1 style={{ marginBottom: 'var(--spacing-sm)' }}>Select a graph for Notes</h1>
        <div className="muted" style={{ marginBottom: 'var(--spacing-lg)' }}>
          Open a graph to use the Obsidian-like notes workspace.
        </div>
        {selectorLoading ? <div className="muted">Loading graph list...</div> : null}
        <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
          <section>
            <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>My Graphs</h3>
            {myGraphs.length === 0 ? (
              <div className="muted">No private graphs found.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--spacing-sm)' }}>
                {myGraphs.map((g) => (
                  <li key={g.id}>
                    <a className="btn secondary" href={`/notes?id=${encodeURIComponent(g.id)}`}>{g.name}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>Public Graphs</h3>
            {publicGraphs.length === 0 ? (
              <div className="muted">No public graphs found.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--spacing-sm)' }}>
                {publicGraphs.slice(0, 20).map((g) => (
                  <li key={g.id}>
                    <a className="btn secondary" href={`/notes?id=${encodeURIComponent(g.id)}`}>{g.name}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    );
  }

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
        <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-sm)' }}>
          {loadError === 'missing_graph_id' ? 'Graph ID is missing' : 'Notes not found'}
        </div>
        <div className="muted" style={{ marginBottom: 'var(--spacing-sm)' }}>
          {loadError === 'missing_graph_id'
            ? 'Open from graph list or append ?id=<graphId> to URL.'
            : 'Check the URL or your permissions.'}
        </div>
        {loadError && loadError !== 'missing_graph_id' ? (
          <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--spacing-sm)' }}>
            {loadError}
          </div>
        ) : null}
        <a href="/graphs" className="btn secondary">
          Back to graphs
        </a>
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

      {/* Center: editor */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-xl)' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--spacing-md)',
            marginBottom: 'var(--spacing-md)',
          }}
        >
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            disabled={!selectedNode || !canEdit}
            placeholder="Note title"
            style={{ flex: 1, fontSize: '1.1rem', fontWeight: 600 }}
          />
          <button className="btn" onClick={() => void onSave()} disabled={!selectedNode || !canEdit || saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving...' : 'Save'}
          </button>
        </div>
        <div className="muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--spacing-sm)' }}>
          {canEdit
            ? saveStatus === 'saved'
              ? 'Saved'
              : saveStatus === 'error'
                ? `Save failed: ${saveError}`
                : 'Explicit save mode'
            : 'Read-only (viewer role)'}
        </div>
        {selectedNode ? (
          <MarkdownEditor value={draftNote} onChange={setDraftNote} />
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
              <MarkdownViewer text={draftNote || ''} />
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
