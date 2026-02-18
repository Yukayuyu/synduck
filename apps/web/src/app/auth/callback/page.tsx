'use client';

import { useEffect, useState } from 'react';
import { exchangeCodeForToken, setAccessToken } from '@/lib/auth';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (!code) {
        setStatus('error');
        setDetail('missing_code');
        return;
      }

      try {
        const access = await exchangeCodeForToken(code);
        setAccessToken(access);
        setStatus('ok');
        window.history.replaceState({}, '', '/');
        window.location.href = '/';
      } catch (e) {
        setStatus('error');
        setDetail(String(e));
      }
    };

    void run();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing in…</h1>
      <p>Status: {status}</p>
      {status === 'error' ? <pre style={{ whiteSpace: 'pre-wrap' }}>{detail}</pre> : null}
    </main>
  );
}
