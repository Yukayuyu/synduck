'use client';

import { useEffect } from 'react';
import { clearAccessToken, getLogoutUrl } from '@/lib/auth';

export default function LogoutPage() {
  useEffect(() => {
    clearAccessToken();
    window.location.href = getLogoutUrl();
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing out…</h1>
    </main>
  );
}
