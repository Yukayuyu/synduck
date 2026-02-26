'use client';

import { useEffect, useMemo, useState } from 'react';
import { clearTokens, getLoginUrl, getLogoutUrl, isLoggedIn } from '@/lib/auth';

export function LoginControls() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  const loginUrl = useMemo(() => getLoginUrl(), []);
  const logoutUrl = useMemo(() => getLogoutUrl(), []);

  if (loggedIn) {
    return (
      <div className="row">
        <a
          className="btn"
          href={logoutUrl || '/auth/logout'}
          onClick={() => {
            clearTokens();
          }}
        >
          Logout
        </a>
      </div>
    );
  }

  return (
    <div className="row">
      <a className="btn" href={loginUrl || '#'} onClick={(e) => { if (!loginUrl) e.preventDefault(); }}>
        Login
      </a>
      {!loginUrl ? <span className="muted">(Missing Cognito env)</span> : null}
    </div>
  );
}
