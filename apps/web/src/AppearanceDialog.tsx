import { useEffect, useRef } from 'react';
import { Check, MoreHorizontal, Quote, Send, X } from 'lucide-react';

export const appearances = [
  { id: 'arc', name: 'Arc 弧面', description: '冷白、大圆角，让路径轻轻连接。' },
  { id: 'paper', name: 'Paper 纸感', description: '暖纸、留白，让文字成为主角。' },
  { id: 'ink', name: 'Ink 墨色', description: '深色、薄描边，让思路浮现。' },
] as const;
export type Appearance = (typeof appearances)[number]['id'];
export const appearanceKey = 'canvas-appearance-v1';
export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(appearanceKey);
    return appearances.find((entry) => entry.id === saved)?.id || 'arc';
  } catch {
    return 'arc';
  }
}

export function AppearanceDialog({
  value,
  onChange,
  onClose,
}: {
  value: Appearance;
  onChange: (value: Appearance) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="appearance-dialog nokey"
      aria-labelledby="appearance-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current!.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="appearance-heading">
        <div>
          <span className="appearance-kicker">MAKE ROOM FOR THOUGHT</span>
          <h2 id="appearance-title">给思路一种形状。</h2>
        </div>
        <button className="icon-button" aria-label="关闭外观" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <fieldset className="appearance-grid">
        <legend className="sr-only">画布风格</legend>
        {appearances.map((entry) => (
          <label
            className={`appearance-option ${value === entry.id ? 'chosen' : ''}`}
            key={entry.id}
          >
            <input
              type="radio"
              name="canvas-appearance"
              value={entry.id}
              checked={value === entry.id}
              onChange={() => onChange(entry.id)}
            />
            <div className="style-sample" data-canvas-style={entry.id} aria-hidden="true">
              <svg className="sample-path" viewBox="0 0 280 220">
                <path d="M 115 92 C 235 92, 70 159, 164 159" />
              </svg>
              <div className="sample-conversation">
                <div className="sample-title">
                  <i />
                  一个更轻的工作区
                  <MoreHorizontal size={13} />
                </div>
                <div className="sample-input">如何让想法保持连贯？</div>
                <p>
                  把问题与回答放在一起。
                  <br />
                  让下一步，沿着文字发生。
                </p>
                <span className="sample-send">
                  <Send size={12} />
                </span>
              </div>
              <div className="sample-excerpt">
                <Quote size={14} />
                <span>沿着文字发生。</span>
              </div>
            </div>
            <span className="appearance-name">
              {entry.name}
              {value === entry.id && <Check size={16} />}
            </span>
            <span className="appearance-description">{entry.description}</span>
          </label>
        ))}
      </fieldset>
      <div className="appearance-footer">
        <span>选中即预览 · 此浏览器会记住你的选择</span>
        <button className="primary" onClick={onClose}>
          完成
        </button>
      </div>
    </dialog>
  );
}
