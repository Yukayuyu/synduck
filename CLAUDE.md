# Claude Code — Project Guide (synduck)

This repository uses **guarded autopilot** rules: Claude may propose and apply changes, but must stay within safety boundaries and stop when risk rises.

## What this repo is

A monorepo for a collaborative online editor/playground.

- App: `apps/web` (Next.js, TypeScript)
- Infra: `infra` (IaC; to be decided)

## Golden rules (non-negotiable)

1. **No destructive commands**: never run `sudo`, `rm -rf`, `diskutil`, `shutdown`, `reboot`, or anything that modifies macOS system directories.
2. **Repo-only edits**: only edit files under this repo directory.
3. **Small iterations**: change the minimum necessary; keep diffs reviewable.
4. **Test-driven loop**: after changes, run checks.
5. **Stop conditions**: if stuck (same failure 2–3 times) or unclear requirements, stop and ask.
6. **Secrets**: never print or commit secrets. No copying credentials into files or logs.

## Local dev (web)

```bash
cd apps/web
npm install
npm run dev
```

## Checks (web)

```bash
cd apps/web
npm run lint
npm run build
```

## Guarded Autopilot Loop (Phase 1)

Use the scripts in `tools/autoloop/`.

- Goal: iterate on code safely: **edit → lint/build → summarize → stop**.
- Max iterations default: **5**.
- Human approval points (recommended): before pushing, before opening PR, before any infra/deploy.

See: `docs/autoloop.md`.
