Create, update, list, or run scheduled remote agents (triggers) that execute on a cron schedule.

## Usage

```
/schedule [action] [options]
```

## Actions

| Action | Description |
|--------|-------------|
| `create` | Create a new scheduled trigger |
| `list` | List all existing scheduled triggers |
| `run <id>` | Run a trigger immediately |
| `update <id>` | Update an existing trigger |
| `delete <id>` | Delete a trigger |

## Examples

```
/schedule create — run /simplify every day at 9am
/schedule create — check PR status every hour and comment if stale
/schedule list
/schedule run abc123
```

## Cron Format

Triggers use standard cron syntax:
```
# ┌───── minute (0-59)
# │ ┌───── hour (0-23)
# │ │ ┌───── day of month (1-31)
# │ │ │ ┌───── month (1-12)
# │ │ │ │ ┌───── day of week (0-6, Sun=0)
# │ │ │ │ │
  * * * * *
```

Common schedules:
- `0 9 * * 1-5` — weekdays at 9am
- `0 * * * *` — every hour
- `*/15 * * * *` — every 15 minutes

## Difference from /loop

- `/loop` — recurs within the current session (stops when session ends)
- `/schedule` — creates a persistent remote trigger that runs even when you're offline
