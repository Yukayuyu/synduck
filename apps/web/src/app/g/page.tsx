'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { fetchGraph, GraphDetail } from '@/lib/api';
import GraphView from '@/components/GraphView';
import NodesPanel from '@/components/NodesPanel';
import EdgesPanel from '@/components/EdgesPanel';
import PermissionsPanel from '@/components/PermissionsPanel';
import SharePanel from '@/components/SharePanel';
import SimilarGraphsPanel from '@/components/SimilarGraphsPanel';

function GraphPageInner() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token') || undefined;
  const graphId = searchParams.get('id') || '';
  const [graph, setGraph] = useState<GraphDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');

  useEffect(() => {
    if (!graphId) {
      setStatus('error');
      return;
    }
    fetchGraph(graphId, shareToken)
      .then(setGraph)
      .catch((e) => {
        console.error(e);
        setStatus('error');
      })
      .finally(() => setStatus('idle'));
  }, [graphId, shareToken]);

  if (status === 'loading') {
    return (
      <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-sm)' }}>Loading graph...</div>
        <div className="muted">Please wait while we fetch nodes and edges.</div>
      </div>
    );
  }

  if (status === 'error' || !graph) {
    return (
      <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-sm)' }}>Graph not found</div>
        <div className="muted">
          Check the URL or your permissions.{' '}
          <a href="/graphs" className="btn secondary">
            Back to graphs
          </a>
        </div>
      </div>
    );
  }

  const canEdit = graph.userRole === 'owner' || graph.userRole === 'editor';
  const isOwner = graph.userRole === 'owner';

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-lg)',
          padding: 'var(--spacing-xl)',
          width: 320,
          minWidth: 320,
          borderRight: '1px solid var(--border-light)',
          overflow: 'auto',
          background: 'var(--panel)',
        }}
      >
        <NodesPanel graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        <EdgesPanel graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        <SimilarGraphsPanel graphId={graphId} shareToken={shareToken} />
        {isOwner && <PermissionsPanel graphId={graphId} />}
        {isOwner && <SharePanel graphId={graphId} />}
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <Suspense
          fallback={
            <div
              style={{
                padding: 'var(--spacing-xl)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              Loading graph view...
            </div>
          }
        >
          <GraphView graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        </Suspense>
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading...
        </div>
      }
    >
      <GraphPageInner />
    </Suspense>
  );
}
