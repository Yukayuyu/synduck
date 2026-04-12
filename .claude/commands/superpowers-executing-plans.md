---
name: executing-plans
description: Use when you have a written implementation plan and are ready to execute it task by task with verification checkpoints
---

# Executing Plans

Execute written implementation plans across separate sessions with review checkpoints.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Critical:** Never start implementation on main/master branch without explicit user consent. Always use `superpowers:using-git-worktrees` first.

## Process

### Step 1: Load and Review Plan

- Read the plan file completely
- Review critically — identify any questions or concerns
- If anything is unclear, ask before starting

### Step 2: Execute Tasks

For each task:
1. Mark task as `in_progress`
2. Follow steps exactly as written
3. Run specified verifications
4. Mark as `completed` only after verification passes

### Step 3: Review Checkpoints

After each batch of tasks (or as specified in the plan), request code review via `superpowers:requesting-code-review`.

### Step 4: Complete Development

After all tasks verify successfully, use `superpowers:finishing-a-development-branch` to complete the work.

## Critical Stopping Points

**STOP executing immediately when:**
- Encountering blockers
- Critical plan gaps found
- Instructions are unclear
- Repeated verification failures (same failure 2+ times)

Ask for clarification rather than guessing.

## Required Skills

- `superpowers:using-git-worktrees` — isolated workspace setup (BEFORE starting)
- `superpowers:writing-plans` — if plan needs to be created first
- `superpowers:finishing-a-development-branch` — completion
- `superpowers:subagent-driven-development` — recommended for higher quality output when subagents available
