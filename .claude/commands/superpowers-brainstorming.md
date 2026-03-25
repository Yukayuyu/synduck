---
name: brainstorming
description: Use when starting new work that needs a design before implementation - explores approaches, writes a spec, and gates on user approval before any code is written
---

# Brainstorming

Structured process for turning ideas into fully formed designs before implementation begins.

**Announce at start:** "I'm using the brainstorming skill to work through this design."

**Hard gate:** Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it. This applies universally, regardless of perceived project complexity.

## Process (9 steps)

1. **Explore project context** — review existing files, structure, patterns
2. **Offer visual companion** (if appropriate) — standalone message for consent
3. **Ask clarifying questions** — one per message, prefer multiple-choice
4. **Propose 2-3 approaches** — with trade-offs and a recommendation
5. **Present design** — in sections scaled to complexity, seek approval after each
6. **Write design document** — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
7. **Spec review loop** — dispatch reviewer subagent, iterate up to 3 times
8. **User reviews written spec** — gate before proceeding
9. **Transition to implementation** — invoke `writing-plans` skill only

## Key Principles

- One question per message — never overwhelm
- Apply YAGNI ruthlessly — remove unnecessary features
- Always explore alternatives before settling
- Design for isolation with clear unit boundaries
- Follow existing patterns in the codebase
- No project is "too simple" to skip design

## Terminal State

After brainstorming completes, the ONLY next step is invoking `superpowers:writing-plans`. Do not invoke frontend-design, mcp-builder, or any other implementation skill directly.
