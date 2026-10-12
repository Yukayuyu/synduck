import { useEffect, useState } from 'react';
import { X, Terminal, Check, Square } from 'lucide-react';
import { api } from './api';
import type { LocalTask } from '../../../packages/local-runtime/src/executor';
import { IntegrationSettings, ManualIntegrations, type Integrations } from './IntegrationSettings';
import { TraceSteps } from './TaskTrace';
type LocalState = {
  available: boolean;
  enabled: boolean;
  root: string;
  busy: boolean;
  tasks: LocalTask[];
};
const toolNames: Record<string, string> = {
  canvas_list_files: '列出目錄',
  canvas_read_file: '讀取檔案',
  canvas_write_file: '寫入檔案',
  canvas_run_command: '執行命令',
  canvas_mcp_tools: '探索 MCP 工具',
  canvas_mcp_call: '呼叫 MCP 工具',
  canvas_desktop: '桌面操作',
};
const states: Record<string, string> = {
  running: '執行中',
  waiting: '等待確認',
  complete: '已完成',
  failed: '失敗',
  cancelled: '已停止',
  interrupted: '啟動中斷',
  rejected: '已拒絕',
};
const displayOutput = (text: string) => {
  try {
    const data = JSON.parse(text);
    if (typeof data.stdout === 'string')
      return `結束代碼：${data.exit_code ?? '未正常結束'}${data.timed_out ? ' · 逾時' : ''}${data.cancelled ? ' · 已停止' : ''}\n${data.stdout}${data.stderr ? `\n錯誤輸出：\n${data.stderr}` : ''}${data.truncated ? '\n〔輸出已節錄〕' : ''}`;
    if (typeof data.content === 'string')
      return `${data.path}${data.truncated ? '〔內容已節錄〕' : ''}\n${data.content}`;
    if (Array.isArray(data))
      return data
        .map((entry) => `${entry.type === 'directory' ? '▸' : '·'} ${entry.name}`)
        .join('\n');
    return JSON.stringify(data, null, 2);
  } catch {
    return text;
  }
};
export function LocalDialog({
  onClose,
  onUseResult,
  contextId,
  onShowTrace,
}: {
  onClose: () => void;
  onUseResult: (text: string) => Promise<void>;
  contextId?: string;
  onShowTrace: (id: string) => Promise<void>;
}) {
  const [state, setState] = useState<LocalState | null>(null);
  const [root, setRoot] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'codex' | 'manual' | 'integrations'>('codex');
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const refreshIntegrations = async () => setIntegrations(await api('/local/integrations'));
  const [prompt, setPrompt] = useState('');
  const [attachContext, setAttachContext] = useState(false);
  const [tool, setTool] = useState('canvas_list_files');
  const [path, setPath] = useState('.');
  const [content, setContent] = useState('');
  const [command, setCommand] = useState('');
  const [working, setWorking] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<LocalTask | null>(null);
  useEffect(() => {
    void refreshIntegrations().catch(() => {});
  }, [state?.busy, state?.root, selected?.id, selected?.status]);
  const submitted = async (id: string) => {
    setSelected(null);
    setSelectedId(id);
    await onShowTrace(id);
  };
  useEffect(() => {
    let alive = true;
    const load = async (initial = false) => {
      try {
        const next = await api<LocalState>('/local');
        if (!alive) return;
        setState(next);
        if (initial) {
          setRoot(next.root);
          setEnabled(next.enabled);
        }
        setSelectedId((previous) => previous || next.tasks[0]?.id || '');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '無法讀取本地任務');
      }
    };
    void load(true);
    const timer = setInterval(() => void load(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    const load = () =>
      void api<LocalTask>(`/local/tasks/${selectedId}`)
        .then((task) => {
          if (alive) setSelected(task);
        })
        .catch(() => {});
    load();
    const timer =
      selected && ['complete', 'failed', 'cancelled', 'interrupted'].includes(selected.status)
        ? undefined
        : setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedId, selected?.status]);
  const action = async (operation: () => Promise<unknown>) => {
    setWorking(true);
    setError('');
    try {
      await operation();
      const next = await api<LocalState>('/local');
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal runtime-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="關閉本地任務" onClick={onClose}>
          <X size={18} />
        </button>
        <span className="overline">LOCAL WORKSPACE</span>
        <h2 id="local-title">
          <Terminal size={22} /> 本地任務
        </h2>
        <p className="project-description">
          操作在後端電腦執行。先選擇那台電腦上的專案資料夾；ChatGPT 任務使用已選模型與思考深度。
        </p>
        {error && (
          <p role="alert" className="project-error">
            {error}
          </p>
        )}
        {state?.available === false ? (
          <p>此啟動方式未啟用本地執行器。</p>
        ) : (
          <>
            <div className="runtime-settings">
              <label>
                專案完整路徑
                <input
                  aria-label="本地專案路徑"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                  readOnly={state?.busy}
                  placeholder="例如 C:\Projects\my-app"
                />
              </label>
              <label className="runtime-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  disabled={state?.busy}
                />
                啟用這個專案
              </label>
              <button
                disabled={working || state?.busy}
                onClick={() => void action(() => api('/local/configure', { root, enabled }))}
              >
                保存專案設定
              </button>
            </div>
            <div className="runtime-tabs" role="tablist" aria-label="本地任務模式">
              <button role="tab" aria-selected={tab === 'codex'} onClick={() => setTab('codex')}>
                AI 任務
              </button>
              <button role="tab" aria-selected={tab === 'manual'} onClick={() => setTab('manual')}>
                手動測試
              </button>
              <button
                role="tab"
                aria-selected={tab === 'integrations'}
                onClick={() => setTab('integrations')}
              >
                整合設定
              </button>
            </div>
            {tab === 'codex' ? (
              <div className="runtime-composer">
                <label>
                  要在專案中完成什麼？
                  <textarea
                    aria-label="本地 AI 任務"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    readOnly={state?.busy}
                    placeholder="例如：閱讀 package.json，找出測試指令，再執行測試。"
                  />
                </label>
                <label className="runtime-check">
                  <input
                    type="checkbox"
                    checked={attachContext}
                    onChange={(e) => setAttachContext(e.target.checked)}
                    disabled={!contextId || state?.busy}
                  />
                  附上目前已預覽的畫布上下文
                </label>
                <button
                  className="primary"
                  disabled={working || !state?.enabled || state.busy || !prompt.trim()}
                  onClick={() =>
                    void action(async () => {
                      const task = await api<LocalTask>('/local/tasks', {
                        prompt,
                        ...(attachContext && contextId ? { context_set_id: contextId } : {}),
                      });
                      setSelectedId(task.id);
                      await onShowTrace(task.id);
                    })
                  }
                >
                  開始 AI 任務
                </button>
              </div>
            ) : tab === 'manual' ? (
              <div className="runtime-composer">
                <label>
                  操作
                  <select
                    aria-label="本地操作"
                    value={tool}
                    onChange={(e) => setTool(e.target.value)}
                  >
                    {Object.entries(toolNames)
                      .filter(
                        ([id]) =>
                          !['canvas_mcp_tools', 'canvas_mcp_call', 'canvas_desktop'].includes(id),
                      )
                      .map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                  </select>
                </label>
                {tool !== 'canvas_run_command' && (
                  <label>
                    相對路徑
                    <input
                      aria-label="專案相對路徑"
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                    />
                  </label>
                )}
                {tool === 'canvas_write_file' && (
                  <label>
                    新內容
                    <textarea
                      aria-label="檔案新內容"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </label>
                )}
                {tool === 'canvas_run_command' && (
                  <label>
                    命令
                    <textarea
                      aria-label="本地命令"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="node --version"
                    />
                  </label>
                )}
                <button
                  className="primary"
                  disabled={working || !state?.enabled || state.busy}
                  onClick={() =>
                    void action(async () => {
                      const args =
                        tool === 'canvas_run_command'
                          ? { command, timeout_seconds: 60 }
                          : tool === 'canvas_write_file'
                            ? { path, content }
                            : { path };
                      const task = await api<LocalTask>('/local/actions', {
                        tool,
                        arguments: args,
                      });
                      setSelectedId(task.id);
                      await onShowTrace(task.id);
                    })
                  }
                >
                  提出操作
                </button>
              </div>
            ) : integrations ? (
              <IntegrationSettings
                integrations={integrations}
                busy={!!state?.busy}
                onChanged={refreshIntegrations}
                onTask={submitted}
              />
            ) : (
              <p>正在讀取整合設定…</p>
            )}
            {tab === 'manual' && integrations && (
              <ManualIntegrations
                integrations={integrations}
                task={selected}
                busy={!!state?.busy || !state?.enabled}
                onTask={submitted}
              />
            )}
            <div className="runtime-history">
              <label>
                任務紀錄
                <select
                  aria-label="本地任務紀錄"
                  value={selectedId}
                  onChange={(e) => {
                    setSelected(null);
                    setSelectedId(e.target.value);
                  }}
                >
                  <option value="">選擇任務</option>
                  {state?.tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {states[task.status]} · {task.prompt.slice(0, 48)}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <>
                  <button onClick={() => void action(() => onShowTrace(selected.id))}>
                    在畫布顯示操作紀錄
                  </button>
                  {selected.actions.some(
                    (entry) =>
                      entry.tool === 'canvas_desktop' || entry.tool.startsWith('canvas_mcp'),
                  ) && (
                    <TraceSteps
                      task={selected}
                      onDecision={async (action_id, approved) => {
                        await api('/local/tasks/' + selected.id + '/approve', {
                          action_id,
                          approved,
                        });
                        setSelected(await api('/local/tasks/' + selected.id));
                      }}
                    />
                  )}
                  <div className="runtime-task-heading">
                    <strong>{states[selected.status]}</strong>
                    {selected.model && (
                      <span>
                        {selected.model} · {selected.reasoning_effort || '模型預設'}
                      </span>
                    )}
                    {['running', 'waiting'].includes(selected.status) && (
                      <button
                        disabled={working}
                        onClick={() =>
                          void action(() => api(`/local/tasks/${selected.id}/cancel`, {}))
                        }
                      >
                        <Square size={13} />
                        停止任務
                      </button>
                    )}
                  </div>
                  <code>{selected.project_root}</code>
                  {selected.actions
                    .filter(
                      (entry) =>
                        entry.tool !== 'canvas_desktop' && !entry.tool.startsWith('canvas_mcp'),
                    )
                    .map((entry) => (
                      <article className="runtime-action" key={entry.id}>
                        <strong>
                          {toolNames[entry.tool]} · {states[entry.status]}
                        </strong>
                        <small>操作 {entry.id}</small>
                        {entry.arguments.path !== undefined && (
                          <code>{String(entry.arguments.path)}</code>
                        )}
                        {entry.tool === 'canvas_run_command' && (
                          <>
                            <pre>{String(entry.arguments.command)}</pre>
                            <p className="project-description">
                              命令使用後端電腦的系統帳戶權限。專案資料夾是工作目錄，不是作業系統沙盒。
                            </p>
                          </>
                        )}
                        {entry.tool === 'canvas_write_file' && (
                          <div className="runtime-diff">
                            <div>
                              <span>目前內容</span>
                              <pre>{entry.before ?? '新檔案'}</pre>
                            </div>
                            <div>
                              <span>將寫入的內容</span>
                              <pre>{String(entry.arguments.content)}</pre>
                            </div>
                          </div>
                        )}
                        {entry.status === 'waiting' && (
                          <div className="runtime-approval">
                            <button
                              className="primary"
                              disabled={working}
                              onClick={() =>
                                void action(() =>
                                  api(`/local/tasks/${selected.id}/approve`, {
                                    action_id: entry.id,
                                    approved: true,
                                  }),
                                )
                              }
                            >
                              <Check size={14} />
                              確認這次操作
                            </button>
                            <button
                              disabled={working}
                              onClick={() =>
                                void action(() =>
                                  api(`/local/tasks/${selected.id}/approve`, {
                                    action_id: entry.id,
                                    approved: false,
                                  }),
                                )
                              }
                            >
                              拒絕
                            </button>
                          </div>
                        )}
                        {entry.output && (
                          <pre className="runtime-output">{displayOutput(entry.output)}</pre>
                        )}
                        {entry.model_output && (
                          <details>
                            <summary>本次交回 AI 的工具結果</summary>
                            <pre>{entry.model_output}</pre>
                          </details>
                        )}
                      </article>
                    ))}
                  {selected.answer && <pre className="runtime-answer">{selected.answer}</pre>}
                  {selected.error && <p role="alert">{selected.error}</p>}
                  {['complete', 'failed', 'cancelled', 'interrupted'].includes(selected.status) && (
                    <button
                      disabled={working}
                      onClick={() =>
                        void action(async () => {
                          const text = `本地任務記錄（${selected.id}，${selected.created_at}）\n${selected.prompt}\n狀態：${states[selected.status]}\n${selected.actions.map((entry) => `操作 ${entry.id}：${toolNames[entry.tool]}／${states[entry.status]}\n${entry.output}`).join('\n')}\nAI 回覆：\n${selected.answer}`;
                          await onUseResult(
                            text.slice(0, 4000) +
                              (text.length > 4000
                                ? '\n〔紀錄已節錄，完整內容保存在本地任務紀錄〕'
                                : ''),
                          );
                          onClose();
                        })
                      }
                    >
                      將紀錄加入畫布提問
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
