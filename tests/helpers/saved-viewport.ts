import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ClientState } from '../../apps/web/src/api';

// The camera position is saved after its animation and a debounce. Data saves
// do not flush that write, so reload scenarios must wait for it independently.
export async function waitForSavedViewport(page: Page, request: APIRequestContext) {
  await expect
    .poll(async () => {
      const saved: ClientState = await (await request.get('/api/state')).json();
      const rendered = await page.locator('.react-flow__viewport').evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
      const viewport = saved.workspace.settings.viewport;
      return (['x', 'y', 'zoom'] as const).every(
        (key) => Math.abs(viewport[key] - rendered[key]) < 0.001,
      );
    })
    .toBe(true);
}
