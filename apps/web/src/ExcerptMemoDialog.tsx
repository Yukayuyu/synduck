import { useState } from 'react';
import { Check, X } from 'lucide-react';

export function ExcerptMemoDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(text);
    } catch (error) {
      setError(error instanceof Error ? error.message : '備註未保存，請重試。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="modal excerpt-memo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="摘錄備註"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'Escape' && !saving) onClose();
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="關閉備註"
          disabled={saving}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <label>
          備註
          <textarea
            autoFocus
            aria-label="備註內容"
            placeholder="先記下想法，稍後再延伸…"
            rows={7}
            maxLength={20000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={saving}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" aria-label="保存備註" disabled={saving}>
          <Check size={16} />
          {saving ? '保存中…' : '保存備註'}
        </button>
      </form>
    </div>
  );
}
