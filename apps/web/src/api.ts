import type { AppSnapshot } from '@acc/domain';

export type ClientState = AppSnapshot & {
  provider: { name: string; model: string; demo: boolean };
};
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
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || '请求失败');
  return data as T;
}
export async function streamAnswer(
  path: '/answer' | '/retry',
  body: object,
  onDraft: (text: string) => void,
) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '发送失败');
  }
  if (!response.body) throw new Error('回答连接已断开');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; text?: string; message?: string };
      if (event.type === 'draft') onDraft(event.text || '');
      if (event.type === 'error') throw new Error(event.message || '生成失败');
      if (event.type === 'complete') complete = true;
    }
  }
  if (!complete) throw new Error('连接中断，请刷新查看已保存的回答状态。');
}
