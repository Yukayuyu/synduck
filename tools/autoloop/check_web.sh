#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

cd "$WEB_DIR"

if [ ! -f package-lock.json ]; then
  echo "package-lock.json not found; run npm install first" >&2
  exit 1
fi

echo "==> npm ci"
npm ci

echo "==> npm run lint"
npm run lint

echo "==> npm run build"
npm run build

echo "OK"
