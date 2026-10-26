import type { AppSnapshot, ContextPackage } from '@acc/domain';
import { createContext, useCallback, useContext } from 'react';

export const CanvasApiContext = createContext<string | null>(null);
export interface CanvasEntry {
  id: string;
  name: string;
  created_at: string;
  busy: boolean;
  unavailable?: boolean;
}
export function useApi() {
  const canvasId = useContext(CanvasApiContext);
  return useCallback(
    <T>(path: string, body?: unknown, method = 'POST') => api<T>(path, body, method, canvasId),
    [canvasId],
  );
}
export function useCanvasUrl() {
  const canvasId = useContext(CanvasApiContext);
  return useCallback(
    (path: string) =>
      path +
      (canvasId ? (path.includes('?') ? '&' : '?') + 'canvas=' + encodeURIComponent(canvasId) : ''),
    [canvasId],
  );
}

export type ClientState = AppSnapshot & {
  canvas_id?: string;
  provider: { name: string; model: string; demo: boolean };
};
export function threadStatus(state: Pick<AppSnapshot, 'turns'>, conversationId: string) {
  const latest = state.turns
    .filter((t) => t.conversation_id === conversationId)
    .reduce<
      (typeof state.turns)[number] | undefined
    >((last, turn) => (!last || turn.sequence > last.sequence ? turn : last), undefined);
  if (latest?.status === 'streaming') return '生成中';
  if (latest?.status === 'error') return '需重试';
  return latest?.actor === 'assistant' && latest.status === 'complete' ? '已回答' : '待回答';
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly contextPackage?: ContextPackage,
  ) {
    super(message);
  }
}
export interface GenerationStarted {
  turn_id: string;
  context_set_id: string;
  package?: ContextPackage;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  canvasId?: string | null,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(canvasId ? { 'X-Canvas-ID': canvasId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) window.dispatchEvent(new Event('canvas-session-expired'));
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.message || '请求失败', data.error, data.package);
  return data as T;
}
export async function streamAnswer(
  path: '/send' | '/answer' | '/retry',
  body: object,
  onDraft: (text: string) => void,
  options: {
    signal?: AbortSignal;
    onStarted?: (event: GenerationStarted) => void;
    canvasId?: string | null;
  } = {},
) {
  const response = await fetch(`/api${path}`, {
    signal: options.signal,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.canvasId ? { 'X-Canvas-ID': options.canvasId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('canvas-session-expired'));
    const error = await response.json();
    throw new ApiError(error.message || '发送失败', error.error, error.package);
  }
  if (!response.body) throw new Error('回答连接已断开');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as GenerationStarted & {
          type: string;
          text?: string;
          message?: string;
          code?: string;
        };
        if (event.type === 'started') options.onStarted?.(event);
        if (event.type === 'draft') onDraft(event.text || '');
        if (event.type === 'error') throw new ApiError(event.message || '生成失败', event.code);
        if (event.type === 'complete') complete = true;
      }
    }
    if (!complete) throw new Error('连接中断，请刷新查看已保存的回答状态。');
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
