Modify Claude Code configuration by updating settings.json files.

If the user wants something to happen automatically in response to an EVENT (e.g. "after writing files, run prettier", "when I run bash commands, log them"), configure a **hook** in settings.json — memory/preferences cannot trigger automated actions.

**Hook events:** PreToolUse, PostToolUse, PreCompact, PostCompact, Stop, Notification, SessionStart

## Workflow

1. **Clarify intent** — ask if the request is ambiguous
2. **Read existing file** — use Read tool on the target settings file
3. **Merge carefully** — preserve existing settings, especially arrays
4. **Edit file** — use Edit tool to apply changes
5. **Confirm** — tell user what was changed

## Settings File Locations

| File | Scope | Git | Use For |
|------|-------|-----|---------|
| `~/.claude/settings.json` | Global | N/A | Personal preferences |
| `.claude/settings.json` | Project | Commit | Team-wide hooks, permissions |
| `.claude/settings.local.json` | Project | Gitignore | Personal project overrides |

## Common Tasks

**Allow a command without prompting:**
```json
{ "permissions": { "allow": ["Bash(npm:*)"] } }
```

**Add a PostToolUse hook (e.g. auto-format):**
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "..." }]
    }]
  }
}
```

**Set environment variable:**
```json
{ "env": { "DEBUG": "true" } }
```

Always read the file first and merge — never replace existing settings.
