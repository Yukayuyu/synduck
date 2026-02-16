#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="${1:-}"
if [ -z "$PR_NUMBER" ]; then
  echo "Usage: $0 <PR_NUMBER>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT_DIR/autoloop_artifacts"

if [ ! -d "$ART_DIR" ]; then
  echo "No autoloop_artifacts/ directory found" >&2
  exit 1
fi

latest_iter=$(ls -1 "$ART_DIR" 2>/dev/null | grep '^iter-' | sort -V | tail -n 1 || true)
if [ -z "$latest_iter" ]; then
  echo "No iter-* artifacts found" >&2
  exit 1
fi

meta="$ART_DIR/$latest_iter/meta.txt"
log="$ART_DIR/$latest_iter/check.log"

summary="### Autoloop Summary\n\n- Latest: $latest_iter\n\n**meta.txt**\n\n\`\`\`\n$(cat "$meta" 2>/dev/null | tail -n 200)\n\`\`\`\n\n**check.log (tail)**\n\n\`\`\`\n$(cat "$log" 2>/dev/null | tail -n 120)\n\`\`\`\n"

# Fetch current body
body=$(gh pr view "$PR_NUMBER" --json body -q .body)

# Replace existing section if present
if echo "$body" | grep -q "### Autoloop Summary"; then
  # crude replace: keep everything before the header
  prefix=$(python3 - <<'PY'
import sys
b=sys.stdin.read()
idx=b.find('### Autoloop Summary')
print(b[:idx].rstrip())
PY
  <<<"$body")
  new_body="$prefix\n\n$summary"
else
  new_body="$body\n\n$summary"
fi

gh pr edit "$PR_NUMBER" --body "$new_body"

echo "Updated PR #$PR_NUMBER body with $latest_iter summary."
