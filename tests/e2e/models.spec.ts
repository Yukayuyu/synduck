import { test, expect } from '@playwright/test';

test('replaces a stale model with a catalog choice and restores the saved choice after reload', async ({
  page,
}) => {
  let selected = 'gpt-5.4';
  let savedEffort: string | null = 'high';
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
        selected_reasoning_effort: savedEffort,
        models: [
          {
            model: 'current-model',
            name: 'Current Model',
            description: 'Recommended text model',
            is_default: true,
            default_reasoning_effort: 'medium',
            supported_reasoning_efforts: [
              { effort: 'medium', description: 'Balanced' },
              { effort: 'high', description: 'Deep' },
            ],
          },
          {
            model: 'alternate-model',
            name: 'Alternate Model',
            description: 'Another text model',
            is_default: false,
            default_reasoning_effort: 'low',
            supported_reasoning_efforts: [{ effort: 'low', description: 'Fast answers' }],
          },
        ],
      },
    });
  });
  await page.route('**/api/models/select', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: 'codex',
      model: 'alternate-model',
      reasoning_effort: 'low',
    });
    selected = route.request().postDataJSON().model;
    savedEffort = route.request().postDataJSON().reasoning_effort;
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
  const depth = page.getByLabel('思考深度', { exact: true });
  await expect(depth).toHaveValue('');
  await expect(depth.locator('option[value="high"]')).toHaveCount(0);
  await depth.selectOption('low');
  await expect(page.getByText('Another text model', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(picker).toHaveValue('alternate-model');
  await expect(depth).toHaveValue('low');
  await page.getByRole('button', { name: '使用此模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '模型與登入' })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  await expect(picker).toHaveValue('alternate-model');
  await expect(depth).toHaveValue('low');
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
              selected_reasoning_effort: null,
              models: [
                {
                  model: 'current-model',
                  name: 'Current Model',
                  description: '',
                  is_default: true,
                  default_reasoning_effort: 'medium',
                  supported_reasoning_efforts: [{ effort: 'medium', description: 'Balanced' }],
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

test('requires a new choice if the saved reasoning level is no longer supported', async ({
  page,
}) => {
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
    route.fulfill({
      json: {
        selected_model: 'current-model',
        selected_reasoning_effort: 'high',
        models: [
          {
            model: 'current-model',
            name: 'Current',
            description: '',
            is_default: true,
            default_reasoning_effort: 'medium',
            supported_reasoning_efforts: [{ effort: 'medium', description: 'Balanced' }],
          },
        ],
      },
    }),
  );
  await page.route('**/api/models/select', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: 'codex',
      model: 'current-model',
      reasoning_effort: null,
    });
    await route.fulfill({ json: { provider: 'codex', model: 'current-model' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  const depth = page.getByLabel('思考深度', { exact: true });
  await expect(depth).toHaveValue('high');
  await expect(depth.locator('option[value="high"]')).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveText(
    '此模型已不支援所選的思考深度，請重新選擇或使用模型預設。',
  );
  await expect(page.getByRole('button', { name: '使用此模式', exact: true })).toBeDisabled();
  await depth.selectOption('');
  await page.getByRole('button', { name: '使用此模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '模型與登入' })).toHaveCount(0);
});

test('offers only the model default for a model without adjustable reasoning', async ({ page }) => {
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
    route.fulfill({
      json: {
        selected_model: 'plain-model',
        selected_reasoning_effort: null,
        models: [
          {
            model: 'plain-model',
            name: 'Plain',
            description: '',
            is_default: true,
            default_reasoning_effort: 'none',
            supported_reasoning_efforts: [],
          },
        ],
      },
    }),
  );
  await page.route('**/api/models/select', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      provider: 'codex',
      model: 'plain-model',
      reasoning_effort: null,
    });
    await route.fulfill({ json: { provider: 'codex', model: 'plain-model' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '模型與登入', exact: true }).click();
  await page.getByLabel('回答模式').selectOption('codex');
  const depth = page.getByLabel('思考深度', { exact: true });
  await expect(depth).toHaveValue('');
  await expect(depth.locator('option')).toHaveCount(1);
  await expect(
    page.getByText('此模型未提供可調整的思考深度，使用模型預設。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '使用此模式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '模型與登入' })).toHaveCount(0);
});
