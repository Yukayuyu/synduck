import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { NOTE_COLORS } from '@acc/domain';

type Color = (typeof NOTE_COLORS)[number];
const colorNames: Record<Color, string> = {
  plain: '無色',
  yellow: '黃',
  green: '綠',
  blue: '藍',
  pink: '粉',
  purple: '紫',
};

// Jot a clue without asking anything. Enter saves; Shift+Enter adds a line.
export function NoteDialog({
  initial,
  editing,
  onSave,
  onClose,
}: {
  initial?: { text: string; color: Color };
  editing: boolean;
  onSave: (text: string, color: Color) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? '');
  const [color, setColor] = useState<Color>(initial?.color ?? 'yellow');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(text.trim(), color);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className={`modal note-dialog note-${color}`}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? '編輯筆記' : '新增筆記'}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) onClose();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <button type="button" className="modal-close" aria-label="關閉" onClick={onClose}>
          <X size={18} />
        </button>
        <textarea
          autoFocus
          aria-label="筆記內容"
          placeholder="記下一條線索…"
          value={text}
          maxLength={20000}
          rows={5}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229 &&
              !window.matchMedia('(pointer: coarse)').matches
            ) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <div className="note-colors" role="radiogroup" aria-label="顏色">
          {NOTE_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={color === name}
              aria-label={colorNames[name]}
              title={colorNames[name]}
              className={`note-swatch note-${name}`}
              onClick={() => setColor(name)}
            />
          ))}
          <button className="primary" disabled={!text.trim() || saving} aria-label="保存筆記">
            <Check size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
