Run a prompt or slash command on a recurring interval.

## Usage

```
/loop [interval] [prompt or /command]
```

**Default interval:** 10 minutes

## Examples

```
/loop 5m /simplify
/loop 30s check if the build is passing and report status
/loop 10m poll the deploy status and notify me when done
```

## How It Works

1. Parse the interval (e.g. `5m`, `30s`, `1h`) and the prompt/command to repeat
2. Execute the prompt/command immediately
3. Wait for the specified interval
4. Repeat until the user cancels or a stopping condition is met

## When to Use

- Polling for status (CI/CD, deploys, external services)
- Running recurring checks on a schedule within a session
- Repeating a slash command at regular intervals

## Stopping

The loop runs until you cancel it (Ctrl+C or close the session). You can also instruct the loop to stop when a condition is met (e.g. "until the build passes").

> **Note:** For recurring tasks that run outside of a session (e.g. overnight jobs), use `/schedule` instead.
