# Claude Code — Project Guide (synduck)

This repository uses **guarded autopilot** rules: Claude may propose and apply changes, but must stay within safety boundaries and stop when risk rises.

## What this repo is

A monorepo for conduck — a social knowledge platform with an Obsidian-like graph canvas.

- App: `apps/conduck` (Next.js, TypeScript, Tailwind)
- Infra: `infra` (IaC; to be decided)
- Archive: see branch `archive/original-app` for the previous synduck app (apps/web)

## Golden rules (non-negotiable)

1. **No destructive commands**: never run `sudo`, `rm -rf`, `diskutil`, `shutdown`, `reboot`, or anything that modifies macOS system directories.
2. **Repo-only edits**: only edit files under this repo directory.
3. **Small iterations**: change the minimum necessary; keep diffs reviewable.
4. **Test-driven loop**: after changes, run checks.
5. **Stop conditions**: if stuck (same failure 2–3 times) or unclear requirements, stop and ask.
6. **Secrets**: never print or commit secrets. No copying credentials into files or logs.

## Local dev (conduck)

```bash
cd apps/conduck
npm install
npm run dev
```

## Checks (conduck)

```bash
cd apps/conduck
npm run lint
npm run build
```

## Guarded Autopilot Loop (Phase 1)

Use the scripts in `tools/autoloop/`.

- Goal: iterate on code safely: **edit → lint/build → summarize → stop**.
- Max iterations default: **5**.
- Human approval points (recommended): before pushing, before opening PR, before any infra/deploy.

See: `docs/autoloop.md`.

## gstack

gstack provides advanced skills for shipping, QA, design review, and web browsing.

**Web browsing:** Use the `/browse` skill from gstack for all web browsing tasks. Never use `mcp__claude-in-chrome__*` tools directly.

**Install for new contributors:**
```bash
bash tools/install-gstack.sh
```
Requires [bun](https://bun.sh). A SessionStart hook will auto-install gstack if bun is available.

**Available gstack skills:**
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`
