# .claude (synduck)

Project scaffolding to make Claude Code/autonomous loops safer and more repeatable.

- `allowlist.txt` — commands allowed in guarded mode
- `prompts/` — reusable task prompts
- `checklists/` — pre-commit / triage checklists
- `scripts/` — validation and reporting helpers

## Typical flow
1) Create a branch
2) Use a prompt from `prompts/`
3) Run validation: `.claude/scripts/validate_web.sh`
4) Run guarded loop if needed: `tools/autoloop/loop_web.sh`
5) Commit and open PR
