# Claude Code "skills" for synduck

Claude Code doesn't use OpenClaw skills; instead we make the project easy for Claude to work in by providing:

- **Project memory**: `CLAUDE.md`
- **Repeatable checks**: `tools/autoloop/*.sh`
- **Clear PR/Issue structure**: `.github/*`
- **Editor defaults**: `.vscode/settings.json`

## Recommended workflows

### 1) Plan → Implement → Check (default)

1. Ask for a plan first.
2. Implement the smallest increment.
3. Run `tools/autoloop/check_web.sh`.
4. Summarize what changed + results.

### 2) Guarded autopilot loop (semi-auto)

Use `tools/autoloop/loop_web.sh` to iterate with hard limits.

## Safe command policy

Allowed commands should be limited to repo + web app checks.
Avoid any system-wide operations.
