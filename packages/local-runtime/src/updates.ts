import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { DomainError } from '@acc/domain';
import releaseConfig from '../../../release.config.json';

export const UPDATE_REPOSITORY = releaseConfig.repository;
if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(UPDATE_REPOSITORY))
  throw new Error('Invalid release repository.');

const Version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const invalid = (message: string) => new DomainError('update_invalid', message, 400);
export const PackageManifest = z
  .object({
    format: z.literal('context-canvas-package'),
    format_version: z.literal(1),
    version: Version,
    data_schema_version: z.literal(2),
    minimum_launcher: z.literal(1),
    files: z
      .array(
        z
          .object({ path: z.string().max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict(),
      )
      .min(1)
      .max(3000),
    bootstrap_files: z
      .array(
        z
          .object({
            path: z.enum([
              'Start-ContextCanvas.cmd',
              'Start-ContextCanvas.ps1',
              'Update-Existing.cmd',
              'Update-Existing.ps1',
              'launch.mjs',
            ]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(5)
      .default([]),
  })
  .strict();
const FeedManifest = z
  .object({
    format: z.literal('context-canvas-update'),
    format_version: z.literal(1),
    version: Version,
    channel: z.enum(['stable', 'preview']),
    data_schema_version: z.literal(2),
    minimum_launcher: z.literal(1),
    archive: z
      .object({
        name: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z
          .number()
          .int()
          .positive()
          .max(32 * 1024 * 1024),
      })
      .strict(),
    notes: z.string().max(16000),
    published_at: z.string(),
  })
  .strict();
type Release = z.infer<typeof FeedManifest> & { download_url: string; source: 'github' | 'local' };
export type UpdateState = {
  current_version: string;
  managed: boolean;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  channel: 'stable' | 'preview';
  auto_download: boolean;
  latest: Release | null;
  staged_version: string | null;
  checked_at: string | null;
  error: string | null;
  previous_version: string | null;
};
export function compareVersions(a: string, b: string) {
  const split = (value: string) => {
    const [base, ...suffix] = value.split('-');
    return { base: base.split('.').map(Number), suffix: suffix.join('-') };
  };
  const x = split(a),
    y = split(b);
  for (let i = 0; i < 3; i++) if (x.base[i] !== y.base[i]) return x.base[i] - y.base[i];
  if (!x.suffix || !y.suffix) return x.suffix === y.suffix ? 0 : x.suffix ? -1 : 1;
  const left = x.suffix.split('.'),
    right = y.suffix.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    if (left[i] === right[i]) continue;
    const xn = /^\d+$/.test(left[i]),
      yn = /^\d+$/.test(right[i]);
    if (xn && yn) return Number(left[i]) - Number(right[i]);
    if (xn !== yn) return xn ? -1 : 1;
    return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
export function unpackRelease(archive: Uint8Array) {
  if (archive.byteLength > 32 * 1024 * 1024) throw invalid('更新包超過 32 MiB。');
  let total = 0,
    count = 0;
  const files = unzipSync(archive, {
    filter: (entry) => {
      if (++count > 3000 || (total += entry.originalSize) > 128 * 1024 * 1024)
        throw invalid('更新包展開後過大。');
      if (
        entry.name.includes('\\') ||
        entry.name.includes(':') ||
        entry.name.startsWith('/') ||
        entry.name.split('/').some((part) => part === '..' || part === '.')
      )
        throw invalid('更新包含有不合法路徑。');
      return !entry.name.endsWith('/');
    },
  });
  const prefix = files['ContextCanvas-Windows/package-files.json'] ? 'ContextCanvas-Windows/' : '';
  const bytes = files[`${prefix}package-files.json`];
  if (!bytes || bytes.byteLength > 1024 * 1024) throw invalid('找不到有效的更新包資訊。');
  const manifest = PackageManifest.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  const paths = new Set<string>();
  const application = new Map<string, Uint8Array>();
  for (const entry of manifest.bootstrap_files)
    if (
      !files[`${prefix}${entry.path}`] ||
      checksum(files[`${prefix}${entry.path}`]) !== entry.sha256
    )
      throw invalid('啟動檔案校驗失敗。');
  for (const entry of manifest.files) {
    if (
      paths.has(entry.path) ||
      !entry.path.startsWith('app/') ||
      entry.path
        .split('/')
        .some((part) =>
          ['..', '.', '.git', '.runtime', 'data', 'node_modules', '.env'].includes(part),
        ) ||
      entry.path.includes('\\') ||
      entry.path.includes(':')
    )
      throw invalid('更新包不可覆蓋資料、登入設定或執行環境。');
    paths.add(entry.path);
    const content = files[`${prefix}${entry.path}`];
    if (!content || checksum(content) !== entry.sha256) throw invalid('更新檔案校驗失敗。');
    application.set(entry.path.slice(4), content);
  }
  for (const path of Object.keys(files))
    if (path.startsWith(`${prefix}app/`) && !paths.has(path.slice(prefix.length)))
      throw invalid('更新包包含未列入資訊表的程式檔案。');
  const packageJson = application.get('package.json');
  if (!packageJson) throw invalid('更新包缺少 package.json。');
  const pkg = JSON.parse(Buffer.from(packageJson).toString('utf8'));
  if (
    pkg.name !== 'ai-context-canvas' ||
    pkg.version !== manifest.version ||
    !application.has('pnpm-lock.yaml') ||
    !application.has('apps/web/dist/index.html') ||
    !application.has('apps/api/src/server.ts')
  )
    throw invalid('更新包不完整或版本不一致。');
  return { manifest, application };
}

export class UpdateManager {
  readonly state: UpdateState;
  private operation = false;
  private abort = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private listeners = new Set<(state: UpdateState) => void>();
  constructor(
    readonly root: string,
    currentVersion: string,
    managed: boolean,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.state = {
      current_version: currentVersion,
      managed,
      phase: 'idle',
      channel: 'preview',
      auto_download: true,
      latest: null,
      staged_version: null,
      checked_at: null,
      error: null,
      previous_version: null,
    };
  }
  async initialize() {
    await fs.mkdir(join(this.root, '.runtime'), { recursive: true });
    try {
      const saved = z
        .object({ channel: z.enum(['stable', 'preview']), auto_download: z.boolean() })
        .parse(
          JSON.parse(
            await fs.readFile(join(this.root, '.runtime', 'update-settings.json'), 'utf8'),
          ),
        );
      Object.assign(this.state, saved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.state.error = '更新偏好無效，已使用預設值。';
    }
    try {
      const installed = JSON.parse(
        await fs.readFile(join(this.root, '.runtime', 'install.json'), 'utf8'),
      );
      this.state.previous_version =
        typeof installed.previous_version === 'string' ? installed.previous_version : null;
    } catch {
      /* First installation. */
    }
    try {
      const saved = z
        .object({ version: Version, sha256: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(JSON.parse(await fs.readFile(join(this.root, '.runtime', 'staged.json'), 'utf8')));
      const staged = saved.version;
      if (compareVersions(staged, this.state.current_version) > 0) {
        const bytes = new Uint8Array(await fs.readFile(this.archivePath(staged)));
        if (checksum(bytes) !== saved.sha256 || unpackRelease(bytes).manifest.version !== staged)
          throw invalid('已下載的新版校驗失敗。');
        this.state.staged_version = staged;
        this.state.phase = 'ready';
      }
    } catch {
      /* Interrupted download does not become executable. */
    }
  }
  start() {
    this.timer = setInterval(
      () => {
        if (!this.operation && this.state.phase !== 'installing') void this.check().catch(() => {});
      },
      15 * 60 * 1000,
    );
    this.timer.unref();
    if (this.state.phase !== 'ready') void this.check().catch(() => {});
  }
  snapshot() {
    return { ...this.state };
  }
  subscribe(listener: (state: UpdateState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private archivePath(version: string) {
    return join(this.root, '.runtime', `update-${Version.parse(version)}.zip`);
  }
  async configure(channel: 'stable' | 'preview', autoDownload: boolean) {
    if (this.operation) throw new DomainError('update_busy', '更新正在處理，請稍後變更。', 409);
    this.state.channel = channel;
    this.state.auto_download = autoDownload;
    await this.writeJson(join(this.root, '.runtime', 'update-settings.json'), {
      channel,
      auto_download: autoDownload,
    });
    this.emit();
    return this.snapshot();
  }
  private async writeJson(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, path);
  }
  private async bytes(url: string, maximum: number, json = false) {
    let current = new URL(url);
    let response: Response | undefined;
    for (let redirect = 0; redirect < 5; redirect++) {
      if (
        current.protocol !== 'https:' ||
        current.username ||
        current.password ||
        ![
          'api.github.com',
          'github.com',
          'release-assets.githubusercontent.com',
          'objects.githubusercontent.com',
        ].includes(current.hostname)
      )
        throw invalid('更新來源不在可信 GitHub 主機中。');
      response = await this.transport(current.toString(), {
        headers: {
          'User-Agent': 'ContextCanvas-Updater',
          Accept: json ? 'application/vnd.github+json' : 'application/octet-stream',
        },
        redirect: 'manual',
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(120000)]),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw invalid('更新下載重新導向無效。');
        current = new URL(location, current);
        continue;
      }
      break;
    }
    if (!response?.ok || !response.body)
      throw new DomainError(
        'update_unavailable',
        `更新來源無法存取（HTTP ${response?.status ?? '未知'}）。請確認網路與公開發佈版本；使用者不需要 GitHub token。`,
        502,
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw invalid('更新下載超過大小限制。');
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  }
  private assetUrl(asset: { url: string; browser_download_url: string }) {
    const url = asset.browser_download_url;
    const parsed = new URL(url);
    if (
      parsed.origin !== 'https://github.com' ||
      !parsed.pathname.startsWith(`/${UPDATE_REPOSITORY}/releases/download/`) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw invalid('版本資產不屬於指定倉庫。');
    return url;
  }
  async check() {
    if (this.operation) throw new DomainError('update_busy', '正在檢查或準備更新。', 409);
    this.operation = true;
    const wasReady = this.state.phase === 'ready';
    this.state.phase = 'checking';
    this.state.error = null;
    this.emit();
    try {
      const releases = z
        .array(
          z.object({
            draft: z.boolean(),
            prerelease: z.boolean(),
            tag_name: z.string(),
            assets: z.array(
              z.object({ name: z.string(), url: z.string(), browser_download_url: z.string() }),
            ),
          }),
        )
        .parse(
          JSON.parse(
            (
              await this.bytes(
                `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=20`,
                2 * 1024 * 1024,
                true,
              )
            ).toString('utf8'),
          ),
        );
      const candidates = releases
        .filter(
          (release) =>
            !release.draft &&
            (this.state.channel === 'preview' || !release.prerelease) &&
            /^canvas-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.tag_name),
        )
        .sort((a, b) => compareVersions(b.tag_name.slice(8), a.tag_name.slice(8)));
      this.state.latest = null;
      for (const release of candidates) {
        const asset = release.assets.find((entry) => entry.name === 'context-canvas-update.json');
        if (!asset) continue;
        const manifest = FeedManifest.parse(
          JSON.parse((await this.bytes(this.assetUrl(asset), 64000)).toString('utf8')),
        );
        if (
          `canvas-v${manifest.version}` !== release.tag_name ||
          (this.state.channel === 'stable' && manifest.channel !== 'stable')
        )
          throw invalid('版本資訊與發佈標籤不符。');
        const archive = release.assets.find((entry) => entry.name === manifest.archive.name);
        if (!archive || manifest.archive.name !== `ContextCanvas-Windows-${manifest.version}.zip`)
          throw invalid('版本缺少對應更新包。');
        if (compareVersions(manifest.version, this.state.current_version) > 0)
          this.state.latest = {
            ...manifest,
            download_url: this.assetUrl(archive),
            source: 'github',
          };
        break;
      }
      this.state.checked_at = new Date().toISOString();
      this.state.phase =
        wasReady && this.state.staged_version ? 'ready' : this.state.latest ? 'available' : 'idle';
    } catch (error) {
      this.state.phase = wasReady ? 'ready' : 'error';
      this.state.error =
        error instanceof DomainError ? error.message : '更新檢查失敗；未安裝任何檔案。';
    } finally {
      this.operation = false;
      this.emit();
    }
    if (
      this.state.auto_download &&
      this.state.latest &&
      (!this.state.staged_version ||
        compareVersions(this.state.latest.version, this.state.staged_version) > 0)
    )
      await this.download();
    return this.snapshot();
  }
  async download() {
    if (this.operation || !this.state.latest)
      throw new DomainError('update_not_available', '目前沒有可下載的新版。', 409);
    this.operation = true;
    this.state.phase = 'downloading';
    this.state.error = null;
    this.emit();
    try {
      const release = this.state.latest;
      const bytes = await this.bytes(release.download_url, release.archive.bytes);
      if (bytes.byteLength !== release.archive.bytes || checksum(bytes) !== release.archive.sha256)
        throw invalid('更新包 SHA-256 校驗失敗。');
      await this.stage(bytes, release.version);
    } catch (error) {
      this.state.phase = 'error';
      this.state.error = error instanceof DomainError ? error.message : '新版下載或檔案驗證失敗。';
    } finally {
      this.operation = false;
      this.emit();
    }
    return this.snapshot();
  }
  async importArchive(bytes: Uint8Array) {
    if (this.operation || this.state.phase === 'installing')
      throw new DomainError('update_busy', '更新正在處理。', 409);
    this.operation = true;
    try {
      const { manifest } = unpackRelease(bytes);
      await this.stage(bytes, manifest.version);
      this.state.latest = {
        format: 'context-canvas-update',
        format_version: 1,
        version: manifest.version,
        channel: manifest.version.includes('-') ? 'preview' : 'stable',
        data_schema_version: 2,
        minimum_launcher: 1,
        archive: {
          name: `ContextCanvas-Windows-${manifest.version}.zip`,
          bytes: bytes.byteLength,
          sha256: checksum(bytes),
        },
        notes: '使用者匯入的本機更新包',
        published_at: new Date().toISOString(),
        download_url: '',
        source: 'local',
      };
      this.emit();
      return this.snapshot();
    } finally {
      this.operation = false;
    }
  }
  private async stage(bytes: Uint8Array, version: string) {
    const { manifest } = unpackRelease(bytes);
    if (manifest.version !== version || compareVersions(version, this.state.current_version) <= 0)
      throw invalid('更新包必須比目前版本新。');
    const temporary = `${this.archivePath(version)}.partial`;
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, this.archivePath(version));
    await this.writeJson(join(this.root, '.runtime', 'staged.json'), {
      version,
      sha256: checksum(bytes),
    });
    this.state.staged_version = version;
    this.state.phase = 'ready';
    this.state.error = null;
  }
  async prepare() {
    if (
      !this.state.managed ||
      this.operation ||
      !this.state.staged_version ||
      this.state.phase !== 'ready'
    )
      throw new DomainError('update_not_ready', '請使用 Windows 啟動器，並先準備新版。', 409);
    this.operation = true;
    this.state.phase = 'installing';
    this.emit();
    try {
      const bytes = new Uint8Array(await fs.readFile(this.archivePath(this.state.staged_version)));
      const saved = z
        .object({ version: Version, sha256: z.string() })
        .parse(JSON.parse(await fs.readFile(join(this.root, '.runtime', 'staged.json'), 'utf8')));
      if (saved.version !== this.state.staged_version || checksum(bytes) !== saved.sha256)
        throw invalid('已下載的新版校驗失敗。');
      const { manifest, application } = unpackRelease(bytes);
      const versionRoot = join(this.root, 'versions', `${manifest.version}-${randomUUID()}`);
      await fs.mkdir(versionRoot, { recursive: true });
      for (const [path, content] of application) {
        const target = join(versionRoot, path);
        if (
          !resolve(target).startsWith(
            `${resolve(versionRoot)}${process.platform === 'win32' ? '\\' : '/'}`,
          )
        )
          throw invalid('不合法的更新路徑。');
        await fs.mkdir(dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }
      return { version: manifest.version, directory: versionRoot };
    } catch {
      this.state.phase = 'ready';
      this.state.error = '新版展開失敗，仍使用目前版本。';
      this.operation = false;
      this.emit();
      throw invalid(this.state.error);
    }
  }
  completeInstallation(version: string, previous: string) {
    this.state.current_version = version;
    this.state.previous_version = previous;
    this.state.latest = null;
    this.state.staged_version = null;
    this.state.phase = 'idle';
    this.state.error = null;
    this.operation = false;
    this.emit();
  }
  installationFailed() {
    this.state.phase = 'ready';
    this.state.error = '新版安裝未完成，繼續使用原版本。';
    this.operation = false;
    this.emit();
  }
  close() {
    this.abort.abort();
    if (this.timer) clearInterval(this.timer);
    this.listeners.clear();
  }
}
