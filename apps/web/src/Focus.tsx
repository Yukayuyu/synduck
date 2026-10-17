import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  GitBranch,
  Quote,
  CornerUpRight,
  ScanLine,
  Send,
  RotateCcw,
  LoaderCircle,
} from 'lucide-react';
import type { CanvasNode, ContentBlock, ContextPackage, Excerpt, Turn } from '@acc/domain';
import type { ClientState } from './api';

export interface SelectedText {
  block: ContentBlock;
  selector: Excerpt['selector'];
}
export interface SourceHighlight {
  blockId: string;
  start: number;
  end: number;
}
interface Props {
  active: boolean;
  inputReady: boolean;
  locked: boolean;
  onOpen: () => void;
  state: ClientState;
  node: CanvasNode;
  prompt: string;
  budget: number;
  preview: ContextPackage | null;
  busy: boolean;
  draft: string;
  pendingInput: { prompt: string; retryTurnId: string | null; contextSetId: string | null } | null;
  highlight: SourceHighlight | null;
  onClose: () => void;
  onPrompt: (value: string) => void;
  onBudget: (value: number) => void;
  onCompile: () => void;
  onSend: () => void;
  onSendDirect: () => void;
  onExcerpt: (selection: SelectedText, branch: boolean) => void;
  onBranch: (excerpt: Excerpt) => void;
  onSource: (excerpt: Excerpt) => void;
  onInspect: (pkg: ContextPackage) => void;
  onRetry: (turnId: string) => void;
}
export function Focus(props: Props) {
  const { state, node, busy, draft, preview, highlight, active, locked } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasGenerating = useRef(false);
  useLayoutEffect(() => {
    // Focus only on explicit activation, once the node is measured and visible.
    // React Flow initially mounts fresh nodes hidden, so autofocus is too early.
    if (active && props.inputReady) inputRef.current?.focus({ preventScroll: true });
  }, [active, props.inputReady, node.id]);
  const [selectionPosition, setSelectionPosition] = useState({ left: 0, top: 0 });
  const [selection, setSelection] = useState<SelectedText | null>(null);
  const conversation = state.conversations.find((c) => c.id === node.ref_id);
  const excerpt = state.excerpts.find((e) => e.id === node.ref_id);
  const turns = state.turns
    .filter((t) => t.conversation_id === conversation?.id)
    .sort((a, b) => a.sequence - b.sequence);
  // A question and all its answers/retries share one reading group. The turns
  // and content blocks retain their canonical identities and exact source text.
  const exchanges: Turn[][] = [];
  for (const turn of turns) {
    if (turn.actor === 'human' || !exchanges.length) exchanges.push([]);
    exchanges.at(-1)!.push(turn);
  }
  const pending = props.pendingInput;
  const liveOutput = (
    <article className="turn assistant live-draft" aria-label="正在生成的輸出">
      <div className="turn-heading">
        <strong>輸出</strong>
        <span className="output-status">
          <LoaderCircle className="spin" size={12} />
          生成中 · 尚未保存
        </span>
      </div>
      <div className="message-text">{draft || '正在整理這個問題…'}</div>
    </article>
  );
  const origin = state.excerpts.find((e) => e.id === conversation?.branch_origin_excerpt_id);
  useEffect(() => {
    setSelection(null);
  }, [node.id]);
  useEffect(() => {
    if (!highlight) return;
    const block = document.getElementById(`block-${highlight.blockId}`);
    const scroll = scrollRef.current;
    if (block && scroll) {
      // Each input/output block has its own positioned container. Use viewport
      // coordinates corrected for canvas zoom, rather than offsetParent offsets.
      const bounds = scroll.getBoundingClientRect();
      const scale = bounds.height / scroll.offsetHeight;
      const target = block.querySelector('mark') || block;
      if (scale > 0)
        scroll.scrollTop += (target.getBoundingClientRect().top - bounds.top) / scale - 8;
    }
  }, [highlight]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (
      busy &&
      scroll &&
      (!wasGenerating.current || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120)
    )
      scroll.scrollTop = scroll.scrollHeight;
    wasGenerating.current = busy;
  }, [busy, draft]);
  useEffect(() => {
    const clear = () => setSelection(null);
    window.addEventListener('canvas-view-changed', clear);
    window.addEventListener('resize', clear);
    return () => {
      window.removeEventListener('canvas-view-changed', clear);
      window.removeEventListener('resize', clear);
    };
  }, []);
  const capture = (element: HTMLElement, block: ContentBlock) => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) {
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      setSelection(null);
      return;
    }
    const before = range.cloneRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const exact = range.toString();
    if (!exact || block.text_content?.slice(start, start + exact.length) !== exact) return;
    const rect = range.getBoundingClientRect();
    setSelectionPosition({
      left: Math.max(12, Math.min(window.innerWidth - 310, rect.left)),
      top: Math.max(76, Math.min(window.innerHeight - 155, rect.bottom + 10)),
    });
    setSelection({
      block,
      selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
    });
  };
  useEffect(() => {
    // iOS selection handles update selection without a mouseup event.
    const changed = () => {
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.anchorNode) return;
      const element = (
        selected.anchorNode instanceof Element
          ? selected.anchorNode
          : selected.anchorNode.parentElement
      )?.closest<HTMLElement>('[data-testid="content-block"]');
      if (element?.closest<HTMLElement>('.focus-panel')?.dataset.nodeId !== node.id) {
        setSelection(null);
        return;
      }
      const block = state.blocks.find((b) => `block-${b.id}` === element.id);
      if (block) capture(element, block);
    };
    document.addEventListener('selectionchange', changed);
    return () => document.removeEventListener('selectionchange', changed);
  }, [state.blocks, node.id]);
  return (
    <section
      className={`focus-panel ${active ? 'editing' : 'reading'}`}
      data-node-id={node.id}
      data-active={active}
      aria-label={excerpt ? '摘录详情' : '对话详情'}
    >
      {active && excerpt && (
        <div className="focus-heading">
          <span>{excerpt ? '原文摘錄' : '在這裡繼續提問'}</span>
          <button onClick={props.onClose} aria-label="返回画布" title="收起輸入框">
            <X size={15} />
          </button>
        </div>
      )}
      <div className="focus-title">
        <span className="overline">
          {excerpt
            ? 'EXCERPT / 原文摘录'
            : origin
              ? 'BRANCH / 分支对话'
              : 'CONVERSATION / 自由探索'}
        </span>
        <h2>{node.title}</h2>
      </div>
      {excerpt ? (
        <div className="focus-content excerpt-detail">
          <blockquote>{excerpt.snapshot_text}</blockquote>
          <div className="excerpt-actions">
            <button
              className="secondary"
              aria-label="回到来源并高亮"
              onClick={() => props.onSource(excerpt)}
            >
              <CornerUpRight size={14} />
              回到原文
            </button>
            <button
              className="primary"
              aria-label="从摘录开始分支"
              onClick={() => props.onBranch(excerpt)}
              disabled={locked}
            >
              <GitBranch size={14} />
              延伸提問
            </button>
          </div>
          <details>
            <summary>来源记录</summary>
            <dl>
              <dt>原文範圍</dt>
              <dd>
                {excerpt.selector.start_char}–{excerpt.selector.end_char} · 原文快照已保存
              </dd>
              <dt>Source block</dt>
              <dd>{excerpt.source_block_id}</dd>
              <dt>SHA-256</dt>
              <dd>{excerpt.source_content_hash}</dd>
            </dl>
          </details>
        </div>
      ) : (
        <>
          {origin && (
            <button className="branch-origin" onClick={() => props.onSource(origin)}>
              <GitBranch size={14} />
              <span>
                源自摘录<strong>{origin.snapshot_text}</strong>
              </span>
              <CornerUpRight size={14} />
            </button>
          )}
          <div ref={scrollRef} className="focus-content conversation-scroll">
            {turns.length === 0 && !busy && (
              <div className="conversation-empty">
                <div className="small-orbit">
                  <MessageIcon />
                </div>
                <h3>{origin ? '沿着这个想法，继续探索。' : '从一个好问题开始。'}</h3>
                <p>
                  {origin
                    ? '此分支只带入摘录原文，不会自动加入整个旧对话。'
                    : '回答中的任何一段，都可以成为新的思考起点。'}
                </p>
              </div>
            )}
            {exchanges.map((exchange, index) => (
              <section
                className="exchange"
                key={exchange[0].id}
                role="group"
                aria-label={`第 ${index + 1} 組問答`}
              >
                {exchange.map((turn) => {
                  const generating =
                    busy && (turn.id === pending?.retryTurnId || turn.status === 'streaming');
                  return (
                    <article
                      key={turn.id}
                      className={`turn ${turn.actor}`}
                      data-testid={`turn-${turn.actor}`}
                    >
                      <div className="turn-heading">
                        {turn.actor === 'human' && (
                          <span className="exchange-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                        )}
                        <strong>
                          {turn.actor === 'human'
                            ? '輸入'
                            : turn.actor === 'assistant'
                              ? '輸出'
                              : turn.actor === 'tool'
                                ? '工具'
                                : '指示'}
                        </strong>
                        {generating ? (
                          <span className="output-status">
                            <LoaderCircle className="spin" size={12} />
                            生成中 · 尚未保存
                          </span>
                        ) : (
                          turn.model_provider === 'demo' && (
                            <span className="output-status">本地演示</span>
                          )
                        )}
                        <time>
                          {new Date(turn.created_at).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </div>
                      {!generating &&
                        state.blocks
                          .filter((b) => b.turn_id === turn.id)
                          .sort((a, b) => a.ordinal - b.ordinal)
                          .map((block) => {
                            const text = block.text_content || '';
                            const marked = highlight?.blockId === block.id;
                            return (
                              <div
                                id={`block-${block.id}`}
                                data-testid="content-block"
                                key={block.id}
                                className="message-text"
                                onMouseUp={(event) => capture(event.currentTarget, block)}
                              >
                                {marked ? (
                                  <>
                                    {text.slice(0, highlight.start)}
                                    <mark>{text.slice(highlight.start, highlight.end)}</mark>
                                    {text.slice(highlight.end)}
                                  </>
                                ) : (
                                  text
                                )}
                              </div>
                            );
                          })}
                      {turn.status === 'error' && !generating && (
                        <div className="generation-error">
                          <p>{turn.error}</p>
                          <button
                            className="text-button"
                            disabled={locked}
                            onClick={() => props.onRetry(turn.id)}
                          >
                            <RotateCcw size={13} />
                            使用原上下文重试
                          </button>
                        </div>
                      )}
                      {turn.status === 'streaming' && !busy && (
                        <p className="muted">回答仍在生成，请稍后刷新。</p>
                      )}
                      {generating && (
                        <div className="message-text live-draft">
                          {draft || '正在整理這個問題…'}
                        </div>
                      )}
                      {turn.actor === 'assistant' && !generating && (
                        <button
                          className="turn-context text-button"
                          onClick={() => {
                            const pkg = state.packages.find(
                              (p) => p.context_set_id === turn.input_context_set_id,
                            );
                            if (pkg) props.onInspect(pkg);
                          }}
                        >
                          <ScanLine size={12} />
                          查看本轮上下文
                        </button>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
            {busy &&
              pending &&
              !pending.retryTurnId &&
              !turns.some(
                (turn) =>
                  turn.actor === 'assistant' && turn.input_context_set_id === pending.contextSetId,
              ) && (
                <section
                  className="exchange pending-exchange"
                  role="group"
                  aria-label={`第 ${exchanges.length + 1} 組問答`}
                >
                  <article className="turn human">
                    <div className="turn-heading">
                      <span className="exchange-index">
                        {String(exchanges.length + 1).padStart(2, '0')}
                      </span>
                      <strong>輸入</strong>
                    </div>
                    <div className="message-text">{pending.prompt}</div>
                  </article>
                  {liveOutput}
                </section>
              )}
          </div>
          {selection &&
            createPortal(
              <div
                className="selection-toolbar canvas-selection-toolbar"
                role="toolbar"
                aria-label="文字选区操作"
                style={{ left: selectionPosition.left, top: selectionPosition.top }}
              >
                <span>{selection.selector.exact.length} 字</span>
                <button
                  disabled={locked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    props.onExcerpt(selection, false);
                    setSelection(null);
                  }}
                >
                  <Quote size={14} />
                  摘录
                </button>
                <button
                  disabled={locked}
                  aria-label="摘录并分支"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    props.onExcerpt(selection, true);
                    setSelection(null);
                  }}
                >
                  <GitBranch size={14} />
                  延伸提問
                </button>
                <button aria-label="取消文字選取" onClick={() => setSelection(null)}>
                  <X size={14} />
                </button>
              </div>,
              document.body,
            )}
          {active ? (
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                props.onCompile();
              }}
            >
              <div className="composer-heading">
                <span>接續輸入</span>
                <button
                  type="button"
                  onClick={props.onClose}
                  aria-label="返回画布"
                  title="收起輸入框"
                >
                  <X size={14} />
                </button>
              </div>
              <label className="sr-only" htmlFor={`prompt-${node.id}`}>
                你的问题
              </label>
              <textarea
                ref={inputRef}
                id={`prompt-${node.id}`}
                placeholder={origin ? '想沿着这个想法探索什么？' : '写下你的问题，让思考开始…'}
                value={props.prompt}
                onChange={(e) => props.onPrompt(e.target.value)}
                readOnly={locked}
                rows={2}
                maxLength={32000}
              />
              <details className="composer-settings">
                <summary>上下文預算</summary>
                <div className="composer-options">
                  <label>
                    上下文预算{' '}
                    <select
                      aria-label="上下文预算"
                      value={props.budget}
                      onChange={(e) => props.onBudget(Number(e.target.value))}
                      disabled={locked}
                    >
                      <option value={2000}>2,000</option>
                      <option value={6000}>6,000</option>
                      <option value={10000}>10,000</option>
                    </select>
                  </label>
                  <span>保守估算</span>
                </div>
              </details>
              <div className="composer-bottom">
                <span>
                  {preview
                    ? `${preview.items.length} 项上下文已预览`
                    : '可直接傳送，也可先檢查上下文'}
                </span>
                {preview ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={locked || !preview.sendable}
                    onClick={props.onSend}
                  >
                    <Send size={14} />
                    发送此上下文
                  </button>
                ) : (
                  <div className="composer-send-actions">
                    <button
                      type="submit"
                      className="secondary"
                      disabled={locked || !props.prompt.trim()}
                    >
                      <ScanLine size={14} />
                      预览上下文
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={locked || !props.prompt.trim()}
                      onClick={props.onSendDirect}
                    >
                      <Send size={14} />
                      傳送
                    </button>
                  </div>
                )}
              </div>
            </form>
          ) : (
            <button className="continue-on-canvas secondary" onClick={props.onOpen}>
              <Send size={14} />
              繼續提問
            </button>
          )}
        </>
      )}
    </section>
  );
}
function MessageIcon() {
  return <Quote size={22} strokeWidth={1.4} />;
}
