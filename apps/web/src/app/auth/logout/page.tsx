'use client';

import { useEffect } from 'react';
import { config } from '@/lib/config';

export default function LogoutPage() {
  useEffect(() => {
    const run = async () => {
      await fetch('/api/auth/logout', { method: 'POST' });

      // Also hit Cognito logout (best-effort)
      const domain = config.cognitoDomain?.replace(/\/$/, '');
      const clientId = config.cognitoClientId;
      const logoutUri = 'http://localhost:3000/';

      if (domain && clientId) {
        window.location.href = `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(
          logoutUri,
        )}`;
      } else {
        window.location.href = '/';
      }
    };
    void run();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing out…</h1>
    </main>
  );
}
