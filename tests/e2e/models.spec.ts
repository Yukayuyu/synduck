import { test, expect } from '@playwright/test';

test('replaces a stale model with a catalog choice and restores the saved choice after reload', async ({
  page,
}) => {
  let selected = 'gpt-5.4';
  let loads = 0;
  await page.route('**/api/models/codex', (route) =>
    route.fulfill({
      json: {
        connected: true,
        account: { email: 'test@example.test', plan: 'plus' },
        login: { status: 'complete' },
      },
    }),
  );
  await page.route('**/api/models/codex/models', (route) => {
    loads++;
    return route.fulfill({
      json: {
        selected_model: selected,
        models: [
          {
            model: 'current-model',
            name: 'Current Model',
            description: 'Recommended text model',
            is_default: true,
          },
          {
            model: 'alternate-model',
            name: 'Alternate Model',
            description: 'Another text model',
            is_default: false,
          },
        ],
      },
    });
  });
  await page.route('**/api/models/select', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'codex', model: 'alternate-model' });
    selected = route.request().postDataJSON().model;
    await route.fulfill({ json: { provider: 'codex', model: selected } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  const picker = page.getByLabel('Codex 模型', { exact: true });
  await expect(picker).toHaveValue('gpt-5.4');
  await expect(picker.locator('option[value="gpt-5.4"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: '使用此模式', exact: true })).toBeDisabled();
  await picker.selectOption('alternate-model');
  await expect(page.getByText('Another text model', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(picker).toHaveValue('alternate-model');
  await page.getByRole('button', { name: '使用此模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '模型與登入' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  await expect(picker).toHaveValue('alternate-model');
});

test('does not offer guessed models when discovery fails and lets the user retry', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/models/codex', (route) =>
    route.fulfill({
      json: {
        connected: true,
        account: { email: 'test@example.test', plan: 'plus' },
        login: { status: 'complete' },
      },
    }),
  );
  await page.route('**/api/models/codex/models', (route) =>
    route.fulfill(
      fail
        ? {
            status: 502,
            json: { message: '無法取得 Codex 模型列表' },
          }
        : {
            json: {
              selected_model: '',
              models: [
                {
                  model: 'current-model',
                  name: 'Current Model',
                  description: '',
                  is_default: true,
                },
              ],
            },
          },
    ),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  await expect(page.getByRole('alert')).toHaveText('無法取得 Codex 模型列表');
  await expect(page.getByRole('button', { name: '使用此模式', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Codex 模型', { exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect(page.getByLabel('Codex 模型', { exact: true })).toHaveValue('current-model');
  await expect(page.getByRole('button', { name: '使用此模式', exact: true })).toBeEnabled();
});
