---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

Delegate independent tasks to specialized agents with isolated context. Each agent gets only what it needs — never your session's history.

**Core principle:** Dispatch one agent per independent problem domain. Let them work concurrently.

## When to Use

**Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**
- Failures are related (fixing one might fix others)
- Need to understand full system state first
- Agents would interfere with each other
- Still in exploratory debugging phase

## The Pattern

### 1. Identify Independent Domains

Group failures by what's broken:
- File A tests: Tool approval flow
- File B tests: Batch completion behavior
- File C tests: Abort functionality

Each domain is independent — fixing one doesn't affect others.

### 2. Create Focused Agent Tasks

Each agent receives:
- **Specific scope:** One test file or subsystem
- **Clear goal:** Make these tests pass
- **Constraints:** Don't change other code
- **Expected output:** Summary of findings and fixes

### 3. Dispatch in Parallel

All tasks run simultaneously. 3 problems solved in time of 1.

### 4. Review and Integrate

- Read each summary
- Verify fixes don't conflict
- Run full test suite
- Integrate all changes

## Agent Prompt Structure

Effective prompts are:
1. **Focused** — one clear problem domain
2. **Self-contained** — all context needed to understand the problem
3. **Specific about output** — what should the agent return?

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Too broad: "Fix all the tests" | Specific: "Fix agent-tool-abort.test.ts" |
| No context: "Fix the race condition" | Paste error messages and test names |
| No constraints | "Do NOT change production code" |
| Vague output: "Fix it" | "Return summary of root cause and changes" |

## Verification

After agents return:
1. Review each summary
2. Check for conflicts
3. Run full suite
4. Spot check for systematic errors
