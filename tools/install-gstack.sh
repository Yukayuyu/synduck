#!/usr/bin/env bash
# Install gstack skills for Claude Code (and other AI agents).
# Run this once after cloning the repo.
# Requires: bun (https://bun.sh)

set -e

if ! command -v bun &>/dev/null; then
  echo "Error: bun is required. Install it from https://bun.sh"
  exit 1
fi

GSTACK_DIR="$HOME/.claude/skills/gstack"

if [ -d "$GSTACK_DIR" ]; then
  echo "gstack already installed at $GSTACK_DIR — upgrading..."
  cd "$GSTACK_DIR"
  git pull --ff-only
else
  echo "Cloning gstack..."
  git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$GSTACK_DIR"
  cd "$GSTACK_DIR"
fi

echo "Running gstack setup..."
./setup

echo ""
echo "gstack installed. Restart Claude Code (or open /hooks) to pick up the new skills."
