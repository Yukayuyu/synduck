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
- ACC-002: canonical schema baseline implemented. Workspace, Conversation, Turn, ContentBlock, Excerpt, Node, structural/semantic Edge, ContextSet, ContextItem, ContextConflict and ContextPackage have TypeScript and runtime schemas. Image selectors and P1 node representations remain deferred.
- ACC-003 / ACC-005: the slice's SQLite tables, indexes, foreign keys, atomic commands, ordered turns, context snapshots, node creation and moves are implemented. General deletion / undo and a complete per-entity CRUD API remain open; do not close the entire original issues.
- ACC-004: canvas pan / zoom, drag, React Flow selection and persisted viewport implemented. Browser test renders 100+ nodes and performs a real drag before reload.
- ACC-006: conversation / turn engine implemented with parent and sequence metadata, model identifiers, context references and failure lifecycle. Storage accepts ordinal content blocks; the current UI generates one text block per turn.
- ACC-007 / ACC-008: exact text selection, snapshot/hash provenance, return-to-source highlighting and atomic excerpt + branch creation implemented; rollback and stale-source tests pass.
- ACC-009: readable conversation cards with inline composers, compact zoom representation and on-demand floating inspectors implemented. Rich four-level semantic representations remain open.
- ACC-010: per-turn selection, workspace pin/exclude/restore, immutable context snapshots and stale-preview rejection implemented. Exclude has highest precedence.
- ACC-011 / ACC-012: deterministic resolve / structural retrieval / scoring / deduplication / budget omissions / lifecycle / conflict package baseline implemented. Explicit over-budget inputs block sending. No model summarization, lexical retrieval or model-based conflict classifier is included.
- ACC-013: inspector shows included sources, roles, scores, explanations, exclusions, conflicts, conservative estimates, raw package and historical turn packages. Clicking locates a node. Hover-to-highlight and more detailed source-map navigation remain open.
- ACC-014 / ACC-015: provider-neutral gateway, configurable OpenAI Responses SSE adapter, validated output, source-ID checks, temporary drafts and retryable generation implemented. Demo and injected-transport tests pass. Live provider verification remains pending credentials and model selection, so full real-AI acceptance is not claimed.
- ACC-021: unit/integration regressions and two browser flows implemented; actual model answer-quality comparisons and machine-readable quality evaluation reports remain open.
- ACC-022: no provider secrets in client payloads, no raw payload logging, local-only host/origin checks, safe error normalization, immutable input packages and recoverable generation errors implemented. Full audit tooling and destructive action UX are still open.
- ACC-020 (native-project part): versioned text-project export/import, full provenance/ID preservation, integrity and reference validation, explicit replacement preview, stale-preview protection and transactional recovery snapshots implemented. The JSON Canvas adapter and asset transport remain open, so the full mixed-scope issue is not closed.
- ACC-016–019 / ACC-023–025: not implemented.

## Validation evidence

- Node 24.19.0; pnpm 11.19.0; lockfile committed; supply-chain checks left enabled.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and Chromium end-to-end checks pass. Current results: 39 unit/integration tests pass; all 9 Chromium browser tests pass. The 2 project tests also pass when run independently.
- Browser flow: conversation → labelled demo answer → real DOM text selection → excerpt + branch → exact context preview → answer → source highlight → pin/exclude → reload.
- Browser scale check: 100 additional nodes, actual pointer drag, persisted coordinates and viewport after reload.
- SQLite integration closes and reopens an on-disk database and verifies provenance and branch integrity. Excerpt/branch failure rolls back the whole transaction.
- SSE transport tests fragment UTF-8 bytes and structured JSON; invalid sources, incomplete responses and HTTP failures are rejected without leaking raw responses.
- Context policy excludes original sources, aliases and transitive dependent answers even if the model reported no citations. Human prompts remain explicit user input.
- CI workflow is included. Its hosted execution has not been observed in this task.
- Native project validation covers round-trip provenance, recovery, tampered checksums, dangling references, duplicate IDs, unsupported assets/fields, transaction rollback, explicit API confirmation, geometry-only stale previews, migration from v1 and active-generation protection.
- Browser coverage downloads a real project file, uploads it for preview, verifies the confirmation gate, restores IDs and sources, then restores the automatic recovery point. A separate malformed-file case confirms no replacement is offered. The project browser suite creates its own data and can run independently.

## Next milestone

1. Configure a real provider/model, then verify the same end-to-end flow with actual structured streamed responses.
2. Implement reference-safe deletion/undo; native text-project backup and recovery are now available.
3. Complete the remaining P0 acceptance details and run context-quality fixtures against raw-history / ancestor-only baselines before expanding into P1.

## ChatGPT account and cross-device extension (2026-10-05)

The user explicitly expanded the original mobile-client non-goal to include Windows and iOS browser use. Implemented official Codex 0.160.0 App Server device authorization, account status/cancel/logout, persisted provider selection, isolated application credentials and ephemeral structured generation. Host tools are denied, environment access is empty, and shell/search/plugins/memory are disabled; source validation remains mandatory. Codex's own protocol instructions are outside the application-level context estimate. Real ChatGPT login and generation are not yet validated.

Optional password-protected HTTPS proxy mode adds host/origin checks, bounded login attempts and expiring HttpOnly/SameSite/Secure sessions. Default loopback remains. Responsive phone tabs, touch-selection support and home-screen metadata are implemented, along with a Windows-compatible Node development launcher. No native iOS app, offline mode, autonomous graph edits, hosted deployment or multiplayer was added. See `docs/windows-ios.md`.

Validation: 38 unit/integration tests and 7 Chromium browser flows pass, including new auth and touch-layout checks. The real pinned Codex binary initialized against a disposable empty home and returned signed-out status without calling a model. WebKit downloads are blocked by the cloud egress policy (HTTP 403); Safari/iOS and native Windows remain unverified. CI definitions cover Windows core checks and Linux WebKit mobile tests; hosted results have not been observed.

## Canvas-first interaction (2026-10-06)

Replaced the fixed three-column interface with a full-window canvas, floating top controls and a bottom tool palette. Conversation and context navigation are closed by default and open as dismissible overlays. Full conversation text and live drafts render inside each card; only the selected card shows its composer. All readable cards support exact text selection and a screen-positioned excerpt / follow-up toolbar. Card headers are drag handles, so dragging text does not move the card. Mouse and touch selection stay scoped to their source node.

Double-clicking empty space creates a conversation at the corresponding canvas coordinates. New cards use wider spacing and avoid existing card bounds; existing node positions are never rearranged. Optional creation coordinates are runtime-validated. No schema migration or provenance change is needed.

Checks: 39 unit/integration tests and 9 Chromium browser tests, including real mouse text selection on an inactive card, multiple visible conversations, correct branch source input, canvas-coordinate creation, pan-versus-create separation, mobile visibility, existing 100-node drag/persistence, and project recovery. Windows and native iOS validation remains separate from Chromium phone emulation.
