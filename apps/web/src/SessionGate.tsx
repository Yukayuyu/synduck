import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Network } from 'lucide-react';
import { api } from './api';

export function SessionGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(() => {
    void api<{ authenticated: boolean }>('/session')
      .then((s) => {
        setAuthenticated(s.authenticated);
        setError('');
      })
      .catch(() => setError('無法連接後端，請確認電腦或伺服器仍在運作。'));
  }, []);
  useEffect(() => {
    check();
    const expired = () => setAuthenticated(false);
    window.addEventListener('canvas-session-expired', expired);
    return () => window.removeEventListener('canvas-session-expired', expired);
  }, [check]);
  if (authenticated) return children;
  return (
    <main className="loading-screen session-screen">
      <Network size={32} />
      <h1>Context Canvas</h1>
      {authenticated === false ? (
        <form
          className="modal"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void api('/session/login', { password })
              .then(() => {
                setPassword('');
                setAuthenticated(true);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <h2>登入你的工作區</h2>
          <p className="project-description">
            輸入後端設定的工作區密碼。ChatGPT 帳號可在進入後連接。
          </p>
          <label htmlFor="workspace-password">工作區密碼</label>
          <input
            id="workspace-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={1024}
          />
          <button className="primary" disabled={busy} type="submit">
            {busy ? '登入中…' : '登入工作區'}
          </button>
        </form>
      ) : (
        <p>正在連接工作區…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {authenticated === null && error && (
        <button className="secondary" onClick={check}>
          重試連線
        </button>
      )}
    </main>
  );
}
