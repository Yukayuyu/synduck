---
name: using-git-worktrees
description: Use when starting feature work that needs isolation from current workspace or before executing implementation plans
---

# Using Git Worktrees

Create isolated workspaces sharing the same repository, allowing work on multiple branches simultaneously.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

**Core principle:** Systematic directory selection + safety verification = reliable isolation.

## Directory Selection (Priority Order)

1. **Check for existing directories:**
   ```bash
   ls -d .worktrees 2>/dev/null   # Preferred (hidden)
   ls -d worktrees 2>/dev/null    # Alternative
   ```
   If both exist, `.worktrees` wins.

2. **Check CLAUDE.md** for a worktree directory preference.

3. **Ask user** if no directory exists and no CLAUDE.md preference:
   ```
   No worktree directory found. Where should I create worktrees?
   1. .worktrees/ (project-local, hidden)
   2. ~/.config/superpowers/worktrees/<project-name>/ (global)
   ```

## Safety Verification

For project-local directories, MUST verify ignored before creating:
```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If NOT ignored: add to `.gitignore`, commit, then proceed.

**Why critical:** Prevents accidentally committing worktree contents.

## Creation Steps

```bash
# 1. Detect project name
project=$(basename "$(git rev-parse --show-toplevel)")

# 2. Create worktree
git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"

# 3. Run project setup (auto-detect)
[ -f package.json ]      && npm install
[ -f Cargo.toml ]        && cargo build
[ -f requirements.txt ]  && pip install -r requirements.txt
[ -f go.mod ]            && go mod download

# 4. Verify clean baseline
npm test  # or cargo test / pytest / go test ./...
```

If tests fail: report failures, ask whether to proceed or investigate.

## Quick Reference

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it (verify ignored) |
| `worktrees/` exists | Use it (verify ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check CLAUDE.md → Ask user |
| Directory not ignored | Add to .gitignore + commit |
| Tests fail at baseline | Report + ask before proceeding |

## Red Flags

**Never:**
- Create worktree without verifying it's gitignored (project-local)
- Skip baseline test verification
- Proceed with failing tests without asking
- Assume directory location when ambiguous

## Integration

**Called by:** brainstorming, subagent-driven-development, executing-plans

**Pairs with:** `superpowers:finishing-a-development-branch` for cleanup
