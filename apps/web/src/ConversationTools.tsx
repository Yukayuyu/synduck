import { useEffect, useState } from 'react';
import { Terminal, Download } from 'lucide-react';
import { useApi, useCanvasUrl } from './api';
import { TraceSteps, taskStates } from './TaskTrace';
import type { LocalTask } from '../../../packages/local-runtime/src/executor';

// Poll only the active answer. This component updates independently of the
// canvas/editor, so tool progress never remounts the user's input element.
export function ConversationTools({ turnId, streaming }: { turnId: string; streaming: boolean }) {
  const api = useApi();
  const canvasUrl = useCanvasUrl();
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<{ tasks: LocalTask[] }>('/local/turns/' + turnId);
        if (alive) {
          setTasks(result.tasks);
          setError('');
        }
      } catch (e) {
        if (alive && streaming) setError(e instanceof Error ? e.message : '無法取得工具進度');
      } finally {
        if (alive && streaming) timer = setTimeout(() => void load(), 1000);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, turnId, streaming]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {tasks.map((task) => {
        const waiting = task.actions.some((action) => action.status === 'waiting');
        return (
          <details
            key={task.id}
            className="conversation-tools nodrag nopan nowheel"
            open={waiting || undefined}
          >
            <summary>
              <Terminal size={13} /> 工具 · {taskStates[task.status]} · {task.actions.length} 步
            </summary>
            <p className="quiet-note">{task.project_root}</p>
            <TraceSteps
              task={task}
              onDecision={async (action, approved) => {
                await api('/local/tasks/' + task.id + '/approve', { action_id: action, approved });
                const result = await api<{ tasks: LocalTask[] }>('/local/turns/' + turnId);
                setTasks(result.tasks);
              }}
            />
            {task.error && <p role="alert">{task.error}</p>}
            <a href={canvasUrl('/api/local/tasks/' + task.id + '/export')} download>
              <Download size={13} /> 匯出操作紀錄
            </a>
          </details>
        );
      })}
    </>
  );
}
