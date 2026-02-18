'use client';

import { useEffect, useMemo, useState } from 'react';
import { clearAccessToken, getLoginUrl, getLogoutUrl, isLoggedIn } from '@/lib/auth';

export function LoginControls() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoggedIn(isLoggedIn());
  }, []);

  const loginUrl = useMemo(() => getLoginUrl(), []);
  const logoutUrl = useMemo(() => getLogoutUrl(), []);

  if (loggedIn) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <a
          href={logoutUrl || '/auth/logout'}
          onClick={() => {
            clearAccessToken();
          }}
        >
          Logout
        </a>
        {!logoutUrl ? <span style={{ color: '#888' }}>(Missing Cognito logout env)</span> : null}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <a href={loginUrl || '#'} onClick={(e) => { if (!loginUrl) e.preventDefault(); }}>
        Login
      </a>
      {!loginUrl ? <span style={{ color: '#888' }}>(Missing Cognito env)</span> : null}
    </div>
  );
}
