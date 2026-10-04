import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Plus,
  Network,
  ChevronDown,
  MessageSquare,
  ArrowUpRight,
  Layers,
  X,
  GitBranch,
  ScanLine,
  CircleHelp,
  Database,
  LoaderCircle,
} from 'lucide-react';
import { DEFAULT_BUDGET, type CanvasNode, type ContextPackage, type Excerpt } from '@acc/domain';
import { api, streamAnswer, type ClientState } from './api';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Focus, type SelectedText, type SourceHighlight } from './Focus';
import './styles.css';

export default function App() {
  const [state, setState] = useState<ClientState | null>(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState(6000);
  const [preview, setPreview] = useState<ContextPackage | null>(null);
  const [inspected, setInspected] = useState<{ pkg: ContextPackage; historical: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ conversationId: '', text: '' });
  const [locate, setLocate] = useState<{ id: string; tick: number } | null>(null);
  const [highlight, setHighlight] = useState<SourceHighlight | null>(null);
  const [newDialog, setNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [help, setHelp] = useState(false);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compileVersion = useRef(0);
  const generationLock = useRef(false);
  const refresh = useCallback(async () => {
    const s = await api<ClientState>('/state');
    setState(s);
    return s;
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!state?.turns.some((t) => t.status === 'streaming') || busy) return;
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [state, busy, refresh]);
  const fail = useCallback(
    (error: unknown) => setError(error instanceof Error ? error.message : '操作失败'),
    [],
  );
  const invalidate = useCallback(() => {
    compileVersion.current++;
    setPreview(null);
    setInspected((prev) => (prev?.historical ? prev : null));
  }, []);
  const active = state?.nodes.find((n) => n.id === activeId) || null;
  const conversationId = active?.ref_type === 'conversation' ? active.ref_id : '';
  const prompt = prompts[conversationId] || '';
  const open = useCallback(
    (n: CanvasNode) => {
      setActiveId(n.id);
      setHighlight(null);
      invalidate();
    },
    [invalidate],
  );
  const moveTo = useCallback((id: string) => {
    setLocate({ id, tick: Date.now() });
  }, []);
  const select = useCallback(
    (id: string) => {
      setSelected((ids) => (ids.includes(id) ? ids.filter((n) => n !== id) : [...ids, id]));
      invalidate();
    },
    [invalidate],
  );
  const control = useCallback(
    (nodeId: string, action: 'pin' | 'unpin' | 'exclude' | 'restore') => {
      void api('/context-control', { node_id: nodeId, action })
        .then(() => {
          if (action === 'exclude') setSelected((ids) => ids.filter((id) => id !== nodeId));
          invalidate();
          return refresh();
        })
        .catch(fail);
    },
    [refresh, invalidate, fail],
  );
  const create = async (title: string) => {
    try {
      const result = await api<{ node: CanvasNode }>('/conversations', { title });
      await refresh();
      open(result.node);
      moveTo(result.node.id);
      setNewDialog(false);
      setNewTitle('');
    } catch (e) {
      fail(e);
    }
  };
  const excerpt = async (selection: SelectedText, branch: boolean) => {
    try {
      const result = await api<{ node: CanvasNode; branch: { node: CanvasNode } | null }>(
        '/excerpts',
        {
          source_block_id: selection.block.id,
          source_content_hash: selection.block.content_hash,
          selector: selection.selector,
          branch,
        },
      );
      await refresh();
      const target = result.branch?.node || result.node;
      open(target);
      moveTo(target.id);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      fail(e);
    }
  };
  const branch = async (e: Excerpt) => {
    try {
      const result = await api<{ node: CanvasNode }>('/branches', { excerpt_id: e.id });
      await refresh();
      open(result.node);
      moveTo(result.node.id);
    } catch (e) {
      fail(e);
    }
  };
  const source = (e: Excerpt) => {
    if (!state) return;
    const b = state.blocks.find((b) => b.id === e.source_block_id);
    const t = state.turns.find((t) => t.id === b?.turn_id);
    const n = state.nodes.find(
      (n) => n.ref_type === 'conversation' && n.ref_id === t?.conversation_id,
    );
    if (n) {
      open(n);
      setHighlight({
        blockId: e.source_block_id,
        start: e.selector.start_char,
        end: e.selector.end_char,
      });
      moveTo(n.id);
    }
  };
  const compile = async () => {
    const version = ++compileVersion.current;
    try {
      const result = await api<{ package: ContextPackage }>('/compile', {
        conversation_id: conversationId,
        prompt,
        selected_node_ids: selected,
        budget: { ...DEFAULT_BUDGET, target_context_tokens: budget },
      });
      if (version === compileVersion.current) {
        setPreview(result.package);
        setInspected({ pkg: result.package, historical: false });
      }
    } catch (e) {
      fail(e);
    }
  };
  const generate = async (retryId?: string) => {
    if (!retryId && !preview) return;
    if (generationLock.current) return;
    generationLock.current = true;
    const pkg = retryId
      ? state?.packages.find(
          (p) =>
            p.context_set_id === state.turns.find((t) => t.id === retryId)?.input_context_set_id,
        )
      : preview;
    const targetConversation = conversationId;
    setBusy(true);
    setDraft({ conversationId: targetConversation, text: '' });
    setError('');
    try {
      await streamAnswer(
        retryId ? '/retry' : '/answer',
        retryId ? { turn_id: retryId } : { context_set_id: preview!.context_set_id },
        (text) => setDraft({ conversationId: targetConversation, text }),
      );
      setPrompts((p) => ({ ...p, [targetConversation]: '' }));
      setSelected([]);
      if (pkg) setInspected({ pkg, historical: true });
    } catch (e) {
      fail(e);
    } finally {
      generationLock.current = false;
      setBusy(false);
      setDraft({ conversationId: '', text: '' });
      setPreview(null);
      try {
        await refresh();
      } catch (e) {
        fail(e);
      }
    }
  };
  if (!state)
    return (
      <div className="loading-screen">
        <Network size={32} />
        <h1>Context Canvas</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="primary"
              onClick={() => {
                setError('');
                void refresh().catch(fail);
              }}
            >
              重试连接
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={16} />
            正在打开你的思考空间…
          </p>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Context Canvas 首页">
          <span className="brand-mark">
            <Network size={20} />
          </span>
          <strong>
            context<span>canvas</span>
          </strong>
          <small>EARLY ACCESS</small>
        </a>
        <div className="header-right">
          <span className="mode-pill">
            <span className="status-dot" />
            {state.provider.demo ? '本地演示' : state.provider.model || '待配置模型'}
          </span>
          <button className="icon-button" aria-label="使用帮助" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
          </button>
          <div className="avatar">我</div>
        </div>
      </header>
      <div className="workspace-layout">
        <aside className="sidebar">
          <div className="workspace-switch">
            <span className="workspace-icon">C</span>
            <div>
              <small>PERSONAL WORKSPACE</small>
              <strong>{state.workspace.name}</strong>
            </div>
            <ChevronDown size={14} />
          </div>
          <div className="sidebar-nav">
            <span className="nav-active">
              <Network size={16} />
              思考画布<span>{state.nodes.length}</span>
            </span>
          </div>
          <div className="sidebar-label">
            对话脉络
            <button aria-label="新建对话" onClick={() => setNewDialog(true)}>
              <Plus size={15} />
            </button>
          </div>
          <nav className="conversation-list" aria-label="对话列表">
            {state.conversations.map((c) => {
              const n = state.nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === c.id);
              return (
                <button
                  key={c.id}
                  className={c.id === conversationId ? 'current' : ''}
                  onClick={() => {
                    if (n) {
                      open(n);
                      moveTo(n.id);
                    }
                  }}
                >
                  {c.branch_origin_excerpt_id ? (
                    <GitBranch size={14} />
                  ) : (
                    <MessageSquare size={14} />
                  )}
                  <span>{c.title}</span>
                </button>
              );
            })}
            {!state.conversations.length && (
              <p className="sidebar-empty">
                你的第一条思考脉络，
                <br />
                从一个问题开始。
              </p>
            )}
          </nav>
          <div className="sidebar-tip">
            <Layers size={18} />
            <p>
              不只是聊天记录。
              <br />
              也是一张会生长的思考地图。
            </p>
            <button onClick={() => setHelp(true)}>
              了解工作方式 <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="sidebar-footer">
            <Database size={14} />
            <span>保存在本机 SQLite</span>
            <span className="status-dot" />
          </div>
        </aside>
        <main className="canvas-workspace">
          <div className="canvas-heading">
            <div>
              <span className="overline">YOUR THINKING SPACE</span>
              <h1>
                把想法连接起来<span>。</span>
              </h1>
            </div>
            <button className="secondary" onClick={() => setNewDialog(true)}>
              <Plus size={15} />
              新建对话
            </button>
          </div>
          <div className="canvas-stage">
            <ReactFlowProvider>
              <Canvas
                state={state}
                activeNode={activeId}
                selected={selected}
                locate={locate}
                onOpen={open}
                onSelect={select}
                onControl={control}
                onMove={(id, x, y) => {
                  void api(`/nodes/${id}`, { x, y }, 'PATCH')
                    .then(() => refresh())
                    .catch(fail);
                }}
                onViewport={(v) => {
                  if (viewportTimer.current) clearTimeout(viewportTimer.current);
                  viewportTimer.current = setTimeout(() => {
                    void api('/workspace', { viewport: v }, 'PATCH').catch(fail);
                  }, 350);
                }}
              />
            </ReactFlowProvider>
            {!state.nodes.length && (
              <div className="canvas-welcome">
                <div className="welcome-graphic">
                  <span />
                  <Network size={52} strokeWidth={1} />
                  <i />
                  <b />
                </div>
                <span className="overline">A LITTLE SPACE FOR BIG IDEAS</span>
                <h2>
                  给你的思考，
                  <br />
                  多一点展开的空间。
                </h2>
                <p>
                  从对话出发，摘录值得保留的想法。
                  <br />
                  让分支自由生长，让上下文始终清晰。
                </p>
                <button className="primary" onClick={() => setNewDialog(true)}>
                  <Plus size={16} />
                  开始第一段对话
                </button>
                <div className="starter-prompts">
                  <span>或者试试</span>
                  {['设计一个新产品', '梳理一项研究'].map((t) => (
                    <button key={t} onClick={() => void create(t)}>
                      {t}
                      <ArrowUpRight size={12} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {state.nodes.length > 0 && (
              <div className="canvas-hint">
                <span className="status-dot" />
                {state.nodes.length} 个节点 · {state.edges.length} 条关系
                <span>滚轮平移 · 双指缩放 · 双击进入对话</span>
              </div>
            )}
            {active && (
              <Focus
                state={state}
                node={active}
                prompt={prompt}
                budget={budget}
                preview={preview}
                busy={busy && draft.conversationId === conversationId}
                draft={draft.text}
                highlight={highlight}
                onClose={() => {
                  setActiveId(null);
                  invalidate();
                }}
                onPrompt={(value) => {
                  setPrompts((p) => ({ ...p, [conversationId]: value }));
                  invalidate();
                }}
                onBudget={(value) => {
                  setBudget(value);
                  invalidate();
                }}
                onCompile={() => void compile()}
                onSend={() => void generate()}
                onExcerpt={(s, b) => void excerpt(s, b)}
                onBranch={(e) => void branch(e)}
                onSource={source}
                onInspect={(pkg) => setInspected({ pkg, historical: true })}
                onRetry={(id) => void generate(id)}
              />
            )}
          </div>
        </main>
        <Inspector
          state={state}
          pkg={inspected?.pkg || null}
          historical={inspected?.historical || false}
          selected={selected}
          onLocate={moveTo}
        />
      </div>
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="关闭错误">
            <X size={16} />
          </button>
        </div>
      )}
      {newDialog && (
        <div className="modal-backdrop" onClick={() => setNewDialog(false)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void create(newTitle.trim() || '新的探索');
            }}
          >
            <span className="overline">NEW CONVERSATION</span>
            <h2 id="new-title">从哪里开始探索？</h2>
            <label htmlFor="conversation-title">给这段对话起个名字</label>
            <input
              autoFocus
              id="conversation-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={160}
              placeholder="例如：我的下一个产品"
            />
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setNewDialog(false)}>
                取消
              </button>
              <button className="primary" type="submit">
                创建对话
                <ArrowUpRight size={15} />
              </button>
            </div>
          </form>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" aria-label="关闭帮助" onClick={() => setHelp(false)}>
              <X size={18} />
            </button>
            <span className="overline">HOW IT WORKS</span>
            <h2 id="help-title">从对话，到思考地图。</h2>
            <ol>
              <li>
                <MessageSquare size={18} />
                <span>
                  <strong>提出一个问题</strong>预览上下文后发送，回答会留在这条对话中。
                </span>
              </li>
              <li>
                <GitBranch size={18} />
                <span>
                  <strong>选中文字，长出分支</strong>摘录会保存原文范围与来源，随时可以回去查看。
                </span>
              </li>
              <li>
                <ScanLine size={18} />
                <span>
                  <strong>决定模型会看到什么</strong>选择、固定或排除节点，在右侧检查器核对输入。
                </span>
              </li>
            </ol>
            <p className="quiet-note">
              本地演示不调用 AI。真实模型需由服务端配置 LLM_PROVIDER、LLM_MODEL 和
              LLM_API_KEY；密钥不会进入浏览器。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
