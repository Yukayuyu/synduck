---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session - dispatches subagents per task with two-stage review
---

# Subagent-Driven Development

Execute implementation plans by dispatching independent subagents for each task, with two sequential review stages before marking tasks complete.

**Core principle:** Fresh subagent per task + two-stage review (spec compliance then code quality) = high quality, fast iteration.

## When to Use

- You have a finalized implementation plan
- Tasks are mostly independent (not tightly coupled)
- You want to stay in the current session
- Subagents are available

## Process

For each task:
1. **Dispatch implementer subagent** — provide task, constraints, expected output
2. **Answer questions** if implementer needs clarification
3. **Implementer implements + self-reviews**
4. **Spec compliance review** — did implementation match the spec?
5. **Code quality review** — is the code clean and correct?
6. **Mark task complete** — only after BOTH reviews pass
7. Repeat for next task

After all tasks: dispatch final reviewer for entire implementation.

## Model Selection Strategy

| Task Type | Model |
|-----------|-------|
| Mechanical (1-2 files, clear spec) | Least powerful |
| Multi-file integration | Standard |
| Architecture/design decisions | Most capable |
| Reviews | Most capable |

## Required Integration

- `superpowers:using-git-worktrees` — REQUIRED before starting
- `superpowers:writing-plans` — for plan creation
- `superpowers:requesting-code-review` — for review templates
- `superpowers:test-driven-development` — subagents should follow TDD
- `superpowers:finishing-a-development-branch` — after all tasks complete

## Red Flags

**Never:**
- Skip review stages
- Proceed with unfixed issues from review
- Dispatch multiple implementers simultaneously (sequential only)
- Force implementers to read plan files directly (give them exactly what they need)
- Start code quality review before spec compliance passes
