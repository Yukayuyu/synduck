---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development (TDD)

**Core principle:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.

## The Iron Law

```
Write test → Watch it FAIL → Write minimal code → Watch it PASS → Refactor
```

If you didn't watch the test fail, you don't know if it tests the right thing.

## The Red-Green-Refactor Cycle

1. **RED** — Write a minimal failing test demonstrating the desired behavior
2. **GREEN** — Write the simplest code necessary to make the test pass
3. **REFACTOR** — Clean up and improve while keeping tests passing

## Why Tests Must Come First

Tests written after implementation:
- Pass immediately, proving nothing
- Test implementation details rather than behavior
- Miss edge cases
- Give false confidence

## Common Rationalizations — All Invalid

| Excuse | Reality |
|--------|---------|
| "Manual testing is enough" | Manual testing cannot replace automated coverage |
| "Tests after achieve the same goals" | Tests-after = "what does this do?"; Tests-first = "what SHOULD this do?" |
| "It's too complex to test first" | Complexity in testing reveals design problems worth fixing |
| "I'm confident it's correct" | Confidence ≠ evidence |
| "It's too simple to need a test" | Simple code breaks. Test takes 30 seconds. |
| "Sunk cost — I've already written it" | Delete it. Start with the test. |

## Red Flags — STOP and Start Over

If you catch yourself:
- Writing code before the test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about the spirit, not the ritual"
- "This is different because..."

**All of these mean: Delete the code. Start over with TDD.**

## When to Apply

- New features
- Bug fixes (write a test that reproduces the bug FIRST)
- Refactoring (ensure test coverage before changing structure)
- Any behavior change

## Exceptions

Only with explicit approval from your human partner.

## The Bottom Line

Violating the letter of these rules is violating the spirit of these rules. No exceptions.
