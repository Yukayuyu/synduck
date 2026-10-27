# Database and domain versions

## 001 / domain 0.1.0

Initial schema; no prior application database exists. SQLite migrations are recorded in `schema_migrations` and run transactionally and idempotently. Foreign keys are enabled on every connection. The API is single-user, local-first.

Domain objects use stable UUIDs. Timestamps are UTC ISO strings. Text selector offsets are **half-open UTF-16 code-unit offsets**, matching browser Range / JavaScript string slicing; they are not Unicode code-point or byte offsets. Content hashes are SHA-256 of UTF-8 source text, prefixed `sha256:`.

View nodes reference canonical domain IDs. The first slice implements conversation, turn and excerpt nodes; other proposed node types remain in the backlog. Excerpt creation verifies the full source hash and exact selector text. Source blocks are immutable in this slice.

Context sets and compiled packages are immutable snapshots; lifecycle and target-turn fields may transition to `used`. A preview records the graph revision. Generation rejects a stale preview instead of silently rebuilding a different input. Exclude dominates pin and select. Context pinning and node geometry are separate concepts.

Context items record the source actor and turn sequence. Conversation blocks retain chronological ordering within the same priority. Explicit exclusion conservatively blocks an excerpt's whole source block through aliases and follows input-package dependencies to exclude derived assistant answers transitively. This prevents a prior answer from reintroducing removed material; it may omit more than the exact excerpt range. The inspector explains this policy.

SQLite tables retain validated JSON entity payloads alongside typed indexed keys and foreign keys. Layout coordinates are part of node payloads, not conversation content. Future schema changes need a new numbered migration and a documented compatibility strategy.

## 002 / native project format 1

Adds `recovery_snapshots(id, created_at, name, payload)`. This is an additive, transactional migration; existing graph tables, IDs and source data remain intact. Startup and `pnpm db:migrate` apply it idempotently. A test opens an existing version-1 database and verifies that migration preserves its full graph snapshot.

Native project JSON declares `format: ai-context-canvas`, `format_version: 1`, an export timestamp, the canonical snapshot, an empty asset manifest and a SHA-256 checksum over canonicalized JSON. Object keys are sorted for checksum computation; array order is retained. Files are limited to 12 MiB, and unsupported fields/assets are rejected to avoid silent data loss.

Import validates references and hashes before writing, requires explicit confirmation plus the current workspace identity/revision/full-snapshot fingerprint, and saves an automatic recovery copy in the same transaction. All existing workspace graph rows are replaced in foreign-key-safe order, with foreign keys still enabled. An insertion failure rolls back both the replacement and its recovery record. Restored entity IDs and historical context packages are preserved. The live workspace revision advances beyond both old and imported revisions to invalidate any existing preview. Context and graph schemas remain domain version 0.1.0.

## 0.6.0 optional domain fields (no SQL migration)

Conversation fork_origin freezes source identities and the initial task. Excerpt collection_source_ids stores flat, nonempty source membership while preserving the anchor quote. Existing rows and native format-1 files without these fields are unchanged. New exports retain and validate these fields; older applications reject unsupported fields rather than dropping provenance. See [behavior and compatibility](thought-islands.md).

## 003 / canvas catalog and scoped local tasks

Adds canvas_catalog(id, is_primary, created_at, name), its unique primary index, and canvas_task_owners(task_id, canvas_id) transactionally and idempotently. Existing graph tables, root database paths and canonical entity IDs are unchanged. A canvas catalog ID is stable across project replacement and can differ from the workspace ID inside an imported file. Additional canvases use separate <DATABASE_PATH>.canvases/<UUID>.sqlite files. Each owns its graph and recovery table; restoring one does not replace the catalog or other databases. Missing files are not initialized as empty replacements.

Optional Excerpt.external_origin and content-block structured_data.external_origin preserve original canvas/workspace/block/turn IDs, full source hash and UTF-16 range while only the explicitly selected fragment is copied. Old format-1 files remain valid. New external provenance is retained and validated; older clients reject unsupported fields on import. Browser drafts are local per-canvas data, outside native project exports. See [behavior, backups and request isolation](multiple-canvases.md).

## 0.8.0 optional presentation size (no SQL migration)

Node.size_mode optionally selects automatic or manual display sizing and reuses the existing width/height fields. Existing nodes retain automatic sizing until explicitly resized. Geometry updates do not change semantic revision or mutate sealed input packages. Native format-1 validation retains the field; older versions reject unsupported fields. Markdown rendering uses immutable source offsets without changing stored text, hashes or excerpt ranges. See [operation and compatibility](developer-workflow.md).
