import GraphView from '@/components/GraphView';
import { NodesPanel } from '@/components/NodesPanel';
import { EdgesPanel } from '@/components/EdgesPanel';
import { Suspense } from 'react';

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: graphId } = await params;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24, width: 300, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
        <NodesPanel graphId={graphId} />
        <EdgesPanel graphId={graphId} />
      </div>
      <div style={{ flex: 1 }}>
        <Suspense fallback={<div>Loading...</div>}>
          <GraphView graphId={graphId} />
        </Suspense>
      </div>
    </div>
  );
}