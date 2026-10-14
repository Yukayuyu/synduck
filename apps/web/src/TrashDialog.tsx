import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw, Trash2 } from 'lucide-react';
import type { ClientState } from './api';
import type { SourceHighlight } from './Focus';

export function TrashDialog({
  state,
  target,
  busy,
  onRestore,
  onClose,
}: {
  state: ClientState;
  target: { id: string; highlight?: SourceHighlight } | null;
  busy: boolean;
  onRestore: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(target?.id || '');
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected)
        previousFocus.current.focus();
    };
  }, []);
  const deleted = state.nodes
    .filter((n) => n.visibility === 'hidden')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const node = deleted.find((n) => n.id === current);
  const excerpt = state.excerpts.find((e) => e.id === node?.ref_id);
  const turns = state.turns
    .filter((t) =>
      node?.ref_type === 'turn' ? t.id === node.ref_id : t.conversation_id === node?.ref_id,
    )
    .sort((a, b) => a.sequence - b.sequence);
  const highlight = target?.id === current ? target.highlight : undefined;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="modal trash-dialog nokey"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trash-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <button className="modal-close" aria-label="關閉回收桶" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="trash-title">
          <Trash2 size={20} />
          回收桶
        </h2>
        <p className="drawer-caption">
          刪除的卡片不會加入新的 AI 上下文。原文和來源仍可檢視、還原。
        </p>
        <label className="sr-only" htmlFor="trash-search">
          搜尋已刪除卡片
        </label>
        <input
          id="trash-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋卡片名稱…"
        />
        <div className="trash-layout">
          <nav aria-label="已刪除卡片">
            {deleted
              .filter((n) => n.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
              .map((n) => (
                <div className={'trash-entry ' + (current === n.id ? 'current' : '')} key={n.id}>
                  <button onClick={() => setCurrent(n.id)}>
                    <span>{n.title}</span>
                    <small>{n.ref_type === 'excerpt' ? '摘錄' : '對話'}</small>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={'還原「' + n.title + '」'}
                    title="還原卡片"
                    disabled={busy}
                    onClick={() => {
                      void onRestore(n.id);
                    }}
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              ))}
            {!deleted.length && <p className="empty-note">回收桶是空的。</p>}
            {!!deleted.length &&
              !deleted.some((n) =>
                n.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
              ) && <p className="empty-note">找不到符合的卡片。</p>}
          </nav>
          <div className="trash-preview" aria-label="已刪除的原文">
            {node ? (
              <>
                <h3>{node.title}</h3>
                {excerpt ? (
                  <blockquote>{excerpt.snapshot_text}</blockquote>
                ) : (
                  turns.map((turn) => (
                    <article key={turn.id}>
                      <strong>
                        {turn.actor === 'human'
                          ? '你'
                          : turn.actor === 'assistant'
                            ? 'AI'
                            : turn.actor}
                      </strong>
                      {state.blocks
                        .filter((block) => block.turn_id === turn.id)
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map((block) => {
                          const text = block.text_content || '';
                          return (
                            <p key={block.id}>
                              {highlight?.blockId === block.id ? (
                                <>
                                  {text.slice(0, highlight.start)}
                                  <mark>{text.slice(highlight.start, highlight.end)}</mark>
                                  {text.slice(highlight.end)}
                                </>
                              ) : (
                                text
                              )}
                            </p>
                          );
                        })}
                    </article>
                  ))
                )}
              </>
            ) : (
              <p className="empty-note">選擇一張卡片，檢視保留的原文。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
