import { useEffect, useState } from 'react';
import { X, ExternalLink, KeyRound } from 'lucide-react';
import { useApi } from './api';

type AccountState = {
  connected: boolean;
  account: { email: string | null; plan: string } | null;
  login: {
    status: 'idle' | 'pending' | 'complete' | 'failed';
    verificationUrl?: string;
    userCode?: string;
  };
};
type Diagnostics = {
  model: string;
  last_failure: { code: string; message: string; stage: string; elapsed_ms: number } | null;
};
type ModelList = {
  models: {
    model: string;
    name: string;
    description: string;
    is_default: boolean;
    default_reasoning_effort: string;
    supported_reasoning_efforts: { effort: string; description: string }[];
  }[];
  selected_model: string;
  selected_reasoning_effort: string | null;
};
const effortNames: Record<string, string> = {
  none: '不額外思考',
  minimal: '極低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
  ultra: '超高',
};
const effortLabel = (effort: string) =>
  effortNames[effort] ? `${effortNames[effort]} · ${effort}` : effort;
type ClaudeState = {
  connected: boolean;
  source: 'saved' | 'environment' | null;
  key_hint: string | null;
  model: string;
  models: { model: string; name: string }[];
};
export function ModelDialog({
  provider,
  onClose,
  onChanged,
}: {
  provider: string;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const api = useApi();

  const [account, setAccount] = useState<AccountState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState(provider);
  const [protectedWorkspace, setProtectedWorkspace] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [modelList, setModelList] = useState<ModelList | null>(null);
  const [codexModel, setCodexModel] = useState('');
  const [codexEffort, setCodexEffort] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelRefresh, setModelRefresh] = useState(0);
  const [claude, setClaude] = useState<ClaudeState | null>(null);
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeModel, setClaudeModel] = useState('');
  const loadClaude = () =>
    api<ClaudeState>('/models/claude').then((next) => {
      setClaude(next);
      setClaudeModel(next.model);
    });
  const claudeAction = async (path: string, body: object) => {
    setBusy(true);
    setError('');
    try {
      await api(path, body);
      // The key leaves this page as soon as the backend has it.
      setClaudeKey('');
      await loadClaude();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void loadClaude().catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    void api<AccountState>('/models/codex')
      .then((s) => {
        if (alive) setAccount(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    void api<{ required: boolean }>('/session')
      .then((s) => {
        if (alive) setProtectedWorkspace(s.required);
      })
      .catch(() => {});
    void api<Diagnostics>('/models/codex/diagnostics')
      .then((s) => {
        if (alive) setDiagnostics(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (account?.login.status !== 'pending') return;
    let alive = true;
    const timer = setInterval(() => {
      void api<AccountState>('/models/codex')
        .then((s) => {
          if (alive) setAccount(s);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [account?.login.status]);
  useEffect(() => {
    if (!account?.connected || selection !== 'codex') return;
    let alive = true;
    setLoadingModels(true);
    setModelError('');
    setModelList(null);
    void api<ModelList>('/models/codex/models')
      .then((list) => {
        if (!alive) return;
        setModelList(list);
        setCodexEffort((previous) => previous ?? list.selected_reasoning_effort ?? '');
        setCodexModel(
          (previous) =>
            previous ||
            list.selected_model ||
            list.models.find((entry) => entry.is_default)?.model ||
            list.models[0]?.model ||
            '',
        );
      })
      .catch((e) => {
        if (alive) setModelError(e.message);
      })
      .finally(() => {
        if (alive) setLoadingModels(false);
      });
    return () => {
      alive = false;
    };
  }, [account?.connected, selection, modelRefresh]);
  const chosenModel = modelList?.models.find((entry) => entry.model === codexModel);
  const chosenEffort = chosenModel?.supported_reasoning_efforts.find(
    (option) => option.effort === codexEffort,
  );
  const validEffort = !codexEffort || !!chosenEffort;
  const canSelectCodex = account?.connected && !loadingModels && !!chosenModel && validEffort;
  const action = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      setAccount(await api<AccountState>(`/models/codex/${path}`, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal model-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="關閉模型設定" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="model-title">模型與登入</h2>
        <label htmlFor="provider-choice">回答模式</label>
        <select
          id="provider-choice"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          <option value="demo">示範（不呼叫 AI）</option>
          <option value="codex">ChatGPT / Codex</option>
          <option value="claude">Claude</option>
          <option value="openai">OpenAI API</option>
        </select>
        {selection === 'openai' && <p className="project-description">金鑰在後端 .env 設定。</p>}
        {selection === 'claude' && (
          <div className="account-card">
            {claude?.connected ? (
              <>
                <p>
                  <KeyRound size={13} /> 已連接 · ····{claude.key_hint}
                  {claude.source === 'environment' ? ' · 後端設定' : ''}
                </p>
                <label htmlFor="claude-model-choice">Claude 模型</label>
                <select
                  id="claude-model-choice"
                  value={claudeModel}
                  disabled={busy}
                  onChange={(e) => setClaudeModel(e.target.value)}
                >
                  {!claude.models.some((entry) => entry.model === claudeModel) && (
                    <option value={claudeModel}>{claudeModel}</option>
                  )}
                  {claude.models.map((entry) => (
                    <option key={entry.model} value={entry.model}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                {claude.source === 'saved' && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void claudeAction('/models/claude/disconnect', {})}
                  >
                    移除 API key
                  </button>
                )}
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void claudeAction('/models/claude/connect', { api_key: claudeKey });
                }}
              >
                <label htmlFor="claude-key">Claude API key</label>
                <input
                  id="claude-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-…"
                  value={claudeKey}
                  disabled={busy || !claude}
                  onChange={(e) => setClaudeKey(e.target.value)}
                />
                <button className="secondary" disabled={busy || claudeKey.trim().length < 20}>
                  {busy ? '確認中…' : '連接'}
                </button>
                <a
                  href="https://platform.claude.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  取得 API key <ExternalLink size={12} />
                </a>
              </form>
            )}
          </div>
        )}
        {selection === 'codex' && (
          <div className="account-card">
            <p>
              {account?.connected
                ? `已連接 · ${account.account?.email || 'ChatGPT 帳號'} · ${account.account?.plan || ''}`
                : account
                  ? '尚未連接'
                  : '正在確認連線…'}
            </p>
            {account?.login.status === 'pending' ? (
              <>
                <p>開啟官方授權頁面，登入後輸入以下一次性代碼：</p>
                <code className="device-code">{account.login.userCode}</code>
                <a
                  className="primary"
                  href={account.login.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  前往 ChatGPT 授權 <ExternalLink size={14} />
                </a>
                <p role="status">等待授權完成… 若代碼過期，請取消後重試。</p>
                <button className="secondary" disabled={busy} onClick={() => void action('cancel')}>
                  取消登入
                </button>
              </>
            ) : (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void action(account?.connected ? 'logout' : 'login')}
              >
                {busy ? '處理中…' : account?.connected ? '登出 ChatGPT' : '使用 ChatGPT 帳號登入'}
              </button>
            )}
            {account?.login.status === 'failed' && (
              <p role="alert">
                登入未完成或已過期。請確認 ChatGPT 設定允許 Codex 裝置碼登入後重試。
              </p>
            )}
          </div>
        )}
        {diagnostics?.last_failure && (
          <details>
            <summary>最近一次 Codex 回答失敗的診斷</summary>
            <p>{diagnostics.last_failure.message}</p>
            <p className="project-description">
              模型：{diagnostics.model}
              <br />
              錯誤碼：<code>{diagnostics.last_failure.code}</code>
              <br />
              階段：{diagnostics.last_failure.stage} · 耗時{' '}
              {Math.round(diagnostics.last_failure.elapsed_ms / 1000)} 秒
            </p>
          </details>
        )}
        {selection === 'codex' && (
          <>
            <label htmlFor="codex-model-choice">Codex 模型</label>
            <select
              id="codex-model-choice"
              value={codexModel}
              disabled={busy || loadingModels || !account?.connected || !modelList}
              onChange={(e) => {
                setCodexModel(e.target.value);
                setCodexEffort('');
              }}
            >
              <option value="" disabled>
                {loadingModels ? '正在取得模型…' : '請選擇模型'}
              </option>
              {codexModel && !chosenModel && (
                <option value={codexModel} disabled>
                  {codexModel}（已不在可選列表）
                </option>
              )}
              {modelList?.models.map((entry) => (
                <option key={entry.model} value={entry.model}>
                  {entry.name} · {entry.model}
                  {entry.is_default ? '（官方預設）' : ''}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              disabled={busy || loadingModels || !account?.connected}
              onClick={() => setModelRefresh((value) => value + 1)}
            >
              刷新模型列表
            </button>
            {chosenModel?.description && (
              <p className="project-description">{chosenModel.description}</p>
            )}
            <label htmlFor="codex-effort-choice">思考深度</label>
            <select
              id="codex-effort-choice"
              value={codexEffort ?? ''}
              disabled={busy || loadingModels || !account?.connected || !chosenModel}
              onChange={(e) => setCodexEffort(e.target.value)}
            >
              <option value="">
                模型預設
                {chosenModel ? `（${effortLabel(chosenModel.default_reasoning_effort)}）` : ''}
              </option>
              {codexEffort && !chosenEffort && (
                <option value={codexEffort} disabled>
                  {codexEffort}（已不支援）
                </option>
              )}
              {chosenModel?.supported_reasoning_efforts.map((option) => (
                <option key={option.effort} value={option.effort}>
                  {effortLabel(option.effort)}
                </option>
              ))}
            </select>
            {chosenEffort?.description && (
              <p className="project-description">{chosenEffort.description}</p>
            )}
            {chosenModel && !chosenModel.supported_reasoning_efforts.length && (
              <p className="project-description">此模型未提供可調整的思考深度，使用模型預設。</p>
            )}
            {!loadingModels && modelList && !chosenModel && (
              <p role="alert">目前沒有選中可用模型，請刷新列表並重新選擇。</p>
            )}
            {!loadingModels && chosenModel && !validEffort && (
              <p role="alert">此模型已不支援所選的思考深度，請重新選擇或使用模型預設。</p>
            )}
            {modelError && <p role="alert">{modelError}</p>}
          </>
        )}
        <button
          className="primary"
          disabled={
            busy ||
            (selection === 'codex' && !canSelectCodex) ||
            (selection === 'claude' && !claude?.connected)
          }
          onClick={() => {
            setBusy(true);
            setError('');
            void api('/models/select', {
              provider: selection,
              ...(selection === 'codex'
                ? { model: codexModel, reasoning_effort: codexEffort || null }
                : selection === 'claude'
                  ? { model: claudeModel }
                  : {}),
            })
              .then(onChanged)
              .then(onClose)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          使用此模式
        </button>
        {protectedWorkspace && (
          <button
            className="secondary workspace-logout"
            onClick={() => {
              void api('/session/logout', {})
                .then(() => window.dispatchEvent(new Event('canvas-session-expired')))
                .catch((e) => setError(e.message));
            }}
          >
            登出工作區
          </button>
        )}
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
