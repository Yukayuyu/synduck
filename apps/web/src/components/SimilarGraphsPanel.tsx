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
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const items = await fetchSimilarGraphs(graphId, shareToken);
      setSimilar(items);
      setStatus('idle');
    } catch (e: unknown) {
      setError(String(e));
      setStatus('error');
    }
  }, [graphId, shareToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ minWidth: 300 }}>
      <h2>Similar graphs ({similar.length})</h2>
      {status === 'loading' ? (
        <div className="muted" style={{ padding: 12, textAlign: 'center' }}>Loading...</div>
      ) : status === 'error' ? (
        <div className="muted" style={{ padding: 12, textAlign: 'center' }}>Error: {error}</div>
      ) : similar.length === 0 ? (
        <div className="muted" style={{ padding: 12, textAlign: 'center' }}>No similar public graphs found.</div>
      ) : (
        <ul style={{ display: 'grid', gap: 6, maxHeight: '40vh', overflow: 'auto' }}>
          {similar.map((sg) => (
            <li key={sg.id} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 4 }}>
              <Link href={`/g/${sg.id}`} style={{ fontWeight: 500 }}>
                {sg.name}
              </Link>
              <div className="muted" style={{ fontSize: 13 }}>
                Similarity: {(sg.score * 100).toFixed(1)}%
              </div>
            </li>
          ))}
        </ul>
      )}
      <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={load}>
        Refresh
      </button>
    </section>
  );
}