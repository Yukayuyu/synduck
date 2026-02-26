'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { fetchGraph, GraphDetail } from '@/lib/api';
import GraphView from '@/components/GraphView';
import NodesPanel from '@/components/NodesPanel';
import EdgesPanel from '@/components/EdgesPanel';
import PermissionsPanel from '@/components/PermissionsPanel';
import SharePanel from '@/components/SharePanel';

export default function GraphPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('token') || undefined;
  const graphId = params.id;
  const [graph, setGraph] = useState<GraphDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');

  useEffect(() => {
    fetchGraph(graphId, shareToken)
      .then(setGraph)
      .catch((e) => {
        console.error(e);
        setStatus('error');
      })
      .finally(() => setStatus('idle'));
  }, [graphId, shareToken]);

  if (status === 'loading') {
    return <div style={{ padding: '50vh 20px', textAlign: 'center' }}>Loading graph...</div>;
  }

  if (status === 'error' || !graph) {
    return <div style={{ padding: '50vh 20px', textAlign: 'center', color: 'var(--muted)' }}>Graph not found or no access.</div>;
  }

  const canEdit = graph.userRole === 'owner' || graph.userRole === 'editor';
  const isOwner = graph.userRole === 'owner';

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24, width: 300, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
        <NodesPanel graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        <EdgesPanel graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        {isOwner && <PermissionsPanel graphId={graphId} />}
        {isOwner && <SharePanel graphId={graphId} />}
      </div>
      <div style={{ flex: 1 }}>
        <Suspense fallback={<div>Loading graph...</div>}>
          <GraphView graphId={graphId} shareToken={shareToken} canEdit={canEdit} />
        </Suspense>
      </div>
    </div>
  );
}