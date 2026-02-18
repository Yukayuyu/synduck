import styles from './page.module.css';
import { LoginControls } from './LoginControls';
import { NodesPanel } from '@/components/NodesPanel';
import { EdgesPanel } from '@/components/EdgesPanel';
import { GraphView } from '@/components/GraphView';

export default function Home() {
  return (
    <main className={styles.main}>
      <h1>synduck</h1>

      <section style={{ maxWidth: 720, width: '100%' }}>
        <h2>Auth</h2>
        <LoginControls />
        <p style={{ color: '#888' }}>Anonymous users can view. Logged-in users can edit.</p>
      </section>

      <GraphView />

      <NodesPanel />
      <EdgesPanel />

      <section style={{ maxWidth: 720, width: '100%' }}>
        <h2>Next</h2>
        <p>Next step: render these nodes/edges as an actual graph (reactflow).</p>
      </section>
    </main>
  );
}
