import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  X,
  GitBranch,
  Quote,
  CornerUpRight,
  ScanLine,
  Send,
  RotateCcw,
  LoaderCircle,
  Bot,
  UserRound,
} from 'lucide-react';
import type { CanvasNode, ContentBlock, ContextPackage, Excerpt } from '@acc/domain';
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
  state: ClientState;
  node: CanvasNode;
  prompt: string;
  budget: number;
  preview: ContextPackage | null;
  busy: boolean;
  draft: string;
  highlight: SourceHighlight | null;
  onClose: () => void;
  onPrompt: (value: string) => void;
  onBudget: (value: number) => void;
  onCompile: () => void;
  onSend: () => void;
  onExcerpt: (selection: SelectedText, branch: boolean) => void;
  onBranch: (excerpt: Excerpt) => void;
  onSource: (excerpt: Excerpt) => void;
  onInspect: (pkg: ContextPackage) => void;
  onRetry: (turnId: string) => void;
}
export function Focus(props: Props) {
  const { state, node, busy, draft, preview, highlight } = props;
  const [selection, setSelection] = useState<SelectedText | null>(null);
  const conversation = state.conversations.find((c) => c.id === node.ref_id);
  const excerpt = state.excerpts.find((e) => e.id === node.ref_id);
  const turns = state.turns
    .filter((t) => t.conversation_id === conversation?.id)
    .sort((a, b) => a.sequence - b.sequence);
  const origin = state.excerpts.find((e) => e.id === conversation?.branch_origin_excerpt_id);
  useEffect(() => {
    setSelection(null);
  }, [node.id]);
  useEffect(() => {
    if (highlight)
      document
        .getElementById(`block-${highlight.blockId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);
  const capture = (event: React.MouseEvent<HTMLDivElement>, block: ContentBlock) => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) {
      setSelection(null);
      return;
    }
    const range = selected.getRangeAt(0);
    const element = event.currentTarget;
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
    setSelection({
      block,
      selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
    });
  };
  return (
    <section className="focus-panel" aria-label={excerpt ? '摘录详情' : '对话详情'}>
      <div className="focus-heading">
        <button onClick={props.onClose} aria-label="返回画布">
          <ArrowLeft size={16} />
        </button>
        <span>
          画布 <span className="breadcrumb-slash">/</span> {excerpt ? '摘录' : '对话'}
        </span>
        <button onClick={props.onClose} aria-label="关闭详情">
          <X size={16} />
        </button>
      </div>
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
          <Quote size={26} />
          <blockquote>{excerpt.snapshot_text}</blockquote>
          <p className="muted">
            来源范围 {excerpt.selector.start_char}–{excerpt.selector.end_char} · 原文快照已保存
          </p>
          <button className="secondary" onClick={() => props.onSource(excerpt)}>
            <CornerUpRight size={15} />
            回到来源并高亮
          </button>
          <button className="primary" onClick={() => props.onBranch(excerpt)} disabled={busy}>
            <GitBranch size={15} />
            从摘录开始分支
          </button>
          <details>
            <summary>来源记录</summary>
            <dl>
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
          <div className="focus-content conversation-scroll">
            {turns.length === 0 && (
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
            {turns.map((turn) => (
              <article
                key={turn.id}
                className={`turn ${turn.actor}`}
                data-testid={`turn-${turn.actor}`}
              >
                <div className="turn-heading">
                  <span className="actor-icon">
                    {turn.actor === 'human' ? <UserRound size={13} /> : <Bot size={13} />}
                  </span>
                  <strong>
                    {turn.actor === 'human'
                      ? '你'
                      : turn.model_provider === 'demo'
                        ? '演示助手'
                        : 'AI 助手'}
                  </strong>
                  <time>
                    {new Date(turn.created_at).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                {state.blocks
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
                        onMouseUp={(event) => capture(event, block)}
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
                {turn.status === 'error' && (
                  <div className="generation-error">
                    <p>{turn.error}</p>
                    <button
                      className="text-button"
                      disabled={busy}
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
                {turn.actor === 'assistant' && (
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
            ))}
            {busy && (
              <article className="turn assistant live-draft">
                <div className="turn-heading">
                  <LoaderCircle className="spin" size={14} />
                  <strong>正在生成 · 尚未保存</strong>
                </div>
                <div className="message-text">{draft || '正在使用你预览的上下文…'}</div>
              </article>
            )}
          </div>
          {selection && (
            <div className="selection-toolbar" role="toolbar" aria-label="文字选区操作">
              <span>已选 {selection.selector.exact.length} 字符</span>
              <button
                disabled={busy}
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
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  props.onExcerpt(selection, true);
                  setSelection(null);
                }}
              >
                <GitBranch size={14} />
                摘录并分支
              </button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              props.onCompile();
            }}
          >
            <label className="sr-only" htmlFor="prompt">
              你的问题
            </label>
            <textarea
              id="prompt"
              placeholder={origin ? '想沿着这个想法探索什么？' : '写下你的问题，让思考开始…'}
              value={props.prompt}
              onChange={(e) => props.onPrompt(e.target.value)}
              disabled={busy}
              rows={3}
              maxLength={32000}
            />
            <div className="composer-options">
              <label>
                上下文预算{' '}
                <select
                  aria-label="上下文预算"
                  value={props.budget}
                  onChange={(e) => props.onBudget(Number(e.target.value))}
                  disabled={busy}
                >
                  <option value={2000}>2,000</option>
                  <option value={6000}>6,000</option>
                  <option value={10000}>10,000</option>
                </select>
              </label>
              <span>保守估算</span>
            </div>
            <div className="composer-bottom">
              <span>{preview ? `${preview.items.length} 项上下文已预览` : '先预览，再发送'}</span>
              {preview ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !preview.sendable}
                  onClick={props.onSend}
                >
                  <Send size={14} />
                  发送此上下文
                </button>
              ) : (
                <button type="submit" className="primary" disabled={busy || !props.prompt.trim()}>
                  <ScanLine size={14} />
                  预览上下文
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
function MessageIcon() {
  return <Quote size={22} strokeWidth={1.4} />;
}
