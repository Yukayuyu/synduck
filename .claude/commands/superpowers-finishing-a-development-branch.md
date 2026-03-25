---
name: finishing-a-development-branch
description: Use when implementation is complete and you need to verify, then merge, push as PR, keep, or discard the branch
---

# Finishing a Development Branch

Guide completion of development work by presenting clear options and handling the chosen workflow.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

**Core principle:** Verify tests → Present options → Execute choice → Clean up.

## Step 1: Verify Tests

Run the project's test suite. If tests fail, show failures and stop — do NOT proceed to Step 2.

## Step 2: Determine Base Branch

```bash
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

## Step 3: Present Exactly These 4 Options

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

Don't add extra explanation — keep options concise.

## Step 4: Execute Choice

**Option 1: Merge Locally**
```bash
git checkout <base-branch> && git pull
git merge <feature-branch>
# Run tests on merged result
git branch -d <feature-branch>
```
Then: cleanup worktree (Step 5)

**Option 2: Push and Create PR**
```bash
git push -u origin <feature-branch>
gh pr create --title "<title>" --body "..."
```
Then: cleanup worktree (Step 5)

**Option 3: Keep As-Is**
Report the branch and worktree path. Do NOT cleanup worktree.

**Option 4: Discard**
Confirm first — require typed `discard`. Then:
```bash
git checkout <base-branch>
git branch -D <feature-branch>
```
Then: cleanup worktree (Step 5)

## Step 5: Cleanup Worktree

For Options 1, 2, 4 only:
```bash
git worktree remove <worktree-path>
```

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch |
|--------|-------|------|---------------|----------------|
| 1. Merge locally | ✓ | - | - | ✓ |
| 2. Create PR | - | ✓ | ✓ | - |
| 3. Keep as-is | - | - | ✓ | - |
| 4. Discard | - | - | - | ✓ (force) |

## Red Flags

**Never:**
- Proceed with failing tests
- Delete work without typed `discard` confirmation
- Force-push without explicit request
- Cleanup worktree for Option 2 or 3
