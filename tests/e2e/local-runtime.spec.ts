import { test, expect } from '@playwright/test';

test('approves a real local command and puts its recorded result into a canvas draft', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本地任務', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
  await expect(dialog.getByLabel('本地專案路徑')).not.toHaveValue('');
  await dialog.getByRole('tab', { name: '手動測試' }).click();
  await dialog.getByLabel('本地操作').selectOption('canvas_run_command');
  await dialog.getByLabel('本地命令').fill('node --version');
  await dialog.getByRole('button', { name: '提出操作' }).click();
  const entry = dialog.locator('.runtime-action').first();
  await expect(entry).toContainText('等待確認');
  await expect(entry.locator('.runtime-output')).toHaveCount(0);
  await entry.getByRole('button', { name: '確認這次操作' }).click();
  await expect(entry.locator('.runtime-output')).toContainText('v24.');
  await expect(dialog.locator('.runtime-task-heading')).toContainText('已完成');
  await dialog.getByRole('button', { name: '將紀錄加入畫布提問' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('你的问题', { exact: true })).toHaveValue(
    /本地任務記錄[\s\S]*v24\./,
  );
});

test('rejects a pending write and retains its audit trail after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '本地任務', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地任務', exact: true });
  await dialog.getByRole('tab', { name: '手動測試' }).click();
  await dialog.getByLabel('本地操作').selectOption('canvas_write_file');
  await dialog.getByLabel('專案相對路徑').fill('not-written.txt');
  await dialog.getByLabel('檔案新內容').fill('Pending content');
  await dialog.getByRole('button', { name: '提出操作' }).click();
  const entry = dialog.locator('.runtime-action').first();
  await expect(entry).toContainText('將寫入的內容');
  await entry.getByRole('button', { name: '拒絕', exact: true }).click();
  await expect(entry).toContainText('已拒絕');
  await page.reload();
  await page.getByRole('button', { name: '本地任務', exact: true }).click();
  await expect(page.locator('.runtime-action').first()).toContainText('已拒絕');
});

test('background update notification preserves the editor and blocks install with an unsent draft', async ({
  page,
  request,
}) => {
  let available = false;
  await page.route('**/api/updates', (route) =>
    route.fulfill({
      json: {
        current_version: '0.2.0',
        managed: true,
        phase: available ? 'ready' : 'idle',
        channel: 'preview',
        auto_download: true,
        latest: available ? { version: '0.2.1', notes: 'Test release notification' } : null,
        staged_version: available ? '0.2.1' : null,
        checked_at: null,
        error: null,
        previous_version: null,
      },
    }),
  );
  const created = await (
    await request.post('/api/conversations', {
      data: { title: '更新通知保持焦點', position: { x: -18000, y: -18000 } },
    })
  ).json();
  await request.patch('/api/workspace', {
    data: {
      viewport: {
        x: 80 - created.node.x,
        y: 100 - created.node.y,
        zoom: 1,
      },
    },
  });
  // Install before the component creates its interval so the existing poll is controlled.
  await page.clock.install();
  await page.goto('/');
  const card = page.locator(`.react-flow__node[data-id="${created.node.id}"]`);
  await card.locator('.card-title').click();
  const editor = card.getByLabel('你的问题', { exact: true });
  await editor.fill('更新通知不應打斷正在輸入的問題');
  // Finish the card's navigation animation, then establish the editing baseline.
  await page.clock.runFor(400);
  await editor.focus();
  await expect(editor).toBeFocused();
  available = true;
  await page.clock.fastForward(31000);
  await expect(page.getByRole('button', { name: '版本與更新：有新版', exact: true })).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue('更新通知不應打斷正在輸入的問題');
  await page.getByRole('button', { name: '版本與更新：有新版', exact: true }).click();
  await expect(page.getByRole('button', { name: '安裝新版並重新啟動' })).toBeDisabled();
  await expect(page.getByText('請先送出或清空畫布草稿，並完成回答後再更新。')).toBeVisible();
});
