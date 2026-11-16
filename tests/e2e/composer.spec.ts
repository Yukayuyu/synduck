import { test, expect } from '@playwright/test';

test('Enter sends and empties the box at once; Shift+Enter adds a line', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建对话', exact: true }).last().click();
  const title = `输入框 ${Date.now()}`;
  await page.getByLabel('给这段对话起个名字').fill(title);
  await page.getByRole('button', { name: '创建对话' }).click();
  const card = page.locator('.react-flow__node').filter({ hasText: title });
  const input = card.getByLabel('你的问题', { exact: true });
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('第二行');
  await expect(input).toHaveValue('第一行\n第二行');
  // Hold the request so the state right after sending can be observed.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let body: { prompt: string } | undefined;
  await page.route('**/api/send', async (route) => {
    body = route.request().postDataJSON();
    await held;
    await route.continue();
  });
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(card.locator('.pending-exchange')).toContainText('第一行');
  await expect.poll(() => body?.prompt).toBe('第一行\n第二行');
  release();
  await expect(card.getByTestId('turn-assistant')).toContainText('本地演示');
  await expect(input).toHaveValue('');
  // An empty box does not send.
  await input.press('Enter');
  await expect(card.getByTestId('turn-assistant')).toHaveCount(1);
});

test('puts the question back when sending fails before it starts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建对话', exact: true }).last().click();
  await page.getByLabel('给这段对话起个名字').fill(`发送失败 ${Date.now()}`);
  await page.getByRole('button', { name: '创建对话' }).click();
  const input = page.getByLabel('你的问题', { exact: true });
  await page.route('**/api/send', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable', message: '暂时无法发送' } }),
  );
  await input.fill('不要弄丢这句话');
  await input.press('Enter');
  await expect(input).toHaveValue('不要弄丢这句话');
});
