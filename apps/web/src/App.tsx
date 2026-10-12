import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  Plus,
  Network,
  MessageSquare,
  ArrowUpRight,
  X,
  GitBranch,
  ScanLine,
  CircleHelp,
  FolderArchive,
  LoaderCircle,
  MousePointer2,
  Hand,
} from 'lucide-react';
import { DEFAULT_BUDGET, type CanvasNode, type ContextPackage, type Excerpt } from '@acc/domain';
import { api, streamAnswer, type ClientState } from './api';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Focus, type SelectedText, type SourceHighlight } from './Focus';
import { ProjectDialog } from './ProjectDialog';
import { ModelDialog } from './ModelDialog';
import { LocalDialog } from './LocalDialog';
import { LocalControl } from './LocalControl';
import { UpdateControl } from './UpdateControl';
import './styles.css';
import './canvas-first.css';

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
  const [projectDialog, setProjectDialog] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [localDialog, setLocalDialog] = useState(false);
  const [panel, setPanel] = useState<'conversations' | 'context' | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [canvasEpoch, setCanvasEpoch] = useState(0);
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
      setPanel(null);
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
  const create = async (title: string, position?: { x: number; y: number }) => {
    try {
      const result = await api<{ node: CanvasNode }>('/conversations', {
        title,
        position,
      });
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
        setPanel('context');
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
    const targetConversation = retryId
      ? state?.turns.find((t) => t.id === retryId)?.conversation_id || conversationId
      : conversationId;
    setBusy(true);
    setPanel(null);
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
    <div className="app-shell canvas-first">
      <header className="board-header">
        <div className="board-identity">
          <Network size={20} />
          <strong>
            context<span>canvas</span>
          </strong>
          <span className="board-divider" />
          <span className="workspace-name">{state.workspace.name}</span>
        </div>
        <div className="board-menu">
          <LocalControl onOpen={() => setLocalDialog(true)} />
          <UpdateControl
            canInstall={!busy && !Object.values(prompts).some((text) => text.trim())}
          />
          <button
            className="mode-pill"
            aria-label="模型與登入"
            disabled={busy}
            onClick={() => setModelDialog(true)}
          >
            <span className="status-dot" />
            {state.provider.demo
              ? '本地演示'
              : state.provider.name === 'codex'
                ? 'ChatGPT / Codex'
                : state.provider.model || '待配置模型'}
          </button>
          <button
            className="icon-button"
            aria-label="备份与恢复"
            title="备份与恢复"
            disabled={busy}
            onClick={() => setProjectDialog(true)}
          >
            <FolderArchive size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="使用帮助"
            title="使用帮助"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <main className="canvas-stage" aria-label="思考畫布">
        <ReactFlowProvider key={canvasEpoch}>
          <Canvas
            state={state}
            activeNode={activeId}
            selected={selected}
            locate={locate}
            tool={tool}
            onOpen={(node) => {
              open(node);
              moveTo(node.id);
            }}
            onSelect={select}
            onControl={control}
            onCreateAt={(position) => {
              void create('新的提問', position);
            }}
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
            renderContent={(node) => (
              <Focus
                state={state}
                node={node}
                active={node.id === activeId}
                locked={busy}
                prompt={prompts[node.ref_id] || ''}
                budget={budget}
                preview={node.id === activeId ? preview : null}
                busy={busy && draft.conversationId === node.ref_id}
                draft={draft.conversationId === node.ref_id ? draft.text : ''}
                highlight={node.id === activeId ? highlight : null}
                onOpen={() => {
                  open(node);
                  moveTo(node.id);
                }}
                onClose={() => {
                  setActiveId(null);
                  invalidate();
                }}
                onPrompt={(value) => {
                  setPrompts((p) => ({ ...p, [node.ref_id]: value }));
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
                onInspect={(pkg) => {
                  setInspected({ pkg, historical: true });
                  setPanel('context');
                }}
                onRetry={(id) => void generate(id)}
              />
            )}
          />
        </ReactFlowProvider>
        {!state.nodes.length && (
          <div className="board-empty">
            <span className="empty-symbol">
              <Network size={30} strokeWidth={1.4} />
            </span>
            <h1>把想法，攤開來。</h1>
            <p>在畫布上提問，選取文字，讓下一個想法接著生長。</p>
            <button className="primary" onClick={() => setNewDialog(true)}>
              <Plus size={16} />
              開始第一段對話
            </button>
            <small>也可以雙擊空白處，在那裡開始。</small>
          </div>
        )}
      </main>
      <nav className="canvas-tools" aria-label="工作區分頁">
        <button
          className="desktop-tool"
          title="選取工具"
          aria-label="選取工具"
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          className="desktop-tool"
          title="平移工具"
          aria-label="平移工具"
          aria-pressed={tool === 'hand'}
          onClick={() => setTool('hand')}
        >
          <Hand size={18} />
        </button>
        <span className="tool-divider desktop-tool" />
        <button
          className="new-canvas-conversation"
          aria-label="新建对话"
          title="新建对话"
          onClick={() => {
            setNewDialog(true);
          }}
        >
          <Plus size={18} />
          <span>提問</span>
        </button>
        <span className="tool-divider" />
        <button
          aria-label="畫布"
          aria-pressed={panel === null}
          title="回到畫布"
          onClick={() => setPanel(null)}
        >
          <Network size={18} />
          <span>畫布</span>
        </button>
        <button
          aria-label="對話"
          aria-pressed={panel === 'conversations'}
          title="對話列表"
          onClick={() => setPanel(panel === 'conversations' ? null : 'conversations')}
        >
          <MessageSquare size={18} />
          <span>對話</span>
        </button>
        <button
          aria-label="上下文"
          aria-pressed={panel === 'context'}
          title="上下文檢查器"
          onClick={() => setPanel(panel === 'context' ? null : 'context')}
        >
          <ScanLine size={18} />
          <span>上下文{selected.length > 0 ? ` · ${selected.length}` : ''}</span>
        </button>
      </nav>
      {panel && (
        <section
          className={`board-drawer ${panel}`}
          aria-label={panel === 'context' ? '上下文面板' : '對話面板'}
        >
          <button
            className="drawer-close icon-button"
            aria-label="關閉面板"
            onClick={() => setPanel(null)}
          >
            <X size={18} />
          </button>
          {panel === 'context' ? (
            <Inspector
              state={state}
              pkg={inspected?.pkg || null}
              historical={inspected?.historical || false}
              selected={selected}
              onLocate={(id) => {
                setPanel(null);
                moveTo(id);
              }}
            />
          ) : (
            <>
              <h2>對話</h2>
              <p className="drawer-caption">所有思路，都在同一張畫布上。</p>
              <nav className="conversation-list" aria-label="对话列表">
                {state.conversations.map((c) => (
                  <button
                    key={c.id}
                    className={c.id === conversationId ? 'current' : ''}
                    onClick={() => {
                      const n = state.nodes.find(
                        (n) => n.ref_type === 'conversation' && n.ref_id === c.id,
                      );
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
                ))}
              </nav>
              {!state.conversations.length && (
                <p className="drawer-caption">點擊下方「提問」，開始第一段對話。</p>
              )}
            </>
          )}
        </section>
      )}
      {modelDialog && (
        <ModelDialog
          provider={state.provider.name}
          onClose={() => setModelDialog(false)}
          onChanged={async () => {
            invalidate();
            await refresh();
          }}
        />
      )}
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
                  <strong>提出一个问题</strong>雙擊畫布空白處建立對話；回答會直接出現在卡片裡。
                </span>
              </li>
              <li>
                <GitBranch size={18} />
                <span>
                  <strong>选中文字，长出分支</strong>
                  在任何卡片選取文字，點「延伸提問」建立相連的分支，原文與來源會一起保留。
                </span>
              </li>
              <li>
                <ScanLine size={18} />
                <span>
                  <strong>决定模型会看到什么</strong>
                  選擇、固定或排除卡片，需要時打開下方的上下文檢查器。
                </span>
              </li>
            </ol>
            <p className="quiet-note">
              示範模式不呼叫 AI。點擊上方「模型與登入」可連接 ChatGPT 帳號或選擇 API 模式。
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </section>
        </div>
      )}
      {projectDialog && (
        <ProjectDialog
          onClose={() => setProjectDialog(false)}
          onImported={async () => {
            if (viewportTimer.current) clearTimeout(viewportTimer.current);
            invalidate();
            setActiveId(null);
            setSelected([]);
            setPrompts({});
            setInspected(null);
            setHighlight(null);
            setLocate(null);
            await refresh();
            setCanvasEpoch((epoch) => epoch + 1);
            setProjectDialog(false);
          }}
        />
      )}
      {localDialog && (
        <LocalDialog
          onClose={() => setLocalDialog(false)}
          contextId={preview?.sendable ? preview.context_set_id : undefined}
          onUseResult={async (text) => {
            let node = active?.ref_type === 'conversation' ? active : null;
            if (!node) {
              const created = await api<{ node: CanvasNode }>('/conversations', {
                title: '本地任務記錄',
              });
              await refresh();
              node = created.node;
              setActiveId(node.id);
              moveTo(node.id);
            }
            const refId = node.ref_id;
            setPrompts((previous) => ({
              ...previous,
              [refId]: [previous[refId], text].filter(Boolean).join('\n\n'),
            }));
            invalidate();
          }}
        />
      )}
    </div>
  );
}
