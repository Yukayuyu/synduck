# Guarded Autopilot Loop (synduck)

Purpose: run a repeatable "Ralph loop"-style workflow locally while keeping safety + auditability.

## Phase 1: Safe baseline

- Allowed: edit code in repo, run lint/build/tests, create commits.
- Not allowed: sudo, destructive filesystem ops, system settings changes, publishing secrets.
- Stop early: if requirements unclear, errors repeat, or commands fall outside allowlist.

## Recommended iteration policy

- Max iterations: 5
- No-progress limit: 2 (same error signature twice)
- Max wall time: 20 minutes per task

## Command allowlist (web)

From repo root:

- `cd apps/web && npm ci`
- `cd apps/web && npm run lint`
- `cd apps/web && npm run build`

## Workflow

1. Create a branch: `git checkout -b feat/<slug>`
2. Implement smallest change
3. Run checks via script: `tools/autoloop/check_web.sh`
4. If green, commit with a clear message
5. Open PR (optional): `gh pr create ...`

## What Claude should output each iteration

- What changed (files)
- Commands run + results
- Next step or stop reason
