---
name: writing-plans
description: Use when about to implement a multi-step feature or bugfix that needs a structured plan before execution begins
---

# Writing Plans

Generate comprehensive implementation plans for multi-step engineering tasks.

**Announce at start:** "I'm using the writing-plans skill to create an implementation plan."

## Plan Structure

Every plan includes:

1. **Header** — goal, architecture overview, tech stack
2. **File mapping** — what gets created/modified (clarifies decomposition decisions)
3. **Tasks** — broken into 2-5 minute steps with exact commands
4. **Complete code examples** — not vague instructions
5. **Checkbox syntax** — for progress tracking

## Task Granularity

Each step is one action following TDD:
```
- [ ] Write failing test for X
- [ ] Verify test fails: `npm test -- --grep "X"`
- [ ] Implement X
- [ ] Verify test passes: `npm test -- --grep "X"`
- [ ] Commit: `git commit -m "feat: add X"`
```

Frequent commits — one per task, self-contained and sensible independently.

## Save Location

```
docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md
```

## Process

1. **Announce** you're using this skill
2. **Write plan** with complete file structure and bite-sized tasks
3. **Dispatch plan-document-reviewer subagent** — iterate up to 3 review loops
4. **Fix issues** from review
5. **Offer execution choice:**
   - Subagent-driven development (per-task, higher quality)
   - Inline execution (simpler, current session)

## Key Principles

- Map file structure BEFORE tasks
- Follow DRY, YAGNI, TDD
- Use exact file paths and command syntax
- If multiple independent subsystems exist, split into separate plans
- Plans should be executable by any skilled developer independently

## Red Flags

**Never:**
- Write vague tasks ("implement the auth logic")
- Skip TDD steps in task definitions
- Start executing before the plan is reviewed
- Combine unrelated subsystems into one plan
