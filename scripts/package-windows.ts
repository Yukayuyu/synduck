import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { build } from 'esbuild';
import { PackageManifest } from '../packages/local-runtime/src/updates';
import releaseConfig from '../release.config.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.RELEASE_OUTPUT || join(root, 'release-output'));
const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION || pkg.version;
if (version !== pkg.version) throw new Error('Release version must match package.json.');
const sha = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
// Build from an explicit runtime allowlist. Never enumerate the checkout: private
// source, untracked files, credentials and developer notes cannot become assets.
const files: Record<string, Uint8Array> = {};
const runtime = JSON.parse(await fs.readFile(join(root, 'packaging/windows/package.json'), 'utf8'));
files['app/package.json'] = new TextEncoder().encode(
  JSON.stringify({ ...runtime, version }, null, 2),
);
for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml'])
  files[`app/${name}`] = new Uint8Array(await fs.readFile(join(root, 'packaging/windows', name)));
for (const [entry, outputPath] of [
  ['scripts/local-launcher.ts', 'scripts/local-launcher.mjs'],
  ['apps/api/src/server.ts', 'apps/api/server.mjs'],
] as const) {
  const outfile = join(root, outputPath);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile,
    bundle: true,
    packages: 'external',
    alias: Object.fromEntries(
      ['domain', 'db', 'context-compiler', 'model-gateway'].map((name) => [
        `@acc/${name}`,
        join(root, 'packages', name, 'src/index.ts'),
      ]),
    ),
    platform: 'node',
    format: 'esm',
    target: 'node24',
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    define: { 'process.env.CANVAS_COMPILED': '"1"' },
    write: false,
    plugins: [
      {
        name: 'runtime-package-version',
        setup(builder) {
          builder.onResolve({ filter: /package\.json$/ }, (args) => {
            if (resolve(args.resolveDir, args.path) === join(root, 'package.json'))
              return { path: 'version', namespace: 'runtime-version' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'runtime-version' }, () => ({
            contents: `import { readFileSync } from 'node:fs';
            export default JSON.parse(readFileSync(new URL(${JSON.stringify(
              relative(dirname(outfile), join(root, 'package.json')).replaceAll('\\', '/'),
            )}, import.meta.url), 'utf8'));`,
            loader: 'js',
          }));
        },
      },
    ],
  });
  files[`app/${outputPath}`] = result.outputFiles[0].contents;
}
// These two public, one-line adapters let an existing 0.5.1 launcher install the
// compiled release. They contain no implementation from the development tree.
files['app/scripts/local-launcher.ts'] = new TextEncoder().encode(
  "import './local-launcher.mjs';\n",
);
files['app/apps/api/src/server.ts'] = new TextEncoder().encode("import '../server.mjs';\n");
files['app/apps/api/desktop/windows.ps1'] = new Uint8Array(
  await fs.readFile(join(root, 'packages/local-runtime/desktop/windows.ps1')),
);
files['app/.env.example'] = new Uint8Array(await fs.readFile(join(root, '.env.example')));
files['app/LICENSE'] = new Uint8Array(await fs.readFile(join(root, 'LICENSE')));
files['app/release-info.json'] = new TextEncoder().encode(
  JSON.stringify({
    version,
    update_repository: releaseConfig.repository,
    source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  }),
);
for (const name of [
  'setup.md',
  'windows-ios.md',
  'local-runtime-updates.md',
  'mcp-desktop-traces.md',
  'github-updates.md',
  'public-readiness.md',
  'concurrent-conversations.md',
  'ui-styles.md',
  'ui-previews/arc.png',
  'ui-previews/paper.png',
  'ui-previews/ink.png',
])
  files[`app/docs/${name}`] = new Uint8Array(await fs.readFile(join(root, 'docs', name)));
