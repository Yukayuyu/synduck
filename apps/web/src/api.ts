import type { AppSnapshot, ContextPackage } from '@acc/domain';

export type ClientState = AppSnapshot & {
  provider: { name: string; model: string; demo: boolean };
};
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
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (response.status === 401) window.dispatchEvent(new Event('canvas-session-expired'));
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.message || '请求失败', data.error, data.package);
  return data as T;
}
export async function streamAnswer(
  path: '/send' | '/answer' | '/retry',
  body: object,
  onDraft: (text: string) => void,
  options: { signal?: AbortSignal; onStarted?: (event: GenerationStarted) => void } = {},
) {
  const response = await fetch(`/api${path}`, {
    signal: options.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
