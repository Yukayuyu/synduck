# Mission

Build AI Context Canvas: a local-first spatial conversation interface
where humans can see and control the context supplied to an LLM.

# Core product invariant

Canvas is not the source of truth.
Domain entities and provenance are the source of truth.

# Architecture rules

1. Structural edges are deterministic.
2. AI-generated semantic edges are proposals until confirmed.
3. No model output may mutate persistent graph data before schema validation.
4. Every AI-generated Turn must reference its input_context_set_id.
5. Excerpts must preserve source_block_id, selector, snapshot, and content hash.
6. Context Compiler must expose an inspectable Context Package.
7. Excluded context must never silently enter model input.
8. Superseded/rejected items must not be treated as current facts.
9. Layout Planner returns intents; it does not directly mutate node positions.
10. MVP uses one underlying LLM with role-specific workflows.
11. Do not introduce multi-agent orchestration without an approved issue.
12. Do not introduce a dedicated Graph DB without benchmark evidence.

# MVP non-goals

- multiplayer collaboration
- autonomous agent swarm
- live Obsidian sync
- full filesystem RAG
- mobile client
- automatic whole-canvas rearrangement

# Required checks before completing an issue

- typecheck
- lint
- unit tests
- relevant integration tests
- no schema migration left undocumented

# Definition of Done

A task is complete only if:
- acceptance criteria pass,
- tests exist where reasonable,
- persistence survives app restart,
- no provenance data is dropped,
- user-visible behavior is documented.

# Working environment

Use the existing isolated checkout; do not create a Git worktree unless requested.
Keep secrets server-side and never log model payloads or credentials.
