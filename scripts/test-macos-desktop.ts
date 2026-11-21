import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopManager, MacDesktopDriver } from '../packages/local-runtime/src/desktop';
import { EvidenceStore } from '../packages/local-runtime/src/evidence';

// Exercises the real macOS bridge against a real TextEdit window: enumeration,
// capture, then click / paste / shortcut input verified through the clipboard.
// Input needs Accessibility permission; without it the result is reported as
// unverified, and only fails when CANVAS_DESKTOP_REQUIRE_INPUT=1.
if (process.platform !== 'darwin') {
  console.log('macOS desktop check skipped: not running on macOS.');
  process.exit(0);
}
const directory = mkdtempSync(join(tmpdir(), 'synduck-desktop-test-'));
const document = join(directory, 'synduck-desktop-check.txt');
writeFileSync(document, 'existing line\n');
const marker = `synduck-check-${Date.now()}`;
const signal = AbortSignal.timeout(120_000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let opened = false;
try {
  const driver = new MacDesktopDriver();
  assert.equal(driver.available, true);
  const initial = await driver.windows(signal);
  assert.ok(Array.isArray(initial));
  console.log(`Enumerated ${initial.length} windows before opening TextEdit.`);

  spawn('/usr/bin/open', ['-a', 'TextEdit', document], { stdio: 'ignore' });
  opened = true;
  let target: Awaited<ReturnType<typeof driver.windows>>[number] | undefined;
  for (let attempt = 0; attempt < 40 && !target; attempt++) {
    await sleep(500);
    target = (await driver.windows(signal)).find((window) => window.title.includes('TextEdit'));
  }
  assert.ok(target, 'TextEdit window was not found');
  console.log('Found the TextEdit window.');

  const manager = new DesktopManager(
    directory,
    new EvidenceStore(join(directory, 'evidence')),
    driver,
  );
  await manager.initialize();
  await manager.configure(true, target.id);
  const reference = await manager.capture('reference', signal);
  assert.equal(reference.mime, 'image/png');
  assert.ok(reference.width > 40 && reference.width <= 1280);
  assert.ok(reference.height > 40 && reference.height <= 1280);
  assert.ok(reference.bounds.width >= 40 && reference.bounds.height >= 40);
  console.log(
    `Captured ${reference.width}x${reference.height} px for a ${reference.bounds.width}x${reference.bounds.height} pt window.`,
  );

  const act = async (args: Parameters<typeof manager.act>[0]) => {
    await manager.act(args, reference, await manager.capture('before', signal), signal);
    await sleep(300);
  };
  try {
    execFileSync('/usr/bin/pbcopy', { input: 'clipboard-before' });
    await act({
      operation: 'click',
      capture_id: reference.capture_id,
      x: Math.floor(reference.width / 2),
      y: Math.floor(reference.height * 0.6),
    });
    await act({ operation: 'type_text', capture_id: reference.capture_id, text: marker });
    // Typing puts the previous clipboard text back afterwards.
    assert.equal(execFileSync('/usr/bin/pbpaste').toString(), 'clipboard-before');
    await act({ operation: 'key', capture_id: reference.capture_id, key: 'Control+A' });
    await act({ operation: 'key', capture_id: reference.capture_id, key: 'Control+C' });
    // TextEdit fills the clipboard when it handles Command+C, which can lag on slow runners.
    let copied = '';
    for (let attempt = 0; attempt < 20 && !copied.includes(marker); attempt++) {
      copied = execFileSync('/usr/bin/pbpaste').toString();
      if (!copied.includes(marker)) await sleep(250);
    }
    assert.ok(copied.includes(marker), 'typed text was not found in the window');
    await act({
      operation: 'scroll',
      capture_id: reference.capture_id,
      x: Math.floor(reference.width / 2),
      y: Math.floor(reference.height / 2),
      delta: -1,
    });
    console.log('Input verified: click, paste typing, Command shortcuts and scroll.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('輔助使用') || process.env.CANVAS_DESKTOP_REQUIRE_INPUT === '1')
      throw error;
    console.log('INPUT NOT VERIFIED: this host has not granted Accessibility permission.');
  }
} finally {
  if (opened)
    try {
      execFileSync('/usr/bin/pkill', ['-x', 'TextEdit']);
    } catch {
      // TextEdit may already be closed.
    }
  rmSync(directory, { recursive: true, force: true });
}
console.log('macOS desktop check finished.');
