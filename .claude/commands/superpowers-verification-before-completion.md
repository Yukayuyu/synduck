---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - evidence before assertions always
---

# Verification Before Completion

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in THIS message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN:      Execute the FULL command (fresh, complete)
3. READ:     Full output, check exit code, count failures
4. VERIFY:   Does output confirm the claim?
           - If NO: State actual status with evidence
           - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags — STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!")
- About to commit/push/PR without running verification
- Trusting agent success reports
- Relying on partial verification
- ANY wording implying success without having run verification

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

```
✅ [Run test command] → [See: 34/34 pass] → "All tests pass"
❌ "Should pass now" / "Looks correct"

✅ [Run build] → [See: exit 0] → "Build passes"
❌ "Linter passed" (linter doesn't check compilation)

✅ Re-read plan → checklist → verify each → report gaps or completion
❌ "Tests pass, phase complete"

✅ Agent reports success → check VCS diff → verify changes → report actual state
❌ Trust agent report
```

## Regression Tests (TDD Red-Green)

Write test → Run (MUST PASS) → Revert fix → Run (MUST FAIL) → Restore fix → Run (MUST PASS)

A regression test that was never watched to fail is not a regression test.

## When To Apply

**ALWAYS before:**
- Any variation of success/completion claims
- Any expression of satisfaction
- Committing, PR creation, task completion
- Moving to the next task
- Delegating to agents

## The Bottom Line

Run the command. Read the output. THEN claim the result. No shortcuts.
