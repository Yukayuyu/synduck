import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { PackageManifest } from '../packages/local-runtime/src/updates';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.RELEASE_OUTPUT || join(root, 'release-output'));
const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'));
const version = process.env.RELEASE_VERSION || pkg.version;
if (version !== pkg.version) throw new Error('Release version must match package.json.');
const sha = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
// Include newly added, reviewed source files before the first commit as well.
paths.push(
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean),
);
const files: Record<string, Uint8Array> = {};
for (const path of [...new Set(paths)]) {
  if (
    path.startsWith('.github/') ||
    path.startsWith('tests/') ||
    path === '.env' ||
    path.startsWith('data/') ||
    path.startsWith('scripts/windows/')
  )
    continue;
  files[`app/${path}`] = new Uint8Array(await fs.readFile(join(root, path)));
}
const walk = async (directory: string, relative: string) => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name),
      name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await walk(child, name);
    else if (entry.isFile()) files[name] = new Uint8Array(await fs.readFile(child));
  }
};
await walk(join(root, 'apps/web/dist'), 'app/apps/web/dist');
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
  '先解壓縮完整 ZIP，再雙擊 Start-ContextCanvas.cmd。\r\n從舊版升級：先停止舊版，執行這個新資料夾的 Update-Existing.cmd，選擇原安裝資料夾。\r\n啟動器會保留畫布、登入及模型設定；完成首次升級後，可在介面「版本與更新」匯入更新包。\r\n本地執行器在「本地任務」設定專案路徑；命令和寫檔需確認。\r\n詳細說明請見 app/docs/local-runtime-updates.md。\r\n',
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
const notes =
  process.env.RELEASE_NOTES || `Context Canvas ${version}：本地任務、更新通知與可復原安裝。`;
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
