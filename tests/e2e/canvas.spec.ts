import { test, expect } from '@playwright/test';

test('select text, branch, inspect and exclude context, then persist through reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建对话', exact: true }).last().click();
  await page.getByLabel('给这段对话起个名字').fill(`浏览器验收 ${Date.now()}`);
  await page.getByRole('button', { name: '创建对话' }).click();
  await page.getByLabel('你的问题', { exact: true }).fill('如何让上下文更清晰？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(page.getByText('上下文已编译 · 等待发送')).toBeVisible();
  await page.getByRole('button', { name: '发送此上下文' }).click();
  const answer = page.getByTestId('turn-assistant').last();
  await expect(answer).toContainText('本地演示 · 未调用 AI');
  const block = answer.getByTestId('content-block');
  await block.evaluate((el) => {
    const text = el.firstChild!;
    const start = text.textContent!.indexOf('让上下文可见');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '摘录并分支' }).click();
  await expect(
    page.locator('.focus-panel[data-active="true"]').getByText('源自摘录'),
  ).toBeVisible();
  await page.getByLabel('你的问题', { exact: true }).fill('怎样应用这个原则？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(page.locator('.context-item')).toHaveCount(1);
  await expect(page.locator('.context-item')).toContainText('让上下文可见');
  await page.getByRole('button', { name: '发送此上下文' }).click();
  await expect(page.getByTestId('turn-assistant').last()).toContainText('本轮已包含 1 项上下文');
  await page
    .locator('.focus-panel[data-active="true"]')
    .getByRole('button', { name: /源自摘录/ })
    .click();
  await expect(page.locator('mark')).toHaveText('让上下文可见');
  await page.getByRole('button', { name: '返回画布', exact: true }).click();
  await page.screenshot({ path: 'test-results/canvas-branch.png' });
  const excerpt = page.locator('.canvas-card.excerpt').last();
  await excerpt.getByRole('button', { name: /^卡片操作：/ }).click();
  await page.getByRole('menuitem', { name: '固定上下文', exact: true }).click();
  await expect(excerpt.getByLabel('已固定', { exact: true })).toBeVisible();
  await excerpt.getByRole('button', { name: /^卡片操作：/ }).click();
  await page.getByRole('menuitem', { name: '排除上下文', exact: true }).click();
  await expect(excerpt).toHaveClass(/excluded/);
  await page.reload();
  await expect(page.locator('.canvas-card.excerpt').last()).toHaveClass(/excluded/);
  await page
    .getByRole('navigation', { name: '工作區分頁' })
    .getByRole('button', { name: '對話', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: /分支 · 让上下文可见/ })
    .last()
    .click();
  await page.getByLabel('你的问题', { exact: true }).fill('排除后还有哪些原文？');
  await page.getByLabel('提问选项', { exact: true }).click();
  await page.getByRole('button', { name: '预览上下文', exact: true }).click();
  await expect(
    page.locator('.excluded-item').filter({ hasText: '你明确排除了此内容' }),
  ).toHaveCount(1);
  await expect(
    page.locator('.excluded-item').filter({ hasText: '这条回答依赖已排除的来源，也已排除' }),
  ).toHaveCount(1);
  await expect(page.locator('.context-item').filter({ hasText: '分支来源' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/context-inspector.png' });
});

test('renders over 100 nodes and persists a real drag and viewport', async ({ page, request }) => {
  const initial = await (await request.get('/api/state')).json();
  for (let i = 0; i < 100; i++) {
    const response = await request.post('/api/conversations', {
      data: { title: `规模验收 ${i + 1}` },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/');
  const expectedNodeCount =
    initial.nodes.filter((node: { visibility: string }) => node.visibility !== 'hidden').length +
    100;
  await expect(page.locator('.react-flow__node')).toHaveCount(expectedNodeCount);
  await page.locator('.react-flow__controls-fitview').click();
  const findVisible = () =>
    page.locator('.canvas-stage').evaluate((stage) => {
      const bounds = stage.getBoundingClientRect();
      return [...stage.querySelectorAll<HTMLElement>('.react-flow__node')].find((node) => {
        const box = node.getBoundingClientRect();
        return (
          node.querySelector('.card-title')?.textContent?.includes('规模验收') &&
          box.x > bounds.x + 20 &&
          box.y > bounds.y + 20 &&
          box.right < bounds.right - 20 &&
          box.bottom < bounds.bottom - 100
        );
      })?.dataset.id;
    });
  await expect.poll(findVisible).toBeTruthy();
  const visibleId = (await findVisible())!;
  const before = await (await request.get('/api/state')).json();
  const nodeBefore = before.nodes.find((n: { id: string }) => n.id === visibleId);
  await page
    .getByRole('navigation', { name: '工作區分頁' })
    .getByRole('button', { name: '對話', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: nodeBefore.title, exact: true })
    .click();
  await expect
    .poll(async () => (await page.locator(`[data-id="${visibleId}"]`).boundingBox())?.width)
    .toBeGreaterThan(350);
  await page.locator('.react-flow__controls-zoomout').click();
  await page.locator('.react-flow__controls-zoomout').click();
  await expect
    .poll(async () => (await page.locator(`[data-id="${visibleId}"]`).boundingBox())?.width)
    .toBeLessThan(300);
  const box = await page.locator(`[data-id="${visibleId}"] .card-eyebrow`).boundingBox();
  expect(box).not.toBeNull();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/nodes/${visibleId}`) && r.request().method() === 'PATCH',
  );
  await page.mouse.move(box!.x + 8, box!.y + 3);
  await page.mouse.down();
  await page.mouse.move(box!.x + 48, box!.y + 33, { steps: 8 });
  await page.mouse.up();
  expect((await saved).ok()).toBe(true);
  await expect
    .poll(async () => {
      const state = await (await request.get('/api/state')).json();
      return state.nodes.find((n: { id: string }) => n.id === visibleId).x;
    })
    .not.toBe(nodeBefore.x);
  await expect
    .poll(
      async () => (await (await request.get('/api/state')).json()).workspace.settings.viewport.zoom,
    )
    .toBeLessThan(1);
  const moved = await (await request.get('/api/state')).json();
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(expectedNodeCount);
  const restored = await (await request.get('/api/state')).json();
  expect(restored.nodes.find((n: { id: string }) => n.id === visibleId)).toEqual(
    moved.nodes.find((n: { id: string }) => n.id === visibleId),
  );
});
