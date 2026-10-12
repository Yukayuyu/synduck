import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UpdateManager,
  unpackRelease,
  compareVersions,
} from '../packages/local-runtime/src/updates';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const enc = (text: string) => new TextEncoder().encode(text);
function archive(
  version = '0.2.1',
  extra: Record<string, Uint8Array> = {},
  modify?: (manifest: Record<string, unknown>) => void,
) {
  const files: Record<string, Uint8Array> = {
    'app/package.json': enc(JSON.stringify({ name: 'ai-context-canvas', version })),
    'app/pnpm-lock.yaml': enc('lockfileVersion: 9'),
    'app/apps/web/dist/index.html': enc('<p>New version</p>'),
    'app/apps/api/src/server.ts': enc('export {}'),
    ...extra,
  };
  const manifest: Record<string, unknown> = {
    format: 'context-canvas-package',
    format_version: 1,
    version,
    data_schema_version: 2,
    minimum_launcher: 1,
    files: Object.entries(files).map(([path, bytes]) => ({ path, sha256: sha(bytes) })),
  };
  modify?.(manifest);
  files['package-files.json'] = enc(JSON.stringify(manifest));
  return zipSync(files);
}
async function manager(transport?: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-update-test-'));
  directories.push(root);
  const updates = new UpdateManager(root, '0.2.0', true, transport);
  await updates.initialize();
  return { root, updates };
}

describe('version updates', () => {
  it('orders numeric and prerelease versions without confusing preview 10 with preview 2', () => {
    expect(compareVersions('0.10.0', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0-preview.10', '0.2.0-preview.2')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.2.0-preview.10')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0-preview.2', '0.2.0-preview.10')).toBeLessThan(0);
  });
  it('stages a valid ZIP and preserves application data when preparing files', async () => {
    const { root, updates } = await manager();
    await writeFile(join(root, 'owner-data.txt'), 'Keep owner data');
    const bytes = archive();
    await updates.importArchive(bytes);
    expect(updates.snapshot()).toMatchObject({ phase: 'ready', staged_version: '0.2.1' });
    const prepared = await updates.prepare();
    expect(await readFile(join(prepared.directory, 'apps/web/dist/index.html'), 'utf8')).toBe(
      '<p>New version</p>',
    );
    expect(await readFile(join(root, 'owner-data.txt'), 'utf8')).toBe('Keep owner data');
  });
  it('rejects traversal, private data, unsupported data migrations and missing files', () => {
    expect(() => unpackRelease(archive('0.2.1', { '../escape': enc('bad') }))).toThrow();
    expect(() =>
      unpackRelease(archive('0.2.1', { 'app/data/workspace.sqlite': enc('bad') })),
    ).toThrow();
    expect(() => unpackRelease(archive('0.2.1', { 'app/.env': enc('bad') }))).toThrow();
    expect(() =>
      unpackRelease(
        archive('0.2.1', {}, (manifest) => {
          manifest.data_schema_version = 3;
        }),
      ),
    ).toThrow();
    expect(() =>
      unpackRelease(
        archive('0.2.1', {}, (manifest) => {
          (manifest.files as { sha256: string }[])[0].sha256 = '0'.repeat(64);
        }),
      ),
    ).toThrow();
  });
  it('refuses same-version packages and verifies staged archive again before installation', async () => {
    const { root, updates } = await manager();
    await expect(updates.importArchive(archive('0.2.0'))).rejects.toThrow();
    await updates.importArchive(archive());
    await writeFile(join(root, '.runtime/update-0.2.1.zip'), archive('0.2.2'));
    await expect(updates.prepare()).rejects.toThrow();
    expect(updates.snapshot().current_version).toBe('0.2.0');
  });
  it('retains ready state and update preferences after a restart', async () => {
    const { root, updates } = await manager();
    await updates.configure('stable', false);
    await updates.importArchive(archive());
    const restarted = new UpdateManager(root, '0.2.0', true);
    await restarted.initialize();
    expect(restarted.snapshot()).toMatchObject({
      staged_version: '0.2.1',
      phase: 'ready',
      auto_download: false,
      channel: 'stable',
    });
  });
  it('checks GitHub releases, auto-downloads and validates the actual archive checksum', async () => {
    const bytes = archive();
    const manifest = {
      format: 'context-canvas-update',
      format_version: 1,
      version: '0.2.1',
      channel: 'stable',
      data_schema_version: 2,
      minimum_launcher: 1,
      archive: {
        name: 'ContextCanvas-Windows-0.2.1.zip',
        sha256: sha(bytes),
        bytes: bytes.byteLength,
      },
      notes: 'Fixed local testing',
      published_at: '2026-10-12T00:00:00Z',
    };
    const assets = ['context-canvas-update.json', 'ContextCanvas-Windows-0.2.1.zip'].map(
      (name, index) => ({
        name,
        url: `https://api.github.com/repos/Yukayuyu/synduck/releases/assets/${index}`,
        browser_download_url: `https://github.com/Yukayuyu/synduck/releases/download/canvas-v0.2.1/${name}`,
      }),
    );
    const transport = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('?per_page='))
        return Response.json([
          { draft: false, prerelease: false, tag_name: 'canvas-v0.2.1', assets },
        ]);
      if (String(url).endsWith('.json')) return Response.json(manifest);
      return new Response(new Uint8Array(bytes).buffer);
    }) as unknown as typeof fetch;
    const { updates } = await manager(transport);
    await updates.check();
    expect(updates.snapshot()).toMatchObject({ phase: 'ready', staged_version: '0.2.1' });
    expect(transport).toHaveBeenCalledTimes(3);
    updates.completeInstallation('0.2.1', '0.2.0');
    expect(updates.snapshot()).toMatchObject({
      latest: null,
      previous_version: '0.2.0',
      phase: 'idle',
    });
  });
  it('keeps the current version on network failure and never forwards auth to release redirects', async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const transport = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      calls.push({ url: String(url), authorization: headers.get('Authorization') });
      if (String(url).startsWith('https://api.github.com/'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/test' },
        });
      return new Response('unavailable', { status: 503 });
    }) as unknown as typeof fetch;
    const { root } = await manager();
    const updates = new UpdateManager(root, '0.2.0', true, transport, 'a-private-test-token');
    await updates.initialize();
    await updates.check();
    expect(calls[0].authorization).toBe('Bearer a-private-test-token');
    expect(calls[1].authorization).toBeNull();
    expect(updates.snapshot()).toMatchObject({
      current_version: '0.2.0',
      phase: 'error',
      staged_version: null,
    });
    expect(JSON.stringify(updates.snapshot())).not.toContain('a-private-test-token');
  });
});
