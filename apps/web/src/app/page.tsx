import styles from './page.module.css';
import { LoginControls } from './LoginControls';
import { NodesPanel } from '@/components/NodesPanel';
import { EdgesPanel } from '@/components/EdgesPanel';
import { GraphView } from '@/components/GraphView';

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 style={{ margin: 0 }}>synduck</h1>
        <LoginControls />
      </header>

      <GraphView />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, width: '100%' }}>
        <NodesPanel />
        <EdgesPanel />
      </div>

      <section>
        <h2 style={{ marginTop: 0 }}>Notes</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Anonymous users can view. Logged-in users can edit.
        </p>
      </section>
    </main>
  );
}
