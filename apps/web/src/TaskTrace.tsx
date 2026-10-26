import { useEffect, useState } from 'react';
import {
  Check,
  X,
  Square,
  Download,
  Monitor,
  MousePointer2,
  ArrowRight,
  Clock,
  FileText,
} from 'lucide-react';
import { useApi, useCanvasUrl } from './api';
import type { LocalAction, LocalTask } from '../../../packages/local-runtime/src/executor';
import type { Evidence } from '../../../packages/local-runtime/src/evidence';
import type { Frame } from '../../../packages/local-runtime/src/desktop';
export const taskStates: Record<string, string> = {
  running: '執行中',
  waiting: '等待確認',
  complete: '已完成',
  failed: '失敗',
  cancelled: '已停止',
  interrupted: '啟動中斷',
  rejected: '已拒絕',
};
const operations: Record<string, string> = {
  capture: '觀察畫面',
  click: '點擊',
  double_click: '雙擊',
  type_text: '輸入文字',
  key: '快捷鍵',
  scroll: '捲動',
};
export function actionLabel(action: Pick<LocalAction, 'tool' | 'arguments'>) {
  if (action.tool === 'canvas_desktop')
    return operations[String(action.arguments.operation)] || '桌面操作';
  if (action.tool === 'canvas_mcp_tools') return '探索 MCP 工具';
  if (action.tool === 'canvas_mcp_call') return 'MCP · ' + String(action.arguments.tool);
  return (
    (
      {
        canvas_list_files: '列出目錄',
        canvas_read_file: '讀取檔案',
        canvas_write_file: '寫入檔案',
        canvas_run_command: '執行命令',
      } as Record<string, string>
    )[action.tool] || action.tool
  );
}
export const imageUrl = (task: string, image: Evidence) =>
  '/api/local/tasks/' + task + '/images/' + image.sha256;
