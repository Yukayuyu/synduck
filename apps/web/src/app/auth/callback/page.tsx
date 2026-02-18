'use client';

import { useEffect, useState } from 'react';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [detail, setDetail] = useState<unknown>(null);

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (!code) {
        setStatus('error');
        setDetail({ error: 'missing_code' });
        return;
      }

      const res = await fetch(`/api/auth/token?code=${encodeURIComponent(code)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('error');
        setDetail(json);
        return;
      }

      setStatus('ok');
      // Clean up URL and go home
      window.history.replaceState({}, '', '/');
      window.location.href = '/';
    };

    void run();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing in…</h1>
      {status === 'error' ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(detail, null, 2)}</pre>
      ) : null}
    </main>
  );
}
