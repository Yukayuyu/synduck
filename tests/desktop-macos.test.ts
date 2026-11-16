import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MacDesktopDriver,
  WindowsDesktopDriver,
  platformDesktopDriver,
} from '../packages/local-runtime/src/desktop';

describe('macOS desktop driver', () => {
  it('selects the driver for the host and refuses to run elsewhere', async () => {
    const driver = platformDesktopDriver();
    expect(driver).toBeInstanceOf(
      process.platform === 'darwin' ? MacDesktopDriver : WindowsDesktopDriver,
    );
    const mac = new MacDesktopDriver();
    expect(mac.available).toBe(process.platform === 'darwin');
    if (!mac.available) {
      expect(mac.reason).toContain('macOS');
      await expect(mac.windows()).rejects.toMatchObject({ code: 'desktop_unavailable' });
      await expect(mac.capture('1', AbortSignal.timeout(1000))).rejects.toMatchObject({
        code: 'desktop_unavailable',
      });
    }
  });
  it('keeps the bridge to fixed error codes without echoing host data', () => {
    const bridge = readFileSync(
      new URL('../packages/local-runtime/desktop/macos.js', import.meta.url),
      'utf8',
    );
    // Errors are reported only through fail(code) / bridge_failed.
    expect(bridge.match(/error:/g)).toHaveLength(1);
    expect(bridge).not.toMatch(/error\.message|console\.log|\.stack/);
    for (const code of bridge.matchAll(/fail\('([a-z_]+)'\)/g))
      expect(
        readFileSync(new URL('../packages/local-runtime/src/desktop.ts', import.meta.url), 'utf8'),
      ).toContain(`${code[1]}:`);
  });
});
