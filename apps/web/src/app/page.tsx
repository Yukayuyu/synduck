import styles from './page.module.css';
import { cookies } from 'next/headers';
import { LoginControls } from './LoginControls';
import { NodesPanel } from '@/components/NodesPanel';
import { EdgesPanel } from '@/components/EdgesPanel';

async function getHealth() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return { ok: false, error: 'NEXT_PUBLIC_API_BASE_URL not set' };

  const res = await fetch(`${base.replace(/\/$/, '')}/health`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
}

export default async function Home() {
  const health = await getHealth();
  const c = await cookies();
  const loggedIn = c.has('synduck_id_token');

  return (
    <main className={styles.main}>
      <h1>synduck</h1>

      <section style={{ maxWidth: 720, width: '100%' }}>
        <h2>API health</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(health, null, 2)}</pre>
      </section>

      <NodesPanel canEdit={loggedIn} />

      <EdgesPanel canEdit={loggedIn} />

      <section style={{ maxWidth: 720, width: '100%' }}>
        <h2>Auth</h2>
        <p>loggedIn: {String(loggedIn)}</p>
        <LoginControls loggedIn={loggedIn} />
      </section>

      <NodesPanel canEdit={loggedIn} />

      <EdgesPanel canEdit={loggedIn} />

      <section style={{ maxWidth: 720, width: '100%' }}>
        <h2>Next</h2>
        <p>
          Next step: build a minimal graph editor (nodes + edges) with read-only access for anonymous users, and
          editing enabled after login.
        </p>
      </section>
    </main>
  );
}
