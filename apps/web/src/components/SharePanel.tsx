'use client';

import { useState } from 'react';
import { generateShareToken, revokeShareToken } from '@/lib/api';

interface Props {
  graphId: string;
}

export default function SharePanel({ graphId }: Props) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const generate = async () => {
    try {
      const token = await generateShareToken(graphId);
      setShareToken(token);
      const link = `${window.location.origin}/g/${graphId}?token=${token}`;
      navigator.clipboard.writeText(link);
      setStatus(`Generated & copied: ${link.slice(-50)}`);
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  };

  const revoke = async () => {
    try {
      await revokeShareToken(graphId);
      setShareToken(null);
      setStatus('Revoked');
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  };

  return (
    <section>
      <h3>Share (Viewer Link)</h3>
      {shareToken ? (
        <div>
          <div
            style={{
              background: 'var(--panel)',
              padding: 'var(--spacing-sm)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--spacing-md)',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              wordBreak: 'break-all',
            }}
          >
            {window.location.origin}/g/{graphId}?token={shareToken}
          </div>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <button className="btn secondary" onClick={generate}>
              🔄 New Link
            </button>
            <button className="btn danger" onClick={revoke}>
              🗑️ Revoke
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" style={{ width: '100%' }} onClick={generate}>
          🔗 Generate Viewer Link
        </button>
      )}
      {status && (
        <div className="muted" style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.875rem' }}>
          {status}
        </div>
      )}
    </section>
  );
}
