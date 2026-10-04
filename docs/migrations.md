# Database and domain versions

## 001 / domain 0.1.0

Initial schema; no prior application database exists. SQLite migrations are recorded in `schema_migrations` and run transactionally and idempotently. Foreign keys are enabled on every connection. The API is single-user, local-first.

Domain objects use stable UUIDs. Timestamps are UTC ISO strings. Text selector offsets are **half-open UTF-16 code-unit offsets**, matching browser Range / JavaScript string slicing; they are not Unicode code-point or byte offsets. Content hashes are SHA-256 of UTF-8 source text, prefixed `sha256:`.

View nodes reference canonical domain IDs. The first slice implements conversation, turn and excerpt nodes; other proposed node types remain in the backlog. Excerpt creation verifies the full source hash and exact selector text. Source blocks are immutable in this slice.

Context sets and compiled packages are immutable snapshots; lifecycle and target-turn fields may transition to `used`. A preview records the graph revision. Generation rejects a stale preview instead of silently rebuilding a different input. Exclude dominates pin and select. Context pinning and node geometry are separate concepts.

Context items record the source actor and turn sequence. Conversation blocks retain chronological ordering within the same priority. Explicit exclusion conservatively blocks an excerpt's whole source block through aliases and follows input-package dependencies to exclude derived assistant answers transitively. This prevents a prior answer from reintroducing removed material; it may omit more than the exact excerpt range. The inspector explains this policy.

SQLite tables retain validated JSON entity payloads alongside typed indexed keys and foreign keys. Layout coordinates are part of node payloads, not conversation content. Future schema changes need a new numbered migration and a documented compatibility strategy.
