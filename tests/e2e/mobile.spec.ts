import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('phone layout supports conversation, context inspection, touch selection, persistence and home-screen metadata', async ({
  page,
}) => {
  await page.goto('/');
  const tabs = page.getByRole('navigation', { name: '工作區分頁' });
  await expect(tabs).toBeVisible();
  await page.getByRole('button', { name: '新建对话', exact: true }).last().tap();
  const title = `手機驗收 ${Date.now()}`;
  await page.getByLabel('给这段对话起个名字').fill(title);
  await page.getByRole('button', { name: '创建对话' }).tap();
  await page.getByLabel('你的问题', { exact: true }).fill('手機上的上下文');
  await page.getByRole('button', { name: '预览上下文', exact: true }).tap();
  await tabs.getByRole('button', { name: '上下文', exact: true }).tap();
  await expect(page.getByText('上下文已编译 · 等待发送')).toBeVisible();
  await tabs.getByRole('button', { name: '畫布', exact: true }).tap();
  await page.getByRole('button', { name: '发送此上下文' }).tap();
  const block = page.getByTestId('turn-assistant').last().getByTestId('content-block');
  await expect(block).toContainText('本地演示 · 未调用 AI');
  await block.evaluate((el) => {
    const text = el.firstChild!;
    const start = text.textContent!.indexOf('让上下文可见');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: '摘录并分支' }).tap();
  await expect(page.getByText('源自摘录')).toBeVisible();
  await page.reload();
  await tabs.getByRole('button', { name: '對話', exact: true }).tap();
  await page
    .getByRole('navigation', { name: '对话列表' })
    .getByRole('button', { name: title, exact: true })
    .tap();
  await expect(page.getByTestId('turn-assistant').last()).toContainText('本地演示');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await page.screenshot({ path: 'test-results/mobile-conversation.png' });
});

test('device login UI polls official authorization status and selects Codex without browser credentials', async ({
  page,
}) => {
  let connected = false;
  let pending = false;
  const account = () => ({
    connected,
    account: connected ? { email: 'example@example.test', plan: 'plus' } : null,
    login:
      pending && !connected
        ? {
            status: 'pending',
            userCode: 'TEST-1234',
            verificationUrl: 'https://auth.openai.com/codex/device',
          }
        : { status: connected ? 'complete' : 'idle' },
  });
  await page.route('**/api/models/codex', (route) => route.fulfill({ json: account() }));
  await page.route('**/api/models/codex/login', (route) => {
    pending = true;
    return route.fulfill({ json: account() });
  });
  await page.route('**/api/models/select', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'codex' });
    await route.fulfill({ json: { provider: 'codex', model: 'test-model' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).tap();
  await page.getByRole('button', { name: '使用 ChatGPT 帳號登入', exact: true }).tap();
  await expect(page.getByText('TEST-1234')).toBeVisible();
  await expect(page.getByRole('link', { name: /前往 ChatGPT/ })).toHaveAttribute(
    'href',
    'https://auth.openai.com/codex/device',
  );
  connected = true;
  await expect(page.getByText(/已連接 · example/)).toBeVisible();
  await page.getByLabel('回答模式').selectOption('codex');
  await page.getByRole('button', { name: '使用此模式', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '模型與登入' })).not.toBeVisible();
});

test('workspace authentication gate hides conversations until login and handles an expired session', async ({
  page,
}) => {
  let authenticated = false;
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { required: true, authenticated } }),
  );
  await page.route('**/api/session/login', async (route) => {
    const correct = route.request().postDataJSON().password === 'test-workspace-password';
    if (correct) authenticated = true;
    await route.fulfill({
      status: correct ? 200 : 401,
      json: correct ? { ok: true } : { message: '工作區密碼不正確。' },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '登入你的工作區' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '工作區分頁' })).not.toBeVisible();
  await page.getByLabel('工作區密碼', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '登入工作區', exact: true }).tap();
  await expect(page.getByRole('alert')).toHaveText('工作區密碼不正確。');
  await page.getByLabel('工作區密碼', { exact: true }).fill('test-workspace-password');
  await page.getByRole('button', { name: '登入工作區', exact: true }).tap();
  await expect(page.getByRole('navigation', { name: '工作區分頁' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('canvas-session-expired')));
  await expect(page.getByRole('heading', { name: '登入你的工作區' })).toBeVisible();
});
