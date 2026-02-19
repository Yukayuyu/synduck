'use client';

import { useEffect } from 'react';
import { clearTokens, getLogoutUrl } from '@/lib/auth';

export default function LogoutPage() {
  useEffect(() => {
    clearTokens();
    const url = getLogoutUrl();
    window.location.href = url || '/';
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>Signing out…</h1>
    </main>
  );
}
