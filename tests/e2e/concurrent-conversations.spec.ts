import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    canvasTestStreams: Record<string, { complete: () => void; fail: () => void; turnId: string }>;
  }
}

test('runs conversations together, isolates stop, and preserves another card’s editor and context preview', async ({
  page,
  request,
}) => {
  const roots = [];
  for (let i = 0; i < 3; i++) {
    roots.push(
      await (
        await request.post('/api/conversations', {
          data: { title: `並行 ${i}`, position: { x: -25000 + i * 700, y: -25000 } },
        })
      ).json(),
    );
  }
  await request.patch('/api/workspace', { data: { viewport: { x: 25060, y: 25060, zoom: 1 } } });
  // A controlled streaming transport keeps both answers open. Backend and Codex
  // concurrency/cancellation are tested separately with real API requests.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.canvasTestStreams = {};
    window.fetch = async (input, init) => {
      const url = String(input);
      if (url === '/api/send') {
        const body = JSON.parse(init!.body as string);
        const contextId = `direct-${body.request_id}`;
        const turnId = `turn-${body.request_id}`;
        const encoder = new TextEncoder();
        let ended = false;
        const stream = new ReadableStream({
          start(controller) {
            const emit = (event: object) =>
              controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
            const finish = (event: object) => {
              if (!ended) {
                ended = true;
                emit(event);
                controller.close();
              }
            };
            window.canvasTestStreams[body.prompt] = {
              turnId,
              complete: () => finish({ type: 'complete', turn_id: turnId }),
              fail: () =>
                finish({
                  type: 'error',
                  code: 'generation_cancelled',
                  message: '已停止這段回答，可使用原上下文重試。',
                }),
            };
            init?.signal?.addEventListener(
              'abort',
              () => window.canvasTestStreams[body.prompt].fail(),
              { once: true },
            );
            emit({ type: 'started', turn_id: turnId, context_set_id: contextId });
            emit({ type: 'draft', text: `獨立輸出 ${body.prompt}` });
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/^\/api\/answers\/.*\/cancel$/.test(url)) {
        const job = Object.values(window.canvasTestStreams).find((job) => url.includes(job.turnId));
        job?.fail();
        return Response.json({ ok: true, already_finished: !job });
      }
      return originalFetch(input, init);
    };
  });
  await page.goto('/');
  const cards = roots.map((root) => page.locator(`.react-flow__node[data-id="${root.node.id}"]`));
  const open = async (index: number) => {
    // The conversation list also locates cards beyond the current viewport.
    await page.getByRole('button', { name: '對話', exact: true }).click();
    await page
      .getByRole('navigation', { name: '对话列表' })
      .getByRole('button', { name: `並行 ${index}`, exact: true })
      .click();
    return cards[index].getByLabel('你的问题', { exact: true });
  };
  const inputA = await open(0);
  await inputA.fill('問題 A');
  await cards[0].getByRole('button', { name: '傳送', exact: true }).click();
  await expect(cards[0]).toContainText('獨立輸出 問題 A');
  const inputB = await open(1);
  await expect(inputB).toBeEditable();
  await inputB.fill('問題 B');
  await cards[1].getByRole('button', { name: '傳送', exact: true }).click();
  await expect(cards[1]).toContainText('獨立輸出 問題 B');
  await expect(cards[1]).not.toContainText('獨立輸出 問題 A');
  const inputC = await open(2);
  await inputC.fill('另一個問題，保留輸入與選區。');
  await cards[2].getByLabel('提问选项', { exact: true }).click();
  await cards[2].getByRole('button', { name: '预览上下文', exact: true }).click();
  await page.getByRole('button', { name: '關閉面板', exact: true }).click();
  await inputC.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(2, 5);
  });
  await page.evaluate(() => window.canvasTestStreams['問題 A'].complete());
  await expect(page.getByRole('button', { name: '模型與登入' })).toBeDisabled(); // B is still active.
  await expect(cards[0].getByRole('button', { name: '停止這段回答' })).toHaveCount(0);
  await expect(inputC).toBeFocused();
  await expect(inputC).toHaveValue('另一個問題，保留輸入與選區。');
  expect(
    await inputC.evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]),
  ).toEqual([2, 5]);
  await expect(cards[2].getByRole('button', { name: '发送此上下文', exact: true })).toBeEnabled();
  // Programmatic click leaves C's editor focus in place while stopping only B.
  await cards[1]
    .getByRole('button', { name: '停止這段回答' })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(cards[1].getByRole('alert')).toContainText('已停止這段回答');
  await expect(inputC).toBeFocused();
  await expect(page.getByRole('button', { name: '模型與登入' })).toBeEnabled();
  const restoredA = await open(0);
  await expect(restoredA).toHaveValue('');
  const restoredB = await open(1);
  await expect(restoredB).toHaveValue('問題 B');
  await expect(restoredB).toBeEditable();
});