files['app/NOTICE.txt'] = new TextEncoder().encode(
  'Context Canvas is distributed under the MIT License; see LICENSE.\n' +
    'This distribution contains compiled application files and a Windows desktop bridge.\n' +
    'Third-party runtime dependencies are installed from the pinned lockfile; their respective licenses apply.\n' +
    'Compiled JavaScript and distributed runtime files can be inspected; compilation does not provide secrecy.\n',
);
const walk = async (directory: string, relative: string) => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name),
      name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Public client assets must not use symlinks.');
    if (entry.isDirectory()) await walk(child, name);
    else if (entry.isFile()) {
      if (
        ![
          'index.html',
          'icon.svg',
          'icon-180.png',
          'icon-192.png',
          'icon-512.png',
          'manifest.webmanifest',
        ].some((asset) => name === `app/apps/web/dist/${asset}`) &&
        !/^app\/apps\/web\/dist\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpe?g|webp|ico|woff2?)$/.test(
          name,
        )
      )
        throw new Error(`Unexpected public client asset: ${name}`);
      files[name] = new Uint8Array(await fs.readFile(child));
    }
  }
};
await walk(join(root, 'apps/web/dist'), 'app/apps/web/dist');
for (const path of Object.keys(files))
  if (
    path.endsWith('.map') ||
    (path.endsWith('.ts') &&
      !['app/scripts/local-launcher.ts', 'app/apps/api/src/server.ts'].includes(path))
  )
    throw new Error(`Development source or source map in public package: ${path}`);
const manifest = PackageManifest.parse({
  format: 'context-canvas-package',
  format_version: 1,
  version,
  data_schema_version: 2,
  minimum_launcher: 1,
  files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha(content) })),
  bootstrap_files: [],
});
for (const name of [
  'Start-ContextCanvas.cmd',
  'Start-ContextCanvas.ps1',
  'Update-Existing.cmd',
  'Update-Existing.ps1',
  'launch.mjs',
] as const) {
  const content = new Uint8Array(await fs.readFile(join(root, 'scripts/windows', name)));
  files[name] = content;
  manifest.bootstrap_files.push({ path: name, sha256: sha(content) });
}
files['package-files.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
files['開始使用.txt'] = new TextEncoder().encode(
  '先解壓縮完整 ZIP，再雙擊 Start-ContextCanvas.cmd。\r\n從舊版升級：先停止舊版，執行這個新資料夾的 Update-Existing.cmd，選擇原安裝資料夾。\r\n啟動器會保留畫布、登入及模型設定；完成首次升級後，可在介面「版本與更新」匯入更新包。\r\n本地執行器在「本地任務」設定專案路徑；命令和寫檔需確認。\r\n安裝與模型設定請見 app/docs/setup.md；升級與復原請見 app/docs/local-runtime-updates.md。\r\n',
);
const archive = zipSync(
  Object.fromEntries(
    Object.entries(files).map(([name, content]) => [`ContextCanvas-Windows/${name}`, content]),
  ),
  { level: 6 },
);
const archiveName = `ContextCanvas-Windows-${version}.zip`;
await fs.mkdir(output, { recursive: true });
await fs.writeFile(join(output, archiveName), archive);
await fs.writeFile(join(output, `${archiveName}.sha256`), `${sha(archive)}  ${archiveName}\n`);
let versionNotes = '';
try {
  versionNotes = await fs.readFile(join(root, 'docs/releases', `${version}.md`), 'utf8');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const notes =
  process.env.RELEASE_NOTES ||
  versionNotes ||
  `Context Canvas ${version}：本地任務、更新通知與可復原安裝。`;
if (notes.length > 16000) throw new Error('Release notes exceed the update feed limit.');
await fs.writeFile(
  join(output, 'context-canvas-update.json'),
  JSON.stringify(
    {
      format: 'context-canvas-update',
      format_version: 1,
      version,
      channel: version.includes('-') ? 'preview' : 'stable',
      data_schema_version: 2,
      minimum_launcher: 1,
      archive: { name: archiveName, sha256: sha(archive), bytes: archive.byteLength },
      notes,
      published_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Created ${archiveName} (${archive.byteLength} bytes) with SHA-256 and update manifest.`,
);
