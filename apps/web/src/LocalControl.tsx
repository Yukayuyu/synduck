import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import { useApi } from './api';
export function LocalControl({ onOpen }: { onOpen: () => void }) {
  const api = useApi();

  const [waiting, setWaiting] = useState(0);
  const [otherBusy, setOtherBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<{ waiting: number; other_canvas_busy?: boolean }>('/local/status')
        .then((state) => {
          if (alive) setWaiting(state.waiting);
          if (alive) setOtherBusy(!!state.other_canvas_busy);
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
      title={otherBusy ? '其他画布有本地任务正在进行' : '本地任務'}
      onClick={onOpen}
    >
      <Terminal size={18} />
      {waiting > 0 && <span className="update-dot" />}
    </button>
  );
}
