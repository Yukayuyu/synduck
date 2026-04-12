Customize keyboard shortcuts, rebind keys, or add chord bindings in Claude Code.

## Keybindings File

Edit `~/.claude/keybindings.json` to customize shortcuts. Create it if it doesn't exist.

## Format

```json
[
  {
    "key": "ctrl+s",
    "command": "sendMessage"
  },
  {
    "key": "ctrl+shift+r",
    "command": "/simplify"
  }
]
```

## Available Commands

| Command | Description |
|---------|-------------|
| `sendMessage` | Submit the current message |
| `clearConversation` | Clear the conversation |
| `toggleThinking` | Toggle extended thinking |
| Any `/skill-name` | Invoke a slash command |

## Chord Bindings

Chord bindings require two key presses in sequence:

```json
{
  "key": "ctrl+k ctrl+s",
  "command": "sendMessage"
}
```

## Modifier Keys

- `ctrl` — Control key
- `shift` — Shift key
- `alt` — Alt/Option key
- `cmd` — Command key (Mac only)

## Example: Change Submit Key

To submit with `ctrl+enter` instead of `enter`:

```json
[
  { "key": "ctrl+enter", "command": "sendMessage" }
]
```

## Workflow

1. Read `~/.claude/keybindings.json` (or note it doesn't exist yet)
2. Apply the requested changes
3. Confirm the new binding

Changes take effect after restarting Claude Code (or opening `/hooks` to reload config).
