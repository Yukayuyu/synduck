import { useRef, useState } from 'react';
import { X, FilePlus2, LoaderCircle } from 'lucide-react';
import type { CanvasNode } from '@acc/domain';
import { useApi } from './api';
export function ReferenceDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (node: CanvasNode) => Promise<void>;
}) {
  const api = useApi();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  return (
    <div className="modal-backdrop" onClick={() => !working && onClose()}>
      <form
        className="modal reference-dialog nokey"
        role="dialog"
        aria-modal="true"
        aria-label="匯入參考"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (working) return;
          setWorking(true);
          setError('');
          void (async () => {
            let encoded: string | undefined;
            if (file) {
              if (file.size > 5 * 1024 * 1024) throw new Error('單份文件上限 5 MiB。');
              encoded = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('讀取文件失敗。'));
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.readAsDataURL(file);
              });
            }
            const result = await api<{ node: CanvasNode }>('/references', {
              request_id: requestId.current,
              title: title.trim() || file?.name.slice(0, 160) || '文字參考',
              ...(file ? { file: { name: file.name, data: encoded } } : { text }),
            });
            await onImported(result.node);
          })()
            .catch((e) => setError(e instanceof Error ? e.message : '匯入失敗'))
            .finally(() => setWorking(false));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing && !working) onClose();
        }}
      >
        <button
          type="button"
          className="modal-close"
          disabled={working}
          aria-label="關閉匯入參考"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <h2>
          <FilePlus2 size={22} /> 匯入參考
        </h2>
        <label>
          參考名稱
          <input
            autoFocus
            value={title}
            maxLength={160}
            disabled={working}
            onChange={(e) => {
              setTitle(e.target.value);
              requestId.current = crypto.randomUUID();
            }}
            placeholder="例如：專案規格"
          />
        </label>
        <label>
          選擇文件
          <input
            type="file"
            accept=".txt,.md,.markdown,.pdf,.docx"
            disabled={working}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              requestId.current = crypto.randomUUID();
            }}
          />
        </label>
        {file ? (
          <p>
            {file.name} · {(file.size / 1024).toFixed(1)} KiB{' '}
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setFile(null);
                requestId.current = crypto.randomUUID();
              }}
            >
              改用貼上文字
            </button>
          </p>
        ) : (
          <label>
            貼上文字
            <textarea
              aria-label="參考文字"
              value={text}
              maxLength={1024 * 1024}
              disabled={working}
              onChange={(e) => {
                setText(e.target.value);
                requestId.current = crypto.randomUUID();
              }}
              rows={8}
            />
          </label>
        )}
        <p className="quiet-note">
          TXT／Markdown 使用 UTF-8；PDF／DOCX 擷取文字，不含原始版面、圖片或 OCR。單檔 5
          MiB，擷取文字 1 MiB。匯入後自行選擇加入對話。
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={working} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={working || (!file && !text.trim())}>
            {working ? (
              <>
                <LoaderCircle size={15} className="spin" /> 正在匯入
              </>
            ) : (
              '匯入畫布'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
