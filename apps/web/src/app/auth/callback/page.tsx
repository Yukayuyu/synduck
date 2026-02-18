'use client';

import { useEffect, useMemo, useState } from 'react';
import { exchangeCodeForToken, setAccessToken } from '@/lib/auth';
import { config } from '@/lib/config';

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [detail, setDetail] = useState<string>('');

  const debug = useMemo(() => {
    return {
      href: typeof window !== 'undefined' ? window.location.href : '',
      cognitoDomain: config.cognitoDomain || process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '',
      cognitoClientId: config.cognitoClientId || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
      redirectUri: config.cognitoRedirectUri || process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI || '',
      tokenUrl: (config.cognitoDomain || process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '').replace(/\/$/, '') + '/oauth2/token',
    };
  }, []);

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

      {status === 'error' ? (
        <>
          <h2>Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{detail}</pre>
          <h2>Debug</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(debug, null, 2)}</pre>
          <p style={{ color: '#666' }}>
            If this says invalid_redirect, the redirectUri here must exactly match one of the Cognito app client
            callback URLs.
          </p>
        </>
      ) : null}
    </main>
  );
}
