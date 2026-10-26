import { useEffect, useState } from 'react';
import { Plus, Trash2, Plug, Monitor } from 'lucide-react';
import { useApi } from './api';
import type { McpServer } from '../../../packages/local-runtime/src/mcp';
import type { DesktopWindow } from '../../../packages/local-runtime/src/desktop';
import type { LocalTask } from '../../../packages/local-runtime/src/executor';
import { FrameImage } from './TaskTrace';
export type Integrations = {
  mcp: (McpServer & {
    connected: boolean;
    tools: { name: string; description?: string; inputSchema: unknown }[];
  })[];
  desktop: { enabled: boolean; window_id: string; available: boolean; reason: string };
};
export function IntegrationSettings({
  integrations,
  busy,
  onChanged,
  onTask,
}: {
  integrations: Integrations;
  busy: boolean;
  onChanged: () => Promise<void>;
  onTask: (id: string) => Promise<void>;
}) {
  const api = useApi();

  const [servers, setServers] = useState<McpServer[]>(() =>
    integrations.mcp.map(({ connected: _, tools: __, ...server }) => server),
  );
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [windowId, setWindowId] = useState(integrations.desktop.window_id);
  const [enabled, setEnabled] = useState(integrations.desktop.enabled);
  const [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const run = async (operation: () => Promise<unknown>) => {
    setWorking(true);
    setError('');
    try {
      await operation();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定失敗');
    } finally {
      setWorking(false);
    }
  };
  const patch = (index: number, value: Partial<McpServer>) =>
    setServers((previous) =>
      previous.map((server, i) => (i === index ? ({ ...server, ...value } as McpServer) : server)),
    );
  return (
    <div className="integration-settings">
      {error && <p role="alert">{error}</p>}
      <section>
        <h3>
          <Plug size={17} />
          MCP 服務
        </h3>
        <p className="quiet-note">
          啟用可信的服務。stdio 程式以後端帳戶執行；密鑰只在後端 .env，以 MCP_ 開頭的變數引用。
        </p>
        {servers.map((server, index) => (
          <div className="mcp-server" key={server.id}>
            <div className="mcp-server-heading">
              <input
                aria-label={'MCP 服務名稱 ' + (index + 1)}
                value={server.name}
                disabled={busy}
                onChange={(e) => patch(index, { name: e.target.value })}
              />
              <label className="runtime-check">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  disabled={busy}
                  onChange={(e) => patch(index, { enabled: e.target.checked })}
                />
                啟用
              </label>
              <button
                aria-label={'移除 MCP ' + server.name}
                disabled={busy}
                onClick={() => setServers((previous) => previous.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <label>
              連接方式
              <select
                aria-label={'MCP 連接方式 ' + (index + 1)}
                value={server.transport}
                disabled={busy}
                onChange={(e) => {
                  const base = { id: server.id, name: server.name, enabled: server.enabled };
                  setServers((previous) =>
                    previous.map((entry, i) =>
                      i !== index
                        ? entry
                        : e.target.value === 'stdio'
                          ? { ...base, transport: 'stdio', command: '', args: [], env_keys: [] }
                          : { ...base, transport: 'http', url: '' },
                    ),
                  );
                }}
              >
                <option value="stdio">本地 stdio</option>
                <option value="http">遠端 Streamable HTTP</option>
              </select>
            </label>
            {server.transport === 'stdio' ? (
              <>
                <label>
                  啟動程式
                  <input
                    aria-label={'MCP 啟動程式 ' + (index + 1)}
                    value={server.command}
                    disabled={busy}
                    onChange={(e) => patch(index, { command: e.target.value })}
                    placeholder="npx"
                  />
                </label>
                <label>
                  參數（JSON 陣列）
                  <input
                    aria-label={'MCP 啟動參數 ' + (index + 1)}
                    defaultValue={JSON.stringify(server.args)}
                    disabled={busy}
                    onBlur={(e) => {
                      try {
                        const args: unknown = JSON.parse(e.target.value);
                        if (!Array.isArray(args) || args.some((item) => typeof item !== 'string'))
                          throw new Error();
                        patch(index, { args });
                        setError('');
                      } catch {
                        setError('啟動參數需要 JSON 字串陣列，例如 ["--yes", "套件名稱"]。');
                      }
                    }}
                  />
                </label>
                <label>
                  環境變數名稱（逗號分隔）
                  <input
                    value={server.env_keys.join(', ')}
                    disabled={busy}
                    onChange={(e) =>
                      patch(index, {
                        env_keys: e.target.value
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="MCP_SERVICE_TOKEN"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  MCP 網址
                  <input
                    aria-label={'MCP 網址 ' + (index + 1)}
                    value={server.url}
                    disabled={busy}
                    onChange={(e) => patch(index, { url: e.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </label>
                <label>
                  Bearer token 的後端變數名称
                  <input
                    value={server.token_env || ''}
                    disabled={busy}
                    onChange={(e) => patch(index, { token_env: e.target.value || undefined })}
                    placeholder="MCP_SERVICE_TOKEN"
                  />
                </label>
              </>
            )}
            <small>服務 ID：{server.id}</small>
            <button
              disabled={
                working ||
                busy ||
                !integrations.mcp.some((saved) => saved.id === server.id && saved.enabled)
              }
              onClick={() =>
                void run(async () => {
                  const task = await api<LocalTask>('/local/actions', {
                    tool: 'canvas_mcp_tools',
                    arguments: { server_id: server.id },
                  });
                  await onTask(task.id);
                })
              }
            >
              提出連接與探索工具
            </button>
          </div>
        ))}
        <div className="integration-actions">
          <button
            disabled={busy || servers.length >= 10}
            onClick={() =>
              setServers((previous) => [
                ...previous,
                {
                  id: 'mcp-' + crypto.randomUUID().slice(0, 8),
                  name: 'MCP 服務',
                  enabled: false,
                  transport: 'stdio',
                  command: 'npx',
                  args: [],
                  env_keys: [],
                },
              ])
            }
          >
            <Plus size={14} />
            新增 MCP
          </button>
          <button
            disabled={busy || servers.length >= 10}
            onClick={() =>
              setServers((previous) => [
                ...previous,
                {
                  id: 'browser-' + crypto.randomUUID().slice(0, 8),
                  name: 'Playwright 瀏覽器',
                  enabled: false,
                  transport: 'stdio',
                  command: 'npx',
                  args: ['--yes', '@playwright/mcp@0.0.83', '--browser', 'chrome'],
                  env_keys: [],
                },
              ])
            }
          >
            新增瀏覽器 MCP 預設
          </button>
          <button
            disabled={working || busy || !!error}
            onClick={() => void run(() => api('/local/mcp/configure', { servers }))}
          >
            保存 MCP 設定
          </button>
        </div>
      </section>
      <section>
        <h3>
          <Monitor size={17} />
          桌面控制
        </h3>
        {!integrations.desktop.available ? (
          <p>{integrations.desktop.reason}</p>
        ) : (
          <>
            <p className="quiet-note">
              選擇後端 Windows
              的應用視窗。每次觀察與操作需確認，操作時會切換到該視窗。重新啟動後須重新啟用。
            </p>
            <button
              disabled={working || busy}
              onClick={() => void run(async () => setWindows(await api('/local/desktop/windows')))}
            >
              刷新可操作視窗
            </button>
            <label>
              目標視窗
              <select
                aria-label="桌面目標視窗"
                value={windowId}
                disabled={busy}
                onChange={(e) => setWindowId(e.target.value)}
              >
                <option value="">選擇視窗</option>
                {windows.map((window) => (
                  <option key={window.id} value={window.id}>
                    {window.title} · PID {window.process_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="runtime-check">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              啟用這個視窗的桌面控制
            </label>
            <button
              disabled={working || busy}
              onClick={() =>
                void run(() => api('/local/desktop/configure', { enabled, window_id: windowId }))
              }
            >
              保存桌面設定
            </button>
          </>
        )}
      </section>
    </div>
  );
}
export function ManualIntegrations({
  integrations,
  task,
  busy,
  onTask,
}: {
  integrations: Integrations;
  task: LocalTask | null;
  busy: boolean;
  onTask: (id: string) => Promise<void>;
}) {
  const api = useApi();

  const [mode, setMode] = useState<'mcp' | 'desktop'>('desktop');
  const [serverId, setServerId] = useState(''),
    [tool, setTool] = useState(''),
    [args, setArgs] = useState('{}');
  const [operation, setOperation] = useState('capture'),
    [text, setText] = useState(''),
    [key, setKey] = useState('Enter');
  const [point, setPoint] = useState({ x: 0, y: 0 }),
    [delta, setDelta] = useState(1);
  const [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const server = integrations.mcp.find((server) => server.id === serverId);
  const frame = task?.actions
    .flatMap((action) => [action.desktop?.before, action.desktop?.after])
    .filter((frame) => !!frame)
    .at(-1);
  const continuation =
    task?.kind === 'manual' && task.actions.some((action) => action.tool === 'canvas_desktop');
  const submit = async () => {
    setWorking(true);
    setError('');
    try {
      const body =
        mode === 'mcp'
          ? {
              tool: 'canvas_mcp_call',
              arguments: { server_id: serverId, tool, arguments: JSON.parse(args) },
            }
          : {
              tool: 'canvas_desktop',
              arguments: {
                operation,
                ...(operation === 'capture' ? {} : { capture_id: frame?.capture_id }),
                ...(['click', 'double_click', 'scroll'].includes(operation) ? point : {}),
                ...(operation === 'type_text' ? { text } : {}),
                ...(operation === 'key' ? { key } : {}),
                ...(operation === 'scroll' ? { delta } : {}),
              },
              ...(continuation ? { continuation_id: task!.id } : {}),
            };
      const result = await api<LocalTask>('/local/actions', body);
      await onTask(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setWorking(false);
    }
  };
  useEffect(() => {
    if (frame) setPoint({ x: Math.floor(frame.width / 2), y: Math.floor(frame.height / 2) });
  }, [frame?.sha256]);
  return (
    <div className="manual-integrations">
      <h3>整合工具測試</h3>
      <div className="runtime-tabs">
        <button aria-pressed={mode === 'desktop'} onClick={() => setMode('desktop')}>
          桌面
        </button>
        <button aria-pressed={mode === 'mcp'} onClick={() => setMode('mcp')}>
          MCP
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {mode === 'mcp' ? (
        <>
          <label>
            服務
            <select
              aria-label="MCP 測試服務"
              value={serverId}
              onChange={(e) => {
                setServerId(e.target.value);
                setTool('');
              }}
            >
              <option value="">選擇已探索的服務</option>
              {integrations.mcp
                .filter((server) => server.connected)
                .map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            工具
            <select
              aria-label="MCP 測試工具"
              value={tool}
              onChange={(e) => setTool(e.target.value)}
            >
              <option value="">選擇工具</option>
              {server?.tools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
          </label>
          {tool && (
            <details>
              <summary>工具描述與參數格式</summary>
              <p>{server?.tools.find((entry) => entry.name === tool)?.description}</p>
              <pre>
                {JSON.stringify(
                  server?.tools.find((entry) => entry.name === tool)?.inputSchema,
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          <label>
            參數（JSON）
            <textarea
              aria-label="MCP 工具參數"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              readOnly={busy}
            />
          </label>
        </>
      ) : (
        <>
          {!integrations.desktop.enabled ? (
            <p>請在「整合設定」啟用目標視窗。</p>
          ) : (
            <>
              <label>
                桌面操作
                <select
                  aria-label="桌面操作"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                >
                  {Object.entries({
                    capture: '擷取視窗',
                    click: '點擊',
                    double_click: '雙擊',
                    type_text: '輸入文字',
                    key: '快捷鍵',
                    scroll: '捲動',
                  }).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {frame && (
                <>
                  <p className="quiet-note">點選圖片設定座標；這不會立即操作桌面。</p>
                  <FrameImage
                    task={task!.id}
                    image={frame}
                    point={point}
                    onPoint={(x, y) => setPoint({ x, y })}
                  />
                </>
              )}
              {['click', 'double_click', 'scroll'].includes(operation) && (
                <div className="trace-coordinates">
                  <label>
                    X
                    <input
                      type="number"
                      aria-label="桌面 X 座標"
                      value={point.x}
                      onChange={(e) => setPoint({ ...point, x: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      aria-label="桌面 Y 座標"
                      value={point.y}
                      onChange={(e) => setPoint({ ...point, y: Number(e.target.value) })}
                    />
                  </label>
                </div>
              )}
              {operation === 'type_text' && (
                <label>
                  輸入內容
                  <textarea
                    aria-label="桌面輸入內容"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={2000}
                  />
                </label>
              )}
              {operation === 'key' && (
                <label>
                  快捷鍵
                  <select value={key} onChange={(e) => setKey(e.target.value)}>
                    {[
                      'Enter',
                      'Tab',
                      'Escape',
                      'Backspace',
                      'Delete',
                      'ArrowUp',
                      'ArrowDown',
                      'ArrowLeft',
                      'ArrowRight',
                      'Control+A',
                      'Control+C',
                      'Control+V',
                      'Control+Z',
                      'Control+S',
                    ].map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </select>
                </label>
              )}
              {operation === 'scroll' && (
                <label>
                  捲動量
                  <input
                    type="number"
                    min={-5}
                    max={5}
                    value={delta}
                    onChange={(e) => setDelta(Number(e.target.value))}
                  />
                </label>
              )}
            </>
          )}
        </>
      )}
      <button
        className="primary"
        disabled={
          working ||
          busy ||
          (mode === 'mcp'
            ? !server?.connected || !tool
            : !integrations.desktop.enabled ||
              (operation !== 'capture' && (!frame || !continuation)))
        }
        onClick={() => void submit()}
      >
        {mode === 'mcp' ? '提出 MCP 呼叫' : '提出桌面操作'}
      </button>
    </div>
  );
}
