'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { fetchSimilarGraphs } from '@/lib/api';

interface Props {
  graphId: string;
  shareToken?: string;
}

interface SimilarGraph {
  id: string;
  name: string;
  score: number;
}

export default function SimilarGraphsPanel({ graphId, shareToken }: Props) {
  const [similar, setSimilar] = useState<SimilarGraph[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const items = await fetchSimilarGraphs(graphId, shareToken);
      setSimilar(items);
      setStatus('idle');
    } catch (e: unknown) {
      setErrorMsg(String(e));
      setStatus('error');
    }
  }, [graphId, shareToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ minWidth: '100%' }}>
      <h2>
        Similar Graphs{' '}
        <span className="muted" style={{ fontSize: '0.875rem', fontWeight: 'normal' }}>
          ({similar.length})
        </span>
      </h2>
      <div style={{ maxHeight: '30vh', overflow: 'auto' }}>
        {status === 'loading' ? (
          <div className="muted" style={{ padding: 'var(--spacing-lg)', textAlign: 'center' }}>
            Loading similar graphs...
          </div>
        ) : status === 'error' ? (
          <div className="muted" style={{ padding: 'var(--spacing-lg)', textAlign: 'center' }}>
            Failed to load similar graphs: {errorMsg}
          </div>
        ) : similar.length === 0 ? (
          <div
            className="muted"
            style={{ padding: 'var(--spacing-lg)', textAlign: 'center', fontStyle: 'italic' }}
          >
            No similar public graphs found for this graph.
          </div>
        ) : (
          <ul style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
            {similar.map((sg) => (
              <li key={sg.id}>
                <Link
                  href={`/g?id=${encodeURIComponent(sg.id)}`}
                  className="btn secondary"
                  style={{ width: '100%', justifyContent: 'flex-start', fontWeight: 'normal' }}
                >
                  {sg.name}
                </Link>
                <div
                  className="muted"
                  style={{ fontSize: '0.875rem', marginTop: 'var(--spacing-xs)' }}
                >
                  Similarity: <strong>{(sg.score * 100).toFixed(1)}%</strong>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        className="btn secondary"
        style={{ width: '100%', marginTop: 'var(--spacing-sm)' }}
        onClick={load}
      >
        🔄 Refresh
      </button>
    </section>
  );
}
