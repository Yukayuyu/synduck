import { test, expect } from '@playwright/test';

test('connects GitHub inside an ordinary card without project setup and reuses it in later canvases', async ({
  page,
  request,
}) => {
  const previous = await (await request.get('/api/local')).json();
  await request.post('/api/connections/github/disconnect', { data: {} });
  await request.post('/api/local/configure', { data: { enabled: false, root: '' } });
  await request.post('/api/models/select', {
    data: { provider: 'codex', model: 'test-model', reasoning_effort: 'high' },
  });
  let turn: string | undefined;
  try {
    const root = await (
      await request.post('/api/conversations', {
        data: { title: '连接 GitHub 测试', position: { x: -49000, y: -49000 } },
      })
    ).json();
    const zoom = page.viewportSize()!.width < 600 ? 0.8 : 1;
    await request.patch('/api/workspace', {
      data: { viewport: { x: 24 - root.node.x * zoom, y: 100 - root.node.y * zoom, zoom } },
    });
    await page.goto('/');
    const card = page.locator('.react-flow__node[data-id="' + root.node.id + '"]');
    await card.locator('.card-title').click();
    await card.getByLabel('你的问题', { exact: true }).fill('帮我连接GitHub');
    await card.getByRole('button', { name: '傳送', exact: true }).click();
    const tools = card.locator('.conversation-tools');
    await expect(tools.getByRole('button', { name: '连接 GitHub', exact: true })).toBeInViewport();
    await expect(tools.locator('.trace-pending pre')).toHaveCount(0);
    expect((await (await request.get('/api/local')).json()).enabled).toBe(false);
    const task = (await (await request.get('/api/local')).json()).tasks[0];
    turn = task.conversation_turn_id;
    await tools.getByRole('button', { name: '连接 GitHub', exact: true }).click();
    await expect(tools.getByText('ABCD-1234', { exact: true })).toBeInViewport();
    await expect(tools.getByRole('link', { name: '复制验证码并打开 GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/login/device',
    );
    await page.screenshot({ path: 'test-results/github-login.png', animations: 'disabled' });
    await request.post('/api/test/github/finish', { data: {} });
    await expect(card.getByRole('heading', { name: '连接已完成' })).toBeVisible();
    const other = await (
      await request.post('/api/canvases', { data: { name: '后续 GitHub 项目' } })
    ).json();
    const saved = await (
      await request.get('/api/connections', { headers: { 'x-canvas-id': other.id } })
    ).json();
    expect(saved.github).toMatchObject({ phase: 'connected', login: 'canvas-user' });
    expect(JSON.stringify(saved)).not.toContain('fixture-private');
    await page.reload();
    await page.getByRole('button', { name: '连接账号与服务' }).click();
    await expect(
      page
        .getByRole('dialog', { name: '连接', exact: true })
        .getByText('@canvas-user', { exact: true }),
    ).toBeVisible();
  } finally {
    if (turn) await request.post('/api/answers/' + turn + '/cancel', { data: {} });
    await request.post('/api/connections/github/disconnect', { data: {} });
    await request.post('/api/models/select', { data: { provider: 'demo' } });
    await request.post('/api/local/configure', {
      data: { enabled: previous.enabled, root: previous.root },
    });
  }
});

test('adds an online service with plain fields, completes real OAuth consent and keeps inputs focused while status updates', async ({
  page,
  request,
}) => {
  const fixture = await (await request.get('/api/test/oauth')).json();
  let id: string | undefined;
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '连接账号与服务' }).click();
    const dialog = page.getByRole('dialog', { name: '连接', exact: true });
    await expect(dialog.getByText(/JSON/)).toHaveCount(0);
    await dialog.getByText('添加其他服务', { exact: true }).click();
    const name = dialog.getByLabel('服务名称', { exact: true });
    await name.fill('测试知识库');
    await name.focus();
    await name.evaluate((element) => Reflect.set(window, 'connectionNameInput', element));
    await page.waitForResponse(
      (response) =>
        response.url().includes('/api/connections') && response.request().method() === 'GET',
    );
    await name.press('Comma');
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((element) => Reflect.get(window, 'connectionNameInput') === element),
    ).toBe(true);
    await dialog.getByLabel('连接地址', { exact: true }).fill(fixture.url);
    await dialog.getByRole('button', { name: '添加并连接', exact: true }).click();
    const card = dialog.getByRole('region', { name: '测试知识库, 连接', exact: true });
    const link = card.getByRole('link', { name: '前往 测试知识库, 授权' });
    await expect(link).toBeVisible();
    const state = await (await request.get('/api/connections')).json();
    id = state.services.find((entry: { name: string }) => entry.name === '测试知识库,')?.id;
    const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await expect(popup.getByRole('heading', { name: '测试网页登录' })).toBeVisible();
    await popup.getByRole('link', { name: '允许这次测试登录' }).click();
    await expect(popup.getByText('授权步骤已结束。', { exact: false })).toBeVisible();
    await expect(card.getByText('已连接', { exact: true })).toBeVisible();
    await popup.close();
    await page.reload();
    await page.getByRole('button', { name: '连接账号与服务' }).click();
    await expect(
      page
        .getByRole('region', { name: '测试知识库, 连接', exact: true })
        .getByText('已连接', { exact: true }),
    ).toBeVisible();
  } finally {
    if (id) await request.post('/api/connections/' + id + '/disconnect', { data: {} });
  }
});
