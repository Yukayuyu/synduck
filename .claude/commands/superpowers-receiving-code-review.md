---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable
---

# Receiving Code Review

Code review requires technical evaluation, not emotional performance.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

```
1. READ:      Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY:    Check against codebase reality
4. EVALUATE:  Technically sound for THIS codebase?
5. RESPOND:   Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Forbidden Responses

**NEVER:**
- "You're absolutely right!" — explicit violation
- "Great point!" / "Excellent feedback!" — performative
- "Let me implement that now" — before verification
- Any gratitude expression ("Thanks for...", "Thank you...")

**INSTEAD:**
- Restate the technical requirement
- Ask clarifying questions
- Push back with technical reasoning if wrong
- Just start working (actions > words)

## Handling Unclear Feedback

If any item is unclear, STOP — do not implement anything yet. Ask for clarification on unclear items first. Items may be related; partial understanding = wrong implementation.

## Source-Specific Handling

**From your human partner:** Trusted — implement after understanding. Still ask if scope unclear. Skip to action or technical acknowledgment.

**From external reviewers:** Before implementing, check:
1. Technically correct for THIS codebase?
2. Breaks existing functionality?
3. Does reviewer understand full context?
4. Conflicts with prior architectural decisions?

If suggestion seems wrong, push back with technical reasoning.

## YAGNI Check for "Professional" Features

```
IF reviewer suggests "implementing properly":
  grep codebase for actual usage

  IF unused: "This endpoint isn't called. Remove it (YAGNI)?"
  IF used:   Then implement properly
```

## Implementation Order (Multi-Item Feedback)

1. Clarify anything unclear FIRST
2. Blocking issues (crashes, security)
3. Simple fixes (typos, imports)
4. Complex fixes (refactoring, logic)
5. Test each fix individually
6. Verify no regressions

## When To Push Back

Push back when:
- Suggestion breaks existing functionality
- Reviewer lacks full context
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Conflicts with architectural decisions

How: Use technical reasoning, not defensiveness. Reference working tests/code.

## Acknowledging Correct Feedback

```
✅ "Fixed. [Brief description of what changed]"
✅ "Good catch - [specific issue]. Fixed in [location]."
✅ [Just fix it and show in the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
```

## GitHub Thread Replies

Reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.
