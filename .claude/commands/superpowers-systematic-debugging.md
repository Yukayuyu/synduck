---
name: systematic-debugging
description: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes
---

# Systematic Debugging

Random fixes waste time and create new bugs.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## The Four Phases

### Phase 1: Root Cause Investigation

Before attempting ANY fix:

1. **Read error messages carefully** — don't skip past errors; read stack traces completely
2. **Reproduce consistently** — can you trigger it reliably? What are the exact steps?
3. **Check recent changes** — git diff, recent commits, new dependencies, config changes
4. **Gather evidence in multi-component systems** — add diagnostic instrumentation at each component boundary; run once to gather evidence showing WHERE it breaks, THEN analyze

   ```bash
   # Example: instrument each layer
   echo "=== Layer 1 env: ${VAR:+SET}${VAR:-UNSET} ==="
   # ... then next layer ...
   ```

5. **Trace data flow** — where does the bad value originate? Trace backward up the call stack to the source

### Phase 2: Pattern Analysis

1. Find working examples — similar working code in the same codebase
2. Compare against references — read COMPLETELY, every line
3. Identify differences — list every difference, however small
4. Understand dependencies — config, environment, assumptions

### Phase 3: Hypothesis and Testing

1. Form a single hypothesis: "I think X is the root cause because Y"
2. Test minimally — smallest possible change, one variable at a time
3. Verify before continuing — worked? → Phase 4; didn't work? → new hypothesis
4. If you don't know, say so — don't pretend to know

### Phase 4: Implementation

1. Create failing test case first (use `superpowers:test-driven-development`)
2. Implement single fix — address root cause, ONE change, no "while I'm here" improvements
3. Verify fix — tests pass? No regressions?
4. If fix doesn't work — STOP. Count attempts. If ≥ 3: question the architecture

**3+ failed fixes = architectural problem.** Each fix revealing a new problem in a different place is the signal. Discuss with your human partner before attempting more fixes.

## Red Flags — STOP and Follow Process

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- Proposing solutions before tracing data flow
- "Here are the main problems: [lists fixes without investigation]"
- "One more fix attempt" (when already tried 2+)

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple" | Simple issues have root causes too |
| "Emergency, no time" | Systematic is FASTER than guess-and-check |
| "Just try this first" | First fix sets the pattern. Do it right. |
| "I see the problem" | Seeing symptoms ≠ understanding root cause |
| "One more fix attempt" | 3+ failures = architectural problem |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| 1. Root Cause | Read errors, reproduce, gather evidence | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |

## Supporting Files (in obra/superpowers repo)

- `root-cause-tracing.md` — trace bugs backward through call stack
- `defense-in-depth.md` — add validation at multiple layers
- `condition-based-waiting.md` — replace arbitrary timeouts with condition polling
