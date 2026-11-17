import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('connects a project by browsing folders instead of typing a path', async ({
  page,
  request,
}) => {
  const previous = await (await request.get('/api/local')).json();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'picker-e2e-')));
  mkdirSync(join(home, 'workspace', 'my-app', 'src'), { recursive: true });
  writeFileSync(join(home, 'workspace', 'secret.txt'), 'file names are not listed');
  try {
    // Start from a known folder so the test does not depend on the runner's home.
    await request.post('/api/local/configure', { data: { enabled: true, root: home } });
    await page.goto('/');
    await page.getByRole('button', { name: '本地任務', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
    await dialog.getByRole('button', { name: '選擇資料夾', exact: true }).click();
    const picker = dialog.getByRole('group', { name: '選擇專案資料夾' });
    await picker.getByRole('button', { name: 'workspace', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'my-app', exact: true })).toBeVisible();
    await expect(picker).not.toContainText('secret.txt');
    await picker.getByRole('button', { name: 'my-app', exact: true }).click();
    await expect(picker.getByRole('button', { name: 'src', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: '上一層', exact: true }).click();
    await picker.getByRole('button', { name: 'my-app', exact: true }).click();
    await page.screenshot({ path: 'test-results/folder-picker.png' });
    await picker.getByRole('button', { name: '使用「my-app」', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect
      .poll(async () => (await (await request.get('/api/local')).json()).root)
      .toBe(join(home, 'workspace', 'my-app'));
    // The earlier project is offered as a one-click recent choice.
    await dialog.getByRole('button', { name: '選擇資料夾', exact: true }).click();
    await expect(
      dialog.getByLabel('最近使用').getByRole('button', { name: home.split('/').at(-1)! }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '中斷專案', exact: true }).click();
    await expect
      .poll(async () => (await (await request.get('/api/local')).json()).enabled)
      .toBe(false);
  } finally {
    await request.post('/api/local/configure', {
      data: { enabled: previous.enabled, root: previous.root },
    });
    rmSync(home, { recursive: true, force: true });
  }
});
