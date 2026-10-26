import { useEffect, useRef, useState } from 'react';
import { Download, X, Bell } from 'lucide-react';
import { useApi } from './api';
import type { UpdateState } from '../../../packages/local-runtime/src/updates';
const phases: Record<string, string> = {
  idle: '已是目前檢查到的版本',
  checking: '正在檢查新版…',
  available: '有新版可用',
  downloading: '正在下載並校驗…',
  ready: '新版已準備好',
  installing: '準備新版並重新啟動…',
  error: '更新檢查或下載失敗',
};
const markerKey = 'canvas-update-from';
const marker = () => {
  try {
    return sessionStorage.getItem(markerKey);
  } catch {
    return null;
  }
};
const saveMarker = (version: string | null) => {
  try {
    if (version) sessionStorage.setItem(markerKey, version);
    else sessionStorage.removeItem(markerKey);
  } catch {
    /* The component state still supports this tab. */
  }
};
export function UpdateControl({ canInstall }: { canInstall: boolean }) {
  const api = useApi();

  const [state, setState] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(() => !!marker());
  const current = useRef('');
  const notified = useRef('');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await api<UpdateState>('/updates');
        if (!alive) return;
        if (!current.current) current.current = next.current_version;
        const from = marker() || current.current;
        if (installing && next.current_version !== from) {
          saveMarker(null);
          window.location.reload();
          return;
        }
        if (installing && next.phase === 'ready') {
          saveMarker(null);
          setInstalling(false);
          if (!next.error) setError('更新尚未完成，目前仍使用原版，可重新安裝。');
        }
        setState(next);
        const version = next.latest?.version || next.staged_version;
        if (
          version &&
          notified.current !== version &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          notified.current = version;
          new Notification('Context Canvas 有新版', {
            body: `版本 ${version} 可在「版本與更新」安裝。`,
            tag: 'canvas-update',
          });
        }
      } catch {
        /* Keep drafts and focus while the backend restarts. */
      }
    };
    void load();
    const timer = setInterval(() => void load(), open || installing ? 2000 : 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, installing]);
  const action = async (path: string, body: unknown = {}) => {
    setWorking(true);
    setError('');
    try {
      const next = await api<UpdateState>(`/updates/${path}`, body);
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新操作失敗');
    } finally {
      setWorking(false);
    }
  };
  const available = !!state?.staged_version || !!state?.latest;
  return (
    <>
      <button
        className={`icon-button update-control ${available ? 'has-update' : ''}`}
        aria-label={available ? '版本與更新：有新版' : '版本與更新'}
        title="版本與更新"
        onClick={() => setOpen(true)}
      >
        <Download size={18} />
        {available && <span className="update-dot" />}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <section
            className="modal update-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="關閉更新設定"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
            <span className="overline">APP UPDATES</span>
            <h2 id="update-title">版本與更新</h2>
            <p>
              目前版本 {state?.current_version || '…'}
              {state?.previous_version && ` · 前一版本 ${state.previous_version}`}
            </p>
            <p role="status">
              {installing
                ? '新版正在準備。啟動成功後，此頁會重新載入。'
                : state
                  ? phases[state.phase]
                  : '讀取版本資訊…'}
            </p>
            {state?.checked_at && (
              <small>上次檢查 {new Date(state.checked_at).toLocaleString()}</small>
            )}
            {(error || state?.error) && (
              <p role="alert" className="project-error">
                {error || state?.error}
              </p>
            )}
            <label>
              更新頻道
              <select
                aria-label="更新頻道"
                value={state?.channel || 'preview'}
                disabled={working || installing}
                onChange={(e) =>
                  void action('configure', {
                    channel: e.target.value,
                    auto_download: state?.auto_download ?? true,
                  })
                }
              >
                <option value="preview">測試版與正式版</option>
                <option value="stable">只接收正式版</option>
              </select>
            </label>
            <label className="runtime-check">
              <input
                type="checkbox"
                checked={state?.auto_download ?? true}
                disabled={working || installing}
                onChange={(e) =>
                  void action('configure', {
                    channel: state?.channel || 'preview',
                    auto_download: e.target.checked,
                  })
                }
              />
              自動下載新版，手動選擇安裝時間
            </label>
            <p className="project-description">
              啟動器每 15 分鐘檢查發佈版本。通知不會重載頁面或移動輸入焦點。
            </p>
            <div className="runtime-buttons">
              <button disabled={working || installing} onClick={() => void action('check')}>
                立即檢查更新
              </button>
              {'Notification' in window && (
                <button
                  onClick={() =>
                    void Notification.requestPermission().catch(() =>
                      setError('這個瀏覽器不支援系統通知。'),
                    )
                  }
                >
                  <Bell size={14} />
                  開啟瀏覽器通知
                </button>
              )}
            </div>
            {available && (
              <div className="update-release">
                <strong>新版 {state?.staged_version || state?.latest?.version}</strong>
                <p>{state?.latest?.notes}</p>
                {state?.phase === 'available' && (
                  <button disabled={working} onClick={() => void action('download')}>
                    下載新版
                  </button>
                )}
              </div>
            )}
            {!state?.managed && (
              <p className="project-description">
                自動安裝需要 Windows 啟動器。原始碼啟動可檢查版本與準備更新包。
              </p>
            )}
            <label className="update-import">
              匯入本機更新 ZIP
              <input
                type="file"
                accept=".zip"
                aria-label="匯入本機更新包"
                disabled={working || installing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  e.target.value = '';
                  if (file.size > 32 * 1024 * 1024) {
                    setError('更新包上限 32 MiB。');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    void action('import', { archive: String(reader.result).split(',')[1] });
                  reader.onerror = () => setError('更新包讀取失敗。');
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {state?.phase === 'ready' && (
              <>
                <button
                  className="primary"
                  disabled={working || installing || !canInstall || !state.managed}
                  onClick={() => {
                    setWorking(true);
                    setError('');
                    void api('/updates/apply', {})
                      .then(() => {
                        saveMarker(state.current_version);
                        setInstalling(true);
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setWorking(false));
                  }}
                >
                  安裝新版並重新啟動
                </button>
                {!canInstall && (
                  <p className="project-description">
                    請先送出或清空畫布草稿，並完成回答後再更新。
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
