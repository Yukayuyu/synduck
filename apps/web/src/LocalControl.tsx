import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import { useApi } from './api';
export function LocalControl({ onOpen }: { onOpen: () => void }) {
  const api = useApi();

  const [waiting, setWaiting] = useState(0);
  const [ready, setReady] = useState<{ available: boolean; enabled: boolean } | null>(null);
  const [otherBusy, setOtherBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<{
        available: boolean;
        enabled: boolean;
        waiting: number;
        other_canvas_busy?: boolean;
      }>('/local/status')
        .then((state) => {
          if (alive) {
            setWaiting(state.waiting);
            setReady({ available: state.available, enabled: state.enabled });
          }
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
      className="icon-button update-control local-control"
      aria-label={waiting ? '本地任務：等待確認' : '本地任務'}
      title={
        otherBusy
          ? '其他画布有本地任务正在进行'
          : ready?.available === false
            ? '这台电脑的本机工具尚未开启'
            : ready?.enabled
              ? '專案已連接，可直接在畫布提出開發需求'
              : '在畫布問題中提供專案目錄，確認授權即可連接'
      }
      onClick={onOpen}
    >
      <Terminal size={18} />
      {ready && (
        <span className="local-status-label">
          {!ready.available ? '本机工具未开启' : ready.enabled ? '專案已連接' : '待授權專案'}
        </span>
      )}
      {waiting > 0 && <span className="update-dot" />}
    </button>
  );
}
