Set up a SessionStart hook so Claude Code on the web can run tests and linters automatically when a session begins.

## What It Does

A SessionStart hook runs a shell command each time a new Claude Code session starts. Use it to:
- Install dependencies (`npm install`)
- Start dev servers or services
- Run initial lint/type checks
- Print environment info or onboarding instructions

## Setup

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/session-start.sh",
            "timeout": 60,
            "statusMessage": "Setting up session..."
          }
        ]
      }
    ]
  }
}
```

## Example Session Start Script

Create `.claude/scripts/session-start.sh`:

```bash
#!/bin/bash
set -e

echo "=== Session Start ==="

# Install web app dependencies if needed
if [ ! -d "apps/web/node_modules" ]; then
  echo "Installing dependencies..."
  cd apps/web && npm install
fi

# Print quick-start info
echo "Dev server: npm run dev (in apps/web)"
echo "Checks:     npm run lint && npm run build (in apps/web)"
echo "Ready."
```

Make it executable:
```bash
chmod +x .claude/scripts/session-start.sh
```

## Tips

- Keep hooks fast (under 30s) to avoid blocking session startup
- Use `|| true` to prevent hook failures from blocking the session
- For long-running tasks, use `"async": true` to run in background
- The hook receives no stdin — don't pipe to it

## Validation

After writing the hook, verify JSON syntax:
```bash
jq -e '.hooks.SessionStart' .claude/settings.json
```
