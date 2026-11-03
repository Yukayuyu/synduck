import { test, expect } from '@playwright/test';

test('imports at the right-click canvas coordinate after zoom/pan and clears the point for toolbar imports', async ({
  page,
  request,
}) => {
  await request.patch('/api/workspace', {
    data: { viewport: { x: 19200, y: 19900, zoom: 0.7 } },
  });
  await page.goto('/');
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  const point = { x: 650, y: 240 };
  const expected = await page.locator('.react-flow').evaluate((element, point) => {
    const rect = element.getBoundingClientRect();
    const transform = new DOMMatrixReadOnly(
      getComputedStyle(element.querySelector('.react-flow__viewport')!).transform,
    );
    return {
      x: (point.x - rect.left - transform.e) / transform.a,
      y: (point.y - rect.top - transform.f) / transform.d,
    };
  }, point);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menuitem', { name: '在這裡匯入參考', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '匯入參考' });
  await dialog.getByLabel('參考文字').fill('指定畫布位置的參考。');
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/references') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '匯入畫布' }).click();
  const result = await (await uploaded).json();
  expect(result.node.x).toBeCloseTo(expected.x, 4);
  expect(result.node.y).toBeCloseTo(expected.y, 4);
  await page.reload();
  const persisted = await (await request.get('/api/state')).json();
  expect(persisted.nodes.find((node: { id: string }) => node.id === result.node.id).x).toBeCloseTo(
    expected.x,
    4,
  );
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  // Cancel a second context import, then use the toolbar without inheriting its point.
  await page.mouse.click(1100, 160, { button: 'right' });
  await page.getByRole('menuitem', { name: '在這裡匯入參考', exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '匯入參考', exact: true }).click();
  await dialog.getByLabel('選擇文件').setInputFiles({
    name: 'position.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Toolbar reference.'),
  });
  const toolbar = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/references') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '匯入畫布' }).click();
  const response = await toolbar;
  expect(response.request().postDataJSON().position).toBeUndefined();
  expect((await response.json()).block.text_content).toBe('Toolbar reference.');
});
