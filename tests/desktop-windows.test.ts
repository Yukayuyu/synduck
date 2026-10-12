import { it, expect } from 'vitest';
import { WindowsDesktopDriver } from '../packages/local-runtime/src/desktop';
it.skipIf(process.platform !== 'win32')(
  'compiles the native PowerShell/C# bridge and enumerates windows without desktop input',
  async () => {
    const driver = new WindowsDesktopDriver();
    expect(driver.available).toBe(true);
    const windows = await driver.windows();
    expect(Array.isArray(windows)).toBe(true);
    expect(
      windows.every((window) => /^\d+$/.test(window.id) && Number.isInteger(window.process_id)),
    ).toBe(true);
  },
  30000,
);
