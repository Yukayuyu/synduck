import { it, expect } from 'vitest';
import { WindowsDesktopDriver } from '../packages/local-runtime/src/desktop';
it.skipIf(process.platform !== 'win32')(
  'compiles the native PowerShell/C# bridge and enumerates windows without desktop input',
  async () => {
    const driver = new WindowsDesktopDriver();
    expect(driver.available).toBe(true);
    const started = Date.now();
    const windows = await driver.windows().catch((cause: unknown) => {
      // CI annotations remain useful even if hosted log downloads are blocked.
      // Only elapsed time and the driver's fixed diagnostic are exposed.
      throw new Error(`Windows bridge enumeration failed after ${Date.now() - started} ms`, {
        cause,
      });
    });
    expect(Array.isArray(windows)).toBe(true);
    expect(
      windows.every((window) => /^\d+$/.test(window.id) && Number.isInteger(window.process_id)),
    ).toBe(true);
  },
  30000,
);
