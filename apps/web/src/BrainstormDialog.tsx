import { useState } from 'react';
import { Check, Lightbulb, LoaderCircle, X } from 'lucide-react';
import type { CanvasNode } from '@acc/domain';
import { useApi } from './api';

type Idea = { index: number; title: string; prompt: string; reason: string };

// Ask the model for directions that extend one card; the person keeps the ones they
// want, and only those become cards.
export function BrainstormDialog({
  node,
  onAccepted,
  onClose,
}: {
  node: CanvasNode;
  onAccepted: (nodes: CanvasNode[]) => Promise<void>;
  onClose: () => void;
}) {
  const api = useApi();
  const [phase, setPhase] = useState<'choose' | 'thinking' | 'pick'>('choose');
  const [result, setResult] = useState<{ turn_id: string; overview: string; ideas: Idea[] }>();
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState('');
  const run = async (count: 3 | 5 | 8) => {
    setPhase('thinking');
    setError('');
    try {
      const next = await api<{ turn_id: string; overview: string; ideas: Idea[] }>('/brainstorm', {
        node_id: node.id,
        request_id: crypto.randomUUID(),
        count,
      });
      setResult(next);
      setChosen(next.ideas.map((idea) => idea.index));
      setPhase('pick');
    } catch (e) {
      setError(e instanceof Error ? e.message : '腦力激盪失敗');
      setPhase('choose');
    }
  };
  const accept = async () => {
    if (!result || !chosen.length) return;
    setPhase('thinking');
    try {
      const { nodes } = await api<{ nodes: CanvasNode[] }>(
        '/brainstorm/' + encodeURIComponent(result.turn_id) + '/accept',
        { indexes: chosen },
      );
      await onAccepted(nodes);
    } catch (e) {
      setError(e instanceof Error ? e.message : '無法加入卡片');
      setPhase('pick');
    }
  };
  return (
    <div className="modal-backdrop" onClick={phase === 'thinking' ? undefined : onClose}>
      <section
        className="modal brainstorm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brainstorm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" aria-label="關閉腦力激盪" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="brainstorm-title">
          <Lightbulb size={20} /> {node.title}
        </h2>
        {phase === 'choose' && (
          <div className="brainstorm-counts" role="group" aria-label="方向數量">
            {([3, 5, 8] as const).map((count) => (
              <button key={count} onClick={() => void run(count)}>
                {count}
              </button>
            ))}
          </div>
        )}
        {phase === 'thinking' && (
          <p role="status" className="brainstorm-wait">
            <LoaderCircle className="spin" size={18} />
          </p>
        )}
        {phase === 'pick' && result && (
          <>
            <ul className="brainstorm-ideas" aria-label="方向">
              {result.ideas.map((idea) => (
                <li key={idea.index}>
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.includes(idea.index)}
                      onChange={(event) =>
                        setChosen((previous) =>
                          event.target.checked
                            ? [...previous, idea.index]
                            : previous.filter((index) => index !== idea.index),
                        )
                      }
                    />
                    <span>
                      <strong>{idea.title}</strong>
                      <small>{idea.prompt}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={!chosen.length} onClick={() => void accept()}>
              <Check size={15} /> 加入 {chosen.length} 張
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
