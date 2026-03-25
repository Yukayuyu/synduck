---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

Writing skills IS Test-Driven Development applied to process documentation.

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

**Required background:** You MUST understand `superpowers:test-driven-development` before using this skill.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools.

**Skills are:** Reusable techniques, patterns, reference guides

**Skills are NOT:** Narratives about how you solved a problem once

## The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

Write skill before testing? Delete it. Start over. No exceptions — not for "simple additions", not for "documentation updates".

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|----------------|
| Test case | Pressure scenario with subagent |
| Production code | Skill document (SKILL.md) |
| RED | Agent violates rule without skill (baseline) |
| GREEN | Agent complies with skill present |
| Refactor | Close loopholes while maintaining compliance |

## RED-GREEN-REFACTOR for Skills

**RED:** Run pressure scenario WITHOUT the skill. Document exact rationalizations agents use.

**GREEN:** Write minimal skill addressing those specific rationalizations. Run same scenarios WITH skill — agent should now comply.

**REFACTOR:** Find new rationalizations → add explicit counters → re-test until bulletproof.

## SKILL.md Structure

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
Bullet list with symptoms and use cases / when NOT to use

## Core Pattern
Before/after examples

## Quick Reference
Table or bullets for scanning

## Common Mistakes
What goes wrong + fixes
```

## Description Field (Critical)

- Start with "Use when..." — triggering conditions ONLY
- **NEVER summarize the skill's process or workflow** — Claude may follow the description instead of reading the full skill
- Written in third person
- Under 500 characters if possible

```yaml
# BAD: Summarizes workflow
description: Use when executing plans - dispatches subagent per task with code review

# GOOD: Just triggering conditions
description: Use when executing implementation plans with independent tasks
```

## File Location

```
~/.claude/skills/skill-name/SKILL.md        # Personal (Claude Code)
~/.agents/skills/skill-name/SKILL.md        # Personal (Codex)
```

Or in the project for shared skills.

## Deployment Checklist (Mandatory for EACH skill)

**RED Phase:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run WITHOUT skill — document baseline behavior verbatim

**GREEN Phase:**
- [ ] Name uses only letters, numbers, hyphens
- [ ] YAML frontmatter: name + description only (max 1024 chars)
- [ ] Description starts with "Use when..." — no workflow summary
- [ ] Addresses specific baseline failures
- [ ] Run WITH skill — verify agents comply

**REFACTOR Phase:**
- [ ] Identify new rationalizations from testing
- [ ] Add explicit counters
- [ ] Re-test until bulletproof

**Never deploy an untested skill.**
