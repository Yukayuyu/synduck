#!/usr/bin/env bash
set -euo pipefail

# Guarded loop runner for apps/web
# - runs check_web.sh up to N times
# - captures logs
# - stops early on repeated failures

MAX_ITERS="${MAX_ITERS:-5}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ART_DIR="$ROOT_DIR/autoloop_artifacts"

mkdir -p "$ART_DIR"

prev_sig=""
repeat=0

for i in $(seq 1 "$MAX_ITERS"); do
  iter_dir="$ART_DIR/iter-$i"
  mkdir -p "$iter_dir"

  echo "==> ITER $i" | tee "$iter_dir/meta.txt"

  set +e
  "$ROOT_DIR/tools/autoloop/check_web.sh" >"$iter_dir/check.log" 2>&1
  code=$?
  set -e

  if [ $code -eq 0 ]; then
    echo "OK" | tee -a "$iter_dir/meta.txt"
    exit 0
  fi

  # Build a crude failure signature from last 30 lines
  sig=$(tail -n 30 "$iter_dir/check.log" | shasum | awk '{print $1}')

  if [ "$sig" = "$prev_sig" ]; then
    repeat=$((repeat+1))
  else
    repeat=0
  fi

  prev_sig="$sig"

  echo "FAIL (exit=$code) repeat=$repeat" | tee -a "$iter_dir/meta.txt"

  if [ $repeat -ge 1 ]; then
    echo "Stopping: repeated failure signature" | tee -a "$iter_dir/meta.txt"
    exit 2
  fi

  echo "Fix the failure then rerun loop." | tee -a "$iter_dir/meta.txt"
  exit 1

done

exit 3
