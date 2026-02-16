#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/.claude/iterations"
mkdir -p "$OUT_DIR"

stamp=$(date +%Y%m%d-%H%M%S)
out="$OUT_DIR/iter-$stamp.md"

{
  echo "# Iteration $stamp"
  echo
  echo "## Git status"
  echo "\`\`\`"
  git -C "$ROOT_DIR" status --porcelain || true
  echo "\`\`\`"
  echo
  echo "## Diff (stat)"
  echo "\`\`\`"
  git -C "$ROOT_DIR" diff --stat || true
  echo "\`\`\`"
} > "$out"

echo "$out"
