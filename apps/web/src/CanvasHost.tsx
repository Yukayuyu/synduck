import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Pencil, Check, LoaderCircle, X } from 'lucide-react';
import App from './App';
import { api, CanvasApiContext, type CanvasEntry } from './api';
import { hasDrafts, type CanvasView } from './canvas-session';
import { readAppearance } from './AppearanceDialog';
import type { ExternalOrigin, CanvasNode } from '@acc/domain';
import type { SelectedText } from './Focus';
import './canvas-picker.css';

const activeKey = 'canvas-active-v1';
type Runtime = { busy: boolean; dirty: boolean };

export default function CanvasHost() {
  const [canvases, setCanvases] = useState<CanvasEntry[]>([]);
  const [active, setActive] = useState('');
  const activeRef = useRef('');
  const [mounted, setMounted] = useState<string[]>([]);
  const [runtime, setRuntime] = useState<Record<string, Runtime>>({});
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const views = useRef(new Map<string, CanvasView>());
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'create' | 'rename'>('list');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const [appearance, setAppearance] = useState(readAppearance);
  const [, storageChanged] = useState(0);
  const createId = useRef('');
  const picker = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState<{
    canvasId: string;
    token: string;
    nodeId?: string;
    origin?: ExternalOrigin;
  } | null>(null);
  const [reference, setReference] = useState<{
    sourceId: string;
    selection: SelectedText;
    targetId: string;
    name: string;
    requestId: string;
    newCanvasId: string;
  } | null>(null);
  const load = useCallback(async () => {
    const result = await api<{ canvases: CanvasEntry[]; primary_id: string }>('/canvases');
    setCanvases((previous) =>
      JSON.stringify(previous) === JSON.stringify(result.canvases) ? previous : result.canvases,
    );
    if (!activeRef.current) {
      let saved = '';
      try {
        saved = localStorage.getItem(activeKey) ?? '';
      } catch {
        /* This tab still works. */
      }
      const id =
        result.canvases.find((c) => c.id === saved && !c.unavailable)?.id ?? result.primary_id;
      activeRef.current = id;
      setActive(id);
      setMounted([id]);
    }
    return result;
  }, []);
  useEffect(() => {
    let alive = true;
    void load().catch((e) => {
      if (alive) setError(e.message);
    });
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 10000);
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith('canvas-drafts-v1:')) storageChanged((n) => n + 1);
    };
    window.addEventListener('storage', storage);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('storage', storage);
    };
  }, [load]);
  const switchTo = useCallback(
    (id: string) => {
      const previous = activeRef.current;
      activeRef.current = id;
      setActive(id);
      setMounted((ids) => [
        ...new Set([
          ...ids.filter(
            (key) =>
              key !== previous || runtimeRef.current[key]?.busy || runtimeRef.current[key]?.dirty,
          ),
          id,
        ]),
      ]);
      try {
        localStorage.setItem(activeKey, id);
      } catch {
        /* Selection remains in this tab. */
      }
      setOpen(false);
      setError('');
      setNavigation(null);
      void load().catch(() => {});
    },
    [load],
  );
  const report = useCallback(
    (id: string, state: Runtime) => {
      const previous = runtimeRef.current[id];
      setRuntime((entries) =>
        previous?.busy === state.busy && previous?.dirty === state.dirty
          ? entries
          : { ...entries, [id]: state },
      );
      if (id !== activeRef.current && !state.busy && !state.dirty)
        setMounted((ids) => (ids.includes(id) ? ids.filter((key) => key !== id) : ids));
      if (previous?.busy && !state.busy) void load().catch(() => {});
    },
    [load],
  );
  const rememberView = useCallback((id: string, view: CanvasView) => {
    views.current.set(id, view);
  }, []);
  const catalogChanged = useCallback(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const navigated = useCallback(
    (token: string) => setNavigation((current) => (current?.token === token ? null : current)),
    [],
  );
  const jumpSource = useCallback(
    (origin: ExternalOrigin) => {
      if (!canvases.some((entry) => entry.id === origin.canvas_id && !entry.unavailable)) {
        setError('来源画布不可用，引用快照仍完整保留。');
        return;
      }
      switchTo(origin.canvas_id);
      setNavigation({ canvasId: origin.canvas_id, token: crypto.randomUUID(), origin });
    },
    [canvases, switchTo],
  );
  const chooseReference = (sourceId: string, selection: SelectedText) => {
    setOpen(false);
    setError('');
    setAppearance(readAppearance());
    setReference({
      sourceId,
      selection,
      targetId: canvases.find((entry) => entry.id !== sourceId && !entry.unavailable)?.id ?? 'new',
      name: '',
      requestId: crypto.randomUUID(),
      newCanvasId: crypto.randomUUID(),
    });
  };
  const submitReference = async () => {
    if (
      !reference ||
      workingRef.current ||
      (reference.targetId === 'new' && !reference.name.trim())
    )
      return;
    workingRef.current = true;
    setWorking(true);
    setError('');
    try {
      let target = reference.targetId;
      if (target === 'new')
        target = (
          await api<CanvasEntry>('/canvases', {
            name: reference.name.trim(),
            request_id: reference.newCanvasId,
          })
        ).id;
      const { block, selector } = reference.selection;
      const result = await api<{ node: CanvasNode }>(
        '/canvases/' + encodeURIComponent(target) + '/references',
        {
          request_id: reference.requestId,
          source_block_id: block.id,
          source_content_hash: block.content_hash,
          selector,
        },
        'POST',
        reference.sourceId,
      );
      await load();
      setReference(null);
      switchTo(target);
      setNavigation({ canvasId: target, token: crypto.randomUUID(), nodeId: result.node.id });
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      setError(e instanceof Error ? e.message : '引用失败');
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        picker.current?.contains(event.target as Node) ||
        (event.target as Element).closest('.canvas-picker-trigger')
      )
        return;
      if (!workingRef.current) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const showPicker = () => {
    setMode('list');
    setQuery('');
    setError('');
    setAppearance(readAppearance());
    setOpen((value) => !value);
    void load().catch((e) => setError(e.message));
  };
  const submit = async () => {
    if (workingRef.current || !name.trim()) return;
    workingRef.current = true;
    setWorking(true);
    setError('');
    try {
      if (mode === 'create') {
        const entry = await api<CanvasEntry>('/canvases', {
          name: name.trim(),
          request_id: createId.current,
        });
        await load();
        switchTo(entry.id);
      } else {
        await api(
          '/canvases/' + encodeURIComponent(activeRef.current),
          { name: name.trim() },
          'PATCH',
        );
        await load();
        setMode('list');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };
  const globalBusy = canvases.some((entry) => entry.busy || runtime[entry.id]?.busy);
  const globalDirty = canvases.some(
    (entry) => hasDrafts(entry.id) || (mounted.includes(entry.id) && runtime[entry.id]?.dirty),
  );
  if (!active)
    return (
      <div className="loading-screen">
        <h1>Context Canvas</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={catalogChanged}>重新连接</button>
          </>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  return (
    <>
      {mounted.map((id) => (
        <div className="canvas-host-panel" hidden={id !== active} key={id}>
          <CanvasApiContext.Provider value={id}>
            <App
              canvas={{
                id,
                visible: id === active,
                globalBusy,
                globalDirty,
                initialView: views.current.get(id),
                onView: rememberView,
                onRuntime: report,
                onCatalogChange: catalogChanged,
                navigation: navigation?.canvasId === id ? navigation : undefined,
                onNavigated: navigated,
                onReference: (selection) => chooseReference(id, selection),
                onSourceJump: jumpSource,
                switcher: (
                  <button
                    className="workspace-name canvas-picker-trigger"
                    aria-label="切换画布"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    disabled={working}
                    onClick={showPicker}
                  >
                    <span>{canvases.find((entry) => entry.id === id)?.name ?? '画布'}</span>
                    <ChevronDown size={13} />
                  </button>
                ),
              }}
            />
          </CanvasApiContext.Provider>
        </div>
      ))}
      {open && (
        <div
          ref={picker}
          className="canvas-picker canvas-first nokey"
          data-canvas-style={appearance}
          role="dialog"
          aria-label="画布管理"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' && !event.nativeEvent.isComposing && !working)
              setOpen(false);
          }}
        >
          <div className="canvas-picker-heading">
            <strong>
              {mode === 'list' ? '我的画布' : mode === 'create' ? '新建画布' : '重命名画布'}
            </strong>
            <button aria-label="关闭画布管理" disabled={working} onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          {mode === 'list' ? (
            <>
              <input
                autoFocus
                aria-label="查找画布"
                placeholder="查找画布…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <nav aria-label="画布列表">
                {canvases
                  .filter((entry) =>
                    entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                  )
                  .map((entry) => (
                    <button
                      key={entry.id}
                      aria-label={entry.name}
                      aria-description={
                        entry.unavailable
                          ? '无法打开'
                          : entry.busy || runtime[entry.id]?.busy
                            ? '生成中'
                            : runtime[entry.id]?.dirty || hasDrafts(entry.id)
                              ? '有草稿'
                              : undefined
                      }
                      aria-current={entry.id === active ? 'page' : undefined}
                      disabled={entry.unavailable}
                      onClick={() => switchTo(entry.id)}
                    >
                      <span>{entry.name}</span>
                      {entry.unavailable ? (
                        <small>无法打开</small>
                      ) : entry.busy || runtime[entry.id]?.busy ? (
                        <small>
                          <LoaderCircle size={11} className="spin" />
                          生成中
                        </small>
                      ) : runtime[entry.id]?.dirty || hasDrafts(entry.id) ? (
                        <small>草稿</small>
                      ) : entry.id === active ? (
                        <Check size={14} />
                      ) : null}
                    </button>
                  ))}
              </nav>
              <div className="canvas-picker-actions">
                <button
                  onClick={() => {
                    createId.current = crypto.randomUUID();
                    setMode('create');
                    setName('');
                  }}
                >
                  <Plus size={15} />
                  新建画布
                </button>
                <button
                  onClick={() => {
                    setMode('rename');
                    setName(canvases.find((entry) => entry.id === active)?.name ?? '');
                  }}
                >
                  <Pencil size={14} />
                  重命名当前画布
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label htmlFor="canvas-name">画布名称</label>
              <input
                autoFocus
                id="canvas-name"
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：产品设计"
              />
              <div className="canvas-picker-actions">
                <button type="button" disabled={working} onClick={() => setMode('list')}>
                  返回列表
                </button>
                <button className="primary" disabled={working || !name.trim()}>
                  {working ? '保存中…' : mode === 'create' ? '创建画布' : '保存名称'}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="canvas-picker-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {reference && (
        <div
          className="modal-backdrop canvas-reference-backdrop"
          onClick={() => {
            if (!working) setReference(null);
          }}
        >
          <form
            className="canvas-reference-dialog canvas-first nokey"
            data-canvas-style={appearance}
            role="dialog"
            aria-modal="true"
            aria-label="引用到其他画布"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape' && !event.nativeEvent.isComposing && !working)
                setReference(null);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void submitReference();
            }}
          >
            <h2>引用到画布</h2>
            <blockquote>{reference.selection.selector.exact}</blockquote>
            <label htmlFor="reference-target">目标画布</label>
            <select
              autoFocus
              id="reference-target"
              value={reference.targetId}
              disabled={working}
              onChange={(event) => setReference({ ...reference, targetId: event.target.value })}
            >
              {canvases
                .filter((entry) => entry.id !== reference.sourceId && !entry.unavailable)
                .map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.name}
                  </option>
                ))}
              <option value="new">新建画布…</option>
            </select>
            {reference.targetId === 'new' && (
              <>
                <label htmlFor="reference-new-canvas">新画布名称</label>
                <input
                  id="reference-new-canvas"
                  maxLength={160}
                  value={reference.name}
                  onChange={(event) => setReference({ ...reference, name: event.target.value })}
                  disabled={working}
                />
              </>
            )}
            <p>仅带入选中的原文快照，保留回到来源的入口。</p>
            {error && (
              <p role="alert" className="canvas-picker-error">
                {error}
              </p>
            )}
            <div className="canvas-picker-actions">
              <button type="button" disabled={working} onClick={() => setReference(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={working || (reference.targetId === 'new' && !reference.name.trim())}
              >
                {working ? '引用中…' : '引用并切换'}
              </button>
            </div>
          </form>
        </div>
      )}
      {!open && !reference && error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="关闭画布错误" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
