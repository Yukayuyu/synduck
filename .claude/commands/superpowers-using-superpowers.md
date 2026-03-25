---
name: using-superpowers
description: Use at the start of any task to check which superpowers skills apply before responding
---

# Using Superpowers

**Core principle:** Invoke relevant skills before responding. If there is even a 1% chance a skill might apply, you ABSOLUTELY MUST invoke it.

## Priority Order

1. **User's explicit instructions** (highest)
2. **Superpowers skills** (override default behavior)
3. **Default system prompt** (lowest)

## Implementation Pattern

1. Receive task
2. Check for applicable skills immediately
3. Announce which skill is being used and why
4. Follow the skill exactly if it contains a checklist
5. Then respond / take action

## Skill Categories

**Rigid skills (follow without adaptation):**
- `superpowers:test-driven-development`
- `superpowers:systematic-debugging`
- `superpowers:verification-before-completion`

**Flexible skills (adapt principles contextually):**
- `superpowers:brainstorming`
- `superpowers:writing-plans`
- `superpowers:dispatching-parallel-agents`

## Precedence (When Multiple Skills Apply)

Process/workflow skills take precedence over implementation skills:
- Debugging situation → use systematic-debugging BEFORE any other skill
- New feature → use brainstorming BEFORE writing-plans BEFORE executing-plans
- Completing work → use verification-before-completion BEFORE claiming done

## Red Flags for Rationalization

These are reasons to skip skills — treat them as red flags, not exemptions:
- "This is just a simple question"
- "I'll gather info first, then invoke the skill"
- "The skill doesn't quite apply here"
- "I know what to do without the skill"

**All of these mean: Check the skill anyway.**