export function FrameImage({
  task,
  image,
  point,
  onPoint,
}: {
  task: string;
  image: Evidence;
  point?: { x: number; y: number };
  onPoint?: (x: number, y: number) => void;
}) {
  const canvasUrl = useCanvasUrl();

  return (
    <figure className={'trace-frame ' + (onPoint ? 'pick-point' : '')}>
      <div className="trace-image-surface">
        <img
          src={canvasUrl(imageUrl(task, image))}
          alt={image.label}
          loading="lazy"
          draggable={false}
          onClick={
            onPoint
              ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onPoint(
                    Math.min(
                      image.width - 1,
                      Math.floor(((e.clientX - rect.left) / rect.width) * image.width),
                    ),
                    Math.min(
                      image.height - 1,
                      Math.floor(((e.clientY - rect.top) / rect.height) * image.height),
                    ),
                  );
                }
              : undefined
          }
        />
        {point && (
          <span
            className="trace-point"
            style={{
              left: (point.x / image.width) * 100 + '%',
              top: (point.y / image.height) * 100 + '%',
            }}
            aria-label={'操作座標 ' + point.x + ', ' + point.y}
          >
            <MousePointer2 size={18} />
          </span>
        )}
      </div>
      <figcaption>
        {image.label} · {image.width} × {image.height}
      </figcaption>
    </figure>
  );
}
export function TraceSteps({
  task,
  onDecision,
}: {
  task: LocalTask;
  onDecision?: (action: string, approved: boolean) => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<'compare' | 'before' | 'after'>('compare');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const entry = task.actions[Math.min(index, Math.max(0, task.actions.length - 1))];
  const pending = task.actions.findIndex((action) => action.status === 'waiting');
  useEffect(() => {
    if (pending >= 0) setIndex(pending);
  }, [pending]);
  const decide = async (approved: boolean) => {
    if (!entry || !onDecision) return;
    setWorking(true);
    setError('');
    try {
      await onDecision(entry.id, approved);
    } catch (e) {
      setError(e instanceof Error ? e.message : '確認失敗');
    } finally {
      setWorking(false);
    }
  };
  if (!entry) return <p className="quiet-note">正在建立任務路徑…</p>;
  const before = entry.desktop?.before || entry.desktop?.reference;
  const after = entry.desktop?.after;
  const point = ['click', 'double_click', 'scroll'].includes(String(entry.arguments.operation))
    ? { x: Number(entry.arguments.x), y: Number(entry.arguments.y) }
    : undefined;
  return (
    <div className="trace-review">
      <nav className="trace-path" aria-label="操作路徑">
        {task.actions.map((action, i) => (
          <button
            key={action.id}
            aria-label={'步驟 ' + (i + 1) + ' ' + actionLabel(action)}
            aria-current={i === index ? 'step' : undefined}
            className={'trace-step ' + (i === index ? 'selected ' : '') + action.status}
            onClick={() => setIndex(i)}
          >
            <span>{i + 1}</span>
            {actionLabel(action)}
            <small>{taskStates[action.status]}</small>
          </button>
        ))}
      </nav>
      <div className="trace-step-heading">
        <strong>
          {index + 1}. {actionLabel(entry)}
        </strong>
        <span className={'trace-status ' + entry.status}>{taskStates[entry.status]}</span>
      </div>
      {entry.desktop && (
        <p className="trace-target">
          <Monitor size={14} />
          {(before as Frame)?.window?.title || '選定視窗'}
          {entry.desktop.executed
            ? ' · 輸入已送出'
            : entry.desktop.execution_started
              ? ' · 輸入結果未確認，請查看實際應用'
              : ' · 尚未送出輸入'}
        </p>
      )}
      {entry.status === 'waiting' && (
        <div className="trace-pending">
          <strong>等待確認這一次操作</strong>
          <p>
            {entry.tool === 'canvas_desktop'
              ? '將切換到你選定的視窗；點擊與輸入會操作那個應用。'
              : entry.tool.startsWith('canvas_mcp')
                ? 'MCP 服務以後端帳戶／授權執行，可能修改本機或外部服務。'
                : '請核對實際參數。'}
          </p>
          <pre className="trace-proposal">{JSON.stringify(entry.arguments, null, 2)}</pre>
          {entry.tool === 'canvas_mcp_tools' && (
            <pre>{JSON.stringify(entry.destination, null, 2)}</pre>
          )}
          {entry.tool === 'canvas_write_file' && (
            <details open>
              <summary>原內容</summary>
              <pre>{entry.before ?? '尚不存在'}</pre>
            </details>
          )}
          {onDecision && (
            <div className="runtime-approval">
              <button className="primary" disabled={working} onClick={() => void decide(true)}>
                <Check size={14} />
                確認這次操作
              </button>
              <button disabled={working} onClick={() => void decide(false)}>
                拒絕
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {(before || after) && (
        <>
          <div className="trace-view-tabs" role="group" aria-label="截圖比較">
            {(['compare', 'before', 'after'] as const).map((mode) => (
              <button
                key={mode}
                disabled={mode === 'after' && !after}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
              >
                {{ compare: '前後對照', before: '操作前', after: '操作後' }[mode]}
              </button>
            ))}
          </div>
          <div
            className={'trace-images ' + (view === 'compare' && before && after ? 'compare' : '')}
          >
            {before && view !== 'after' && (
              <FrameImage task={task.id} image={before} point={point} />
            )}
            {after && view !== 'before' && <FrameImage task={task.id} image={after} />}
          </div>
        </>
      )}
      {!entry.desktop &&
        (entry.images || []).map((image) => (
          <FrameImage key={image.sha256} task={task.id} image={image} />
        ))}
      {typeof entry.arguments.text === 'string' && (
        <p className="trace-typed">
          輸入：<q>{entry.arguments.text}</q>
        </p>
      )}
      {typeof entry.arguments.key === 'string' && (
        <p>
          快捷鍵：<kbd>{entry.arguments.key}</kbd>
        </p>
      )}
      <details>
        <summary>
          <FileText size={13} />
          參數、實際結果與來源
        </summary>
        <dl className="trace-provenance">
          <dt>Task ID</dt>
          <dd>{task.id}</dd>
          <dt>Action ID</dt>
          <dd>{entry.id}</dd>
          <dt>建立時間</dt>
          <dd>{entry.created_at}</dd>
          <dt>確認時間</dt>
          <dd>{entry.approved_at || '未確認'}</dd>
          <dt>完成時間</dt>
          <dd>{entry.completed_at || '尚未完成'}</dd>
          <dt>來源截圖</dt>
          <dd>{String(entry.arguments.capture_id || '無')}</dd>
          <dt>模型／深度</dt>
          <dd>
            {task.model || '手動'}／{task.reasoning_effort || '預設'}
          </dd>
          <dt>程式版本</dt>
          <dd>{task.runtime_version || '舊版紀錄'}</dd>
        </dl>
        <pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
        {entry.destination !== undefined && <pre>{JSON.stringify(entry.destination, null, 2)}</pre>}
        {entry.output && <pre>{entry.output}</pre>}
        {(entry.images || []).map((image) => (
          <p className="trace-hash" key={image.sha256}>
            {image.label} SHA-256：{image.sha256}
          </p>
        ))}
        <p>交回 AI 的圖片：{entry.model_images?.join(', ') || '無'}</p>
        {entry.model_output && <pre>{entry.model_output}</pre>}
      </details>
    </div>
  );
}
export function TraceDialog({
  id,
  onClose,
  onContext,
}: {
  id: string;
  onClose: () => void;
  onContext?: (id: string) => void;
}) {
  const api = useApi();
  const canvasUrl = useCanvasUrl();

  const [task, setTask] = useState<LocalTask | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api<LocalTask>('/local/tasks/' + id)
        .then((result) => {
          if (alive) setTask(result);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    const timer = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal trace-modal"
        role="dialog"
        aria-modal="true"
        aria-label="操作回看"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" aria-label="關閉操作回看" onClick={onClose}>
          <X size={18} />
        </button>
        <span className="overline">ACTION TRACE</span>
        <h2>操作回看</h2>
        {error && <p role="alert">{error}</p>}
        {task && (
          <>
            <p className="trace-task-title">
              {task.kind === 'manual'
                ? task.actions.some((action) => action.tool === 'canvas_desktop')
                  ? '桌面操作 · 手動任務'
                  : actionLabel(task.actions[0] || { tool: 'canvas_list_files', arguments: {} }) +
                    ' · 手動任務'
                : task.prompt}
            </p>
            <div className="trace-task-bar">
              <span>
                <Clock size={14} />
                {taskStates[task.status]} · {task.actions.length} 步
              </span>
              <a href={canvasUrl('/api/local/tasks/' + id + '/export')} download>
                <Download size={14} />
                匯出紀錄與圖片
              </a>
              {task.context_package_id && onContext && (
                <button onClick={() => onContext(task.context_package_id!)}>查看輸入上下文</button>
              )}
              {['running', 'waiting'].includes(task.status) && (
                <button
                  onClick={() =>
                    void api('/local/tasks/' + id + '/cancel', {}).catch((e) => setError(e.message))
                  }
                >
                  <Square size={14} />
                  停止任務
                </button>
              )}
            </div>
            <TraceSteps
              task={task}
              onDecision={async (action, approved) => {
                await api('/local/tasks/' + id + '/approve', { action_id: action, approved });
                setTask(await api('/local/tasks/' + id));
              }}
            />
            {task.answer && (
              <div className="trace-final">
                <strong>任務回覆</strong>
                <pre>{task.answer}</pre>
              </div>
            )}
            {task.error && <p role="alert">{task.error}</p>}
            <p className="quiet-note">
              操作紀錄保存在後端。卡片與圖片不會自動加入畫布 AI 的上下文。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
export type CanvasTrace = {
  task_id: string;
  x: number;
  y: number;
  title: string;
  status: string;
  created_at: string;
  context_package_id: string | null;
  count: number;
  steps: {
    id: string;
    tool: LocalAction['tool'];
    status: string;
    arguments?: Record<string, unknown>;
    images: Evidence[];
  }[];
};
export function TraceCardContent({ trace, onOpen }: { trace: CanvasTrace; onOpen: () => void }) {
  const canvasUrl = useCanvasUrl();

  const last = trace.steps.flatMap((step) => step.images).at(-1);
  const waiting = trace.steps.some((step) => step.status === 'waiting');
  return (
    <article className="canvas-trace-card">
      <header className="trace-drag">
        <span>
          <Monitor size={14} />
          操作紀錄
        </span>
        <span className={'trace-status ' + trace.status}>{taskStates[trace.status]}</span>
      </header>
      <button className="trace-card-title nodrag" onClick={onOpen}>
        {trace.title}
        <ArrowRight size={16} />
      </button>
      {last && (
        <button
          className="trace-thumbnail nodrag nopan"
          onClick={onOpen}
          aria-label="開啟截圖與操作路徑"
        >
          <img
            src={canvasUrl(imageUrl(trace.task_id, last))}
            alt={last.label}
            loading="lazy"
            draggable={false}
          />
        </button>
      )}
      <div className="trace-card-path nodrag nopan">
        {trace.steps.slice(-4).map((step, i) => (
          <span key={step.id} className={step.status}>
            <b>{trace.steps.length - Math.min(4, trace.steps.length) + i + 1}</b>
            {actionLabel({ tool: step.tool, arguments: step.arguments || {} })}
            <small>{taskStates[step.status]}</small>
          </span>
        ))}
      </div>
      <footer className="nodrag">
        <span>
          {trace.count} 步 · {new Date(trace.created_at).toLocaleTimeString()}
        </span>
        <button className={waiting ? 'primary' : ''} onClick={onOpen}>
          {waiting ? '查看並確認' : '回看與追溯'}
        </button>
      </footer>
    </article>
  );
}
