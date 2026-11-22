import { useState } from 'react';
import { Quote, X } from 'lucide-react';
import { collectionSources, type Excerpt } from '@acc/domain';
import type { ClientState } from './api';

export function AppendExcerptDialog({
  state,
  onAppend,
  onClose,
}: {
  state: ClientState;
  onAppend: (excerpt: Excerpt) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const members = new Set(
    state.excerpts.flatMap((e) => e.collection_source_ids?.filter((id) => id !== e.id) ?? []),
  );
  const candidates = state.excerpts.filter(
    (e) =>
      !members.has(e.id) &&
      state.nodes.some(
        (n) => n.ref_type === 'excerpt' && n.ref_id === e.id && n.visibility !== 'hidden',
      ),
  );
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <section
        className="modal append-excerpt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="追加到摘錄"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !saving && !event.nativeEvent.isComposing) onClose();
        }}
      >
        <button className="modal-close" aria-label="取消追加" disabled={saving} onClick={onClose}>
          <X size={18} />
        </button>
        <h2>追加到摘錄</h2>
        <input
          autoFocus
          aria-label="尋找摘錄"
          placeholder="尋找摘錄…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!candidates.length && <p>先建立一張摘錄，就能把其他文字追加到裡面。</p>}
        <div className="append-excerpt-list">
          {candidates
            .filter((e) =>
              (
                e.title +
                ' ' +
                collectionSources(state, e)
                  .map((s) => s.snapshot_text)
                  .join(' ')
              )
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((e) => (
              <button
                key={e.id}
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setError('');
                  try {
                    await onAppend(e);
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '未能追加，請重試。');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Quote size={15} />
                <span>
                  <strong>
                    {state.nodes.find((n) => n.ref_type === 'excerpt' && n.ref_id === e.id)
                      ?.title ?? e.title}
                  </strong>
                  <small>
                    {collectionSources(state, e)
                      .map((s) => s.snapshot_text)
                      .join(' · ')
                      .slice(0, 160)}
                  </small>
                </span>
              </button>
            ))}
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
