import { useEffect, useState } from 'react';
import { ArrowUp, Check, Folder, HardDrive, History, Home, LoaderCircle } from 'lucide-react';
import { useApi } from './api';

type Listing = {
  path: string;
  parent: string | null;
  home: string;
  roots: string[];
  recent: string[];
  readable: boolean;
  folders: { name: string; path: string }[];
};
const leaf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;

// Choose a folder on the backend computer by browsing; nothing has to be typed.
export function FolderPicker({
  start,
  busy,
  onPick,
}: {
  start: string;
  busy: boolean;
  onPick: (path: string) => void;
}) {
  const api = useApi();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const go = (path?: string) => {
    setLoading(true);
    setError('');
    return api<Listing>('/local/folders' + (path ? '?path=' + encodeURIComponent(path) : ''))
      .then(setListing)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '無法讀取資料夾');
        // A saved project that no longer exists falls back to the home folder.
        if (path && !listing) return api<Listing>('/local/folders').then(setListing);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void go(start || undefined);
  }, []);
  return (
    <div className="folder-picker" role="group" aria-label="選擇專案資料夾">
      <div className="folder-picker-bar">
        <button
          type="button"
          className="icon-button"
          aria-label="上一層"
          title="上一層"
          disabled={!listing?.parent || loading}
          onClick={() => void go(listing!.parent!)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="個人資料夾"
          title="個人資料夾"
          disabled={loading}
          onClick={() => void go(listing?.home)}
        >
          <Home size={15} />
        </button>
        {listing?.roots.map((root) => (
          <button
            key={root}
            type="button"
            className="icon-button"
            aria-label={'磁碟 ' + root}
            title={root}
            disabled={loading}
            onClick={() => void go(root)}
          >
            <HardDrive size={15} />
            {listing.roots.length > 1 && <small>{root.slice(0, 2)}</small>}
          </button>
        ))}
        <code title={listing?.path}>{listing?.path ?? '…'}</code>
        {loading && <LoaderCircle className="spin" size={14} />}
      </div>
      {listing && listing.recent.length > 0 && (
        <div className="folder-picker-recent" aria-label="最近使用">
          <History size={13} />
          {listing.recent.map((path) => (
            <button
              key={path}
              type="button"
              title={path}
              disabled={busy}
              onClick={() => onPick(path)}
            >
              {leaf(path)}
            </button>
          ))}
        </div>
      )}
      <ul className="folder-picker-list">
        {listing?.folders.map((entry) => (
          <li key={entry.path}>
            <button type="button" disabled={loading} onClick={() => void go(entry.path)}>
              <Folder size={14} />
              {entry.name}
            </button>
          </li>
        ))}
        {listing && listing.folders.length === 0 && (
          <li className="folder-picker-empty">{listing.readable ? '沒有子資料夾' : '無法讀取'}</li>
        )}
      </ul>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="primary"
        disabled={!listing || busy || loading}
        onClick={() => onPick(listing!.path)}
      >
        <Check size={14} />
        使用「{listing ? leaf(listing.path) : '…'}」
      </button>
    </div>
  );
}
