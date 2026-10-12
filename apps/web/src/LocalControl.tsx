import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import { api } from './api';
export function LocalControl({ onOpen }: { onOpen: () => void }) {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<{ waiting: number }>('/local/status')
        .then((state) => {
          if (alive) setWaiting(state.waiting);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <button
      className="icon-button update-control"
      aria-label={waiting ? '本地任務：等待確認' : '本地任務'}
      title="本地任務"
      onClick={onOpen}
    >
      <Terminal size={18} />
      {waiting > 0 && <span className="update-dot" />}
    </button>
  );
}
