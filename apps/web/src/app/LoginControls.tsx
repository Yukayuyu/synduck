'use client';

import { config } from '@/lib/config';

export function LoginControls({ loggedIn }: { loggedIn: boolean }) {
  const domain = config.cognitoDomain?.replace(/\/$/, '');
  const clientId = config.cognitoClientId;
  const redirectUri = config.cognitoRedirectUri;

  const loginUrl = domain && clientId && redirectUri
    ? `${domain}/login?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`
    : '';

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {loggedIn ? (
        <a href="/auth/logout">Logout</a>
      ) : (
        <a href={loginUrl || '#'} onClick={(e) => { if (!loginUrl) e.preventDefault(); }}>
          Login
        </a>
      )}
      {!loginUrl ? (
        <span style={{ color: '#888' }}>
          (Missing Cognito env vars. Copy apps/web/.env.example to .env.local)
        </span>
      ) : null}
    </div>
  );
}
