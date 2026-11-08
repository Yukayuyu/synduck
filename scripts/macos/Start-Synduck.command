#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "$0")" && pwd -P)"
task_runtime="$task_root/.runtime"
task_stage=""
task_partial=""
finish() {
  task_status=$?
  [ -z "$task_stage" ] || rm -rf "$task_stage"
  [ -z "$task_partial" ] || rm -f "$task_partial"
  if [ "$task_status" -ne 0 ]; then
    printf '\nSynduck could not start. Read the error above and retry.\n'
    if [ -t 0 ] && [ "${CANVAS_NO_PAUSE:-0}" != 1 ]; then
      read -r -p 'Press Enter to close… ' task_reply || true
    fi
  fi
}
trap finish EXIT

if [ "$(uname -s)" != Darwin ]; then
  printf 'This launcher requires macOS.\n' >&2
  exit 1
fi
if [ ! -f "$task_root/app/package.json" ]; then
  printf 'Extract the complete ZIP before starting Synduck.\n' >&2
  exit 1
fi
task_arch="$(uname -m)"
# Prefer native Apple Silicon even when Terminal itself is running under Rosetta.
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  task_arch=arm64
fi
case "$task_arch" in
  arm64) task_hash=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d ;;
  x86_64) task_arch=x64; task_hash=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316 ;;
  *) printf 'An Apple Silicon or Intel Mac is required.\n' >&2; exit 1 ;;
esac
mkdir -p "$task_runtime"
task_node_name="node-v24.19.0-darwin-$task_arch"
task_node_dir="$task_runtime/$task_node_name"
if [ ! -x "$task_node_dir/bin/node" ]; then
  task_archive="$task_runtime/$task_node_name.tar.gz"
  if [ ! -f "$task_archive" ]; then
    printf 'Downloading verified Node.js 24.19.0 for %s…\n' "$task_arch"
    task_partial="$(mktemp "$task_runtime/node-download.XXXXXX")"
    /usr/bin/curl --fail --location --retry 2 --proto '=https' --tlsv1.2 \
      "https://nodejs.org/dist/v24.19.0/$task_node_name.tar.gz" --output "$task_partial"
    task_actual="$(/usr/bin/shasum -a 256 "$task_partial")"
    if [ "${task_actual%% *}" != "$task_hash" ]; then
      printf 'Node.js download checksum mismatch; nothing was executed.\n' >&2; exit 1
    fi
    mv "$task_partial" "$task_archive"
    task_partial=""
  fi
  task_actual="$(/usr/bin/shasum -a 256 "$task_archive")"
  if [ "${task_actual%% *}" != "$task_hash" ]; then
    printf 'Cached Node.js checksum mismatch. Remove %s and retry.\n' "$task_archive" >&2; exit 1
  fi
  task_stage="$(mktemp -d "$task_runtime/node-install.XXXXXX")"
  /usr/bin/tar -xzf "$task_archive" -C "$task_stage"
  # Publish a complete runtime only after successful extraction.
  rm -rf "$task_node_dir"
  mv "$task_stage/$task_node_name" "$task_node_dir"
  rmdir "$task_stage"
  task_stage=""
fi
export PATH="$task_node_dir/bin:$PATH"
task_node="$task_node_dir/bin/node"
task_app="$task_root/app"
# The shared bootstrap validates the same journal before choosing its app.
task_active="$("$task_node" --input-type=module - "$task_root" <<'JS'
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const pending = join(root, '.runtime/pending-install.json');
const installed = join(root, '.runtime/install.json');
const record = existsSync(pending)
  ? JSON.parse(readFileSync(pending, 'utf8')).previous
  : existsSync(installed) ? JSON.parse(readFileSync(installed, 'utf8')) : {active_directory:'app'};
if (record.active_directory !== 'app' && !/^versions\/[0-9A-Za-z.-]+$/.test(record.active_directory))
  throw new Error('Invalid installed application directory.');
process.stdout.write(record.active_directory);
JS
)"
task_app="$task_root/$task_active"
cd "$task_app"
printf 'Preparing dependencies. First launch requires Internet access…\n'
"$task_node" "$task_node_dir/lib/node_modules/npm/bin/npx-cli.js" \
  --yes --cache "$task_runtime/npm-cache" --package=pnpm@11.19.0 pnpm \
  install --frozen-lockfile --store-dir "${CANVAS_PNPM_STORE:-$task_runtime/pnpm-store}"
printf '\nStarting Synduck. Keep this Terminal window open; Control+C stops it.\n'
"$task_node" "$task_root/launch.mjs"
