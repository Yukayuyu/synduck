# Delivery status

First milestone: the demonstrable vertical slice from the supplied specification, not the entire P0 backlog.

## Assumptions

- Single-user, local-first browser application; no hosted multi-user authentication.
- React / Vite / React Flow, Fastify, TypeScript, Zod, SQLite.
- Node 24 built-in SQLite; no native database addon or ORM needed for this slice.
- A provider-neutral gateway with an OpenAI Responses adapter. The model is configured, not hardcoded.
- No credentials are available in the current environment. Offline demo mode must never be presented as real AI.
- Compression v0 may omit low-priority sources with explicit diagnostics; no unsourced generated summaries.
- No P1/P2 layout assistance, semantic linker, embeddings, image regions, or collaboration.

## Checkpoints

- ACC-001: complete. Frozen installation, simultaneous web/API startup, proxied health request, typecheck, lint, SQLite runtime test and production client build passed.
- Other issues: not yet complete; see subsequent checkpoints and validation evidence.
