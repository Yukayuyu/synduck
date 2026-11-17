import { test, expect } from '@playwright/test';

// The backend is real; only the three Claude account routes are answered here so
// the test never contacts the Claude API or needs a key.
test('connects a Claude API key, picks a model and never shows the key again', async ({ page }) => {
  let connected = false;
  const posted: unknown[] = [];
  const status = () => ({
    connected,
    source: connected ? 'saved' : null,
    key_hint: connected ? 'wxyz' : null,
    model: 'claude-opus-5-5',
    live: connected,
    models: [
      { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    ],
  });
  await page.route('**/api/models/claude', (route) => route.fulfill({ json: status() }));
  await page.route('**/api/models/claude/connect', async (route) => {
    posted.push(route.request().postDataJSON());
    connected = true;
    await route.fulfill({ json: status() });
  });
  await page.route('**/api/models/select', async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { provider: 'claude', model: 'claude-sonnet-5-5' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模型與登入' });
  await dialog.getByLabel('回答模式').selectOption('claude');
  const use = dialog.getByRole('button', { name: '使用此模式', exact: true });
  await expect(use).toBeDisabled();
  // Other modes' sign-in controls stay out of the way.
  await expect(dialog.getByRole('button', { name: '使用 ChatGPT 帳號登入' })).toHaveCount(0);
  const key = dialog.getByLabel('Claude API key', { exact: true });
  await expect(key).toHaveAttribute('type', 'password');
  const connect = dialog.getByRole('button', { name: '連接', exact: true });
  await expect(connect).toBeDisabled();
  await key.fill('sk-ant-test-0123456789abcdefwxyz');
  await page.screenshot({ path: 'test-results/claude-connect.png' });
  await connect.click();
  await expect(dialog.getByText('已連接 · ····wxyz')).toBeVisible();
  await expect(key).toHaveCount(0);
  await expect(dialog).not.toContainText('sk-ant-test');
  await dialog.getByLabel('Claude 模型', { exact: true }).selectOption('claude-sonnet-5-5');
  await page.screenshot({ path: 'test-results/claude-connected.png' });
  await use.click();
  await expect(dialog).toHaveCount(0);
  expect(posted).toEqual([
    { api_key: 'sk-ant-test-0123456789abcdefwxyz' },
    { provider: 'claude', model: 'claude-sonnet-5-5' },
  ]);
});
