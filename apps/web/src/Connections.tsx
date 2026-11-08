import { useEffect, useState, useRef } from 'react';
import { Plug, Github, Check, X, ExternalLink, LoaderCircle } from 'lucide-react';
import { useApi } from './api';
import type { GitHubStatus } from '../../../packages/local-runtime/src/github';
import type { ConnectionState } from '../../../packages/local-runtime/src/mcp-oauth';

type ConnectionsState = {
  available: boolean;
  github: GitHubStatus;
  services: (ConnectionState & { description?: string; url?: string })[];
};
function useConnections(enabled = true) {
  const api = useApi();
  const [state, setState] = useState<ConnectionsState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await api<ConnectionsState>('/connections');
        if (alive) {
          setState(value);
          setError('');
        }
      } catch {
        if (alive) setError('暂时无法读取连接，请稍后重试。');
      } finally {
        if (alive) timer = setTimeout(() => void load(), 1000);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, enabled]);
  return { state, error };
}
export function ConnectionCard({
  id,
  name,
  inline = false,
  shared,
}: {
  id: string;
  name?: string;
  inline?: boolean;
  shared?: ConnectionsState;
}) {
  const api = useApi();
  const { state: loaded, error: loadError } = useConnections(!shared);
  const state = shared || loaded;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const current =
    id === 'github' ? state?.github : state?.services.find((entry) => entry.id === id);
  const title =
    id === 'github'
      ? 'GitHub'
      : name || (current && 'name' in current ? current.name : undefined) || id;
  const waiting = current?.phase === 'waiting';
  const connected = current?.phase === 'connected';
  const preparing = current?.phase === 'preparing';
  const url =
    current &&
    (id === 'github' && 'verification_url' in current
      ? current.verification_url
      : 'authorization_url' in current
        ? current.authorization_url
        : undefined);
  const code = current && 'user_code' in current ? current.user_code : undefined;
  const loginRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const link = loginRef.current;
    const scroll = link?.closest<HTMLElement>('.conversation-scroll, .modal');
    if (!link || !scroll || !url) return;
    const bounds = scroll.getBoundingClientRect();
    const scale = bounds.height / scroll.offsetHeight;
    if (scale > 0 && link.getBoundingClientRect().bottom > bounds.bottom)
      scroll.scrollTop += (link.getBoundingClientRect().bottom - bounds.bottom) / scale + 12;
  }, [url, code]);
  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setError('');
    try {
      await api('/connections/' + id + '/' + path, body);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={'connection-card ' + (inline ? 'connection-inline' : '')}
      aria-label={title + ' 连接'}
    >
      <div className="connection-heading">
        {id === 'github' ? <Github size={20} /> : <Plug size={20} />}
        <strong>{title}</strong>
        <span className="connection-status">
          {connected ? (
            <>
              <Check size={14} /> 已连接
            </>
          ) : waiting ? (
            '等待你授权'
          ) : preparing ? (
            <>
              <LoaderCircle className="spin" size={14} /> 正在连接…
            </>
          ) : (
            '未连接'
          )}
        </span>
      </div>
      {connected && id === 'github' && state?.github.login && <p>@{state.github.login}</p>}
      {connected && (
        <p className="quiet-note">所有画布都能继续使用这份连接。具体操作仍按任务授权执行。</p>
      )}
      {!connected && !waiting && !preparing && (
        <p className="quiet-note">
          {id === 'github'
            ? '在 GitHub 官方页面登录一次，之后可直接使用仓库，无需配置工具或输入密钥。'
            : state?.services.find((entry) => entry.id === id)?.description ||
              '完成服务的网页登录，之后可以在画布直接提出需求。'}
        </p>
      )}
      {waiting && code && (
        <div className="connection-code">
          <span>在 GitHub 页面输入一次性验证码</span>
          <code>{code}</code>
        </div>
      )}
      {waiting && url && (
        <p className="quiet-note">
          授权页面：{new URL(url).hostname}
          {id === 'github' ? ' · 页面会显示官方登录工具「GitHub CLI」' : ''}
        </p>
      )}
      {waiting && url && (
        <a
          className="button primary connection-login"
          ref={loginRef}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (code) void navigator.clipboard?.writeText(code).catch(() => {});
          }}
        >
          <ExternalLink size={15} />
          {code ? '复制验证码并打开 GitHub' : '前往 ' + title + ' 授权'}
        </a>
      )}
      {waiting && (
        <p className="quiet-note">
          完成后会自动继续。账号信息只在服务方页面输入，不需要发到对话里。
        </p>
      )}
      {(error || loadError || (current?.phase === 'error' && current.message)) && (
        <p role="alert">{error || current?.message || loadError}</p>
      )}
      {!connected && !waiting && !preparing && (
        <button className="primary" disabled={busy} onClick={() => void run('start')}>
          连接 {title}
        </button>
      )}
      {!inline && (connected || waiting || preparing) && (
        <button className="text-button" disabled={busy} onClick={() => void run('disconnect')}>
          {connected ? '仅从 Synduck 断开' : '取消连接'}
        </button>
      )}
      {!inline &&
        id !== 'github' &&
        !connected &&
        !waiting &&
        id !== 'browser' &&
        state?.services.some((entry) => entry.id === id && entry.url) && (
          <details className="connection-key">
            <summary>这个服务提供了访问密钥？</summary>
            <p>只保存在运行 Synduck 的电脑上，不会加入对话。</p>
            <label>
              服务访问密钥
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !key.trim()}
              onClick={async () => {
                await run('key', { key });
                setKey('');
              }}
            >
              保存并连接
            </button>
          </details>
        )}
    </section>
  );
}
export function ConnectionsPanel() {
  const api = useApi();
  const { state, error } = useConnections();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState('');
  if (state && !state.available) return <p>这次启动尚未开启本机连接，请使用安装包启动 Synduck。</p>;
  return (
    <div className="connections-panel">
      <p className="project-description">
        连接一次，以后在任何画布直接提出需求。账号授权保存在运行 Synduck 的电脑上。
      </p>
      {error && <p role="alert">{error}</p>}
      {state && <ConnectionCard id="github" shared={state} />}
      {!state && <p>正在读取连接…</p>}
      {state?.services.map((service) => (
        <ConnectionCard key={service.id} id={service.id} name={service.name} shared={state} />
      ))}
      <details className="connection-add">
        <summary>添加其他服务</summary>
        <p>粘贴服务方提供的连接地址。支持网页登录的服务会自动打开授权入口。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setWorking(true);
            setFailure('');
            try {
              const result = await api<{ id: string }>('/connections/add', {
                name: name.trim() || new URL(url).hostname,
                url: url.trim(),
              });
              await api('/connections/' + result.id + '/start', {});
              setName('');
              setUrl('');
            } catch (e) {
              setFailure(e instanceof Error ? e.message : '请检查服务地址后重试。');
            } finally {
              setWorking(false);
            }
          }}
        >
          <label>
            服务名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的知识库"
            />
          </label>
          <label>
            连接地址
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <button disabled={working || !url.trim()}>添加并连接</button>
          {failure && <p role="alert">{failure}</p>}
        </form>
      </details>
    </div>
  );
}
export function ConnectionsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal connections-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connections-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="关闭连接" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="connections-title">连接</h2>
        <ConnectionsPanel />
      </section>
    </div>
  );
}
export function ConnectionsControl({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="icon-button"
      aria-label="连接账号与服务"
      title="连接账号与服务"
      onClick={onOpen}
    >
      <Plug size={18} />
    </button>
  );
}
