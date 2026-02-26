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
      <h3>Share Link (Viewer access)</h3>
      {shareToken ? (
        <div>
          <div className="muted" style={{ wordBreak: 'break-all', marginBottom: 8 }}>
            /g/{graphId}?token={shareToken.slice(-8)}
          </div>
          <button className="btn" onClick={generate}>Regenerate</button>
          <button className="btn" style={{ background: 'var(--danger)' }} onClick={revoke}>Revoke</button>
        </div>
      ) : (
        <button className="btn" onClick={generate}>Generate share token</button>
      )}
      {status && <div className="muted" style={{ marginTop: 8 }}>{status}</div>}
    </section>
  );
}