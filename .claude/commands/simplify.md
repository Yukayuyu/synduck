Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run `git diff` (or `git diff HEAD` for staged changes) to see what changed. If no git changes, review the most recently modified files mentioned in the conversation.

## Phase 2: Launch Three Review Agents in Parallel

Pass the full diff to all three agents concurrently.

### Agent 1: Code Reuse Review
- Search for existing utilities/helpers that could replace newly written code
- Flag new functions that duplicate existing functionality
- Flag inline logic that could use existing utilities (hand-rolled string manipulation, path handling, env checks, type guards)

### Agent 2: Code Quality Review
- **Redundant state**: state that duplicates existing state or could be derived
- **Parameter sprawl**: adding params instead of restructuring
- **Copy-paste with variation**: near-duplicate blocks that should be unified
- **Leaky abstractions**: exposing internals or breaking abstraction boundaries
- **Stringly-typed code**: raw strings where constants/enums already exist
- **Unnecessary JSX nesting**: wrapper elements that add no layout value
- **Unnecessary comments**: comments explaining WHAT (not WHY); delete narration, keep non-obvious constraints

### Agent 3: Efficiency Review
- **Unnecessary work**: redundant computations, repeated reads, duplicate API calls, N+1 patterns
- **Missed concurrency**: sequential independent operations that could be parallel
- **Hot-path bloat**: new blocking work in startup or per-request hot paths
- **Unconditional updates**: store/state updates in polling loops without change-detection guards
- **Unnecessary existence checks**: pre-checking before operating (TOCTOU) — operate and handle errors
- **Memory**: unbounded data structures, missing cleanup, event listener leaks
- **Overly broad operations**: reading entire files when only part is needed

## Phase 3: Fix Issues

Aggregate findings from all three agents and fix each valid issue directly. Note and skip false positives. Briefly summarize what was fixed (or confirm code was already clean).
