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
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and Chromium end-to-end checks pass. Current results: 50 unit/integration tests pass; all 15 Chromium browser tests pass. The 2 project tests also pass when run independently.
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

## Codex diagnostics and editor focus (2026-10-08)

The previous Codex adapter discarded RPC errors and failed-turn errors and grouped them with tool rejection, interruption and the generation deadline. It also rejected passive `plan` / `contextCompaction` protocol items. Errors now retain safe categories and the request stage without returning upstream messages, credentials or model payloads. Retryable error notifications allow the official client to continue; a terminal error or the bounded generation deadline still stops and unloads the ephemeral thread. Final text can come from completed items or the complete turn payload/stream, but commentary, invalid JSON and unprovided citations are rejected.

The model dialog and `/api/models/codex/diagnostics` expose the most recent safe failure and clarify that account login and workspace authentication do not establish model access or available quota. Diagnostics are memory-only and must be captured after reproducing a failure in the running backend. An immediate failure reported on the user's Windows PC remains unconfirmed until its actual diagnostic category is observed; the cloud environment has no access to that PC's process or credentials.

Reproduced a focus-loss case in the old build: zooming below the card detail threshold unmounted the active textarea. Active cards now retain their composer through zoom, and a generating composer is read-only rather than disabled so it retains focus. Browser regressions preserve the exact text and selection through zoom, five minutes of simulated time, and a delayed failed generation. There is no application timer that resets focus every five minutes; that specific timing on the user's PC remains unconfirmed.

Checks: 44 unit/integration tests and 11 Chromium browser tests; production typecheck/build and lint. The real pinned Codex binary classified an invalid RPC request using an isolated signed-out home, with no model/account login request. Windows native execution and real-account generation remain separate validation steps.

## Codex model picker (2026-10-10)

The model dialog now reads the official App Server `model/list` catalog with pagination, using each entry's request model slug rather than its catalog ID. Hidden, non-text and already retired models are omitted. Availability NUX is an announcement of access, not a restriction. Discovery failure is explicit and retryable; the app never invents a fallback list. The picker can refresh and save a choice, preserving unsaved selection through refresh. An old model absent from the catalog requires an explicit replacement.

The selected model is stored as `codex_model` alongside the provider in the existing settings JSON, survives restart and mode switches, and takes precedence over the old environment model. Legacy provider-only files remain valid, with no database migration. New installations have no hardcoded Codex model. Catalog membership is rechecked before saving, and active generation prevents changes even if it starts during catalog I/O. Generation never silently changes the selected model, keeping persisted answer provenance accurate.

Checks: 48 unit/integration tests and 13 Chromium browser tests, including catalog pagination/filtering, newly accessible model selection, settings restart, stale model rejection, catalog failure/retry, HTTP model selection and actual request/provenance consistency, plus a concurrent generation check. Typecheck, lint and production build pass. Catalog and generation responses are simulated; the user's real model access and Windows execution remain unverified in this cloud environment.

## Codex reasoning depth (2026-10-11)

Added a reasoning-depth menu beside the model picker, using the official catalog's `supportedReasoningEfforts` and `defaultReasoningEffort`. Known levels have Chinese labels; future advertised values remain selectable without inventing extra levels. The model-default option omits the effort override. Models without adjustable effort only offer the default. Switching models resets the unsaved depth to default; catalog refresh preserves choices, and an unsupported saved level requires an explicit replacement.

The optional `codex_reasoning_effort` field in the existing settings JSON survives restarts and provider switches. Legacy settings remain valid, with no SQLite migration. Selection validates model-specific support before saving and keeps the existing generation lock, including concurrent catalog I/O. Generation sends the saved value in official `turn/start.effort`; no override is sent for the default. Tool and agent policies remain fixed.

Checks: 50 unit/integration tests and 15 Chromium browser tests, including model-specific options, persistence and restart, request propagation, removed and future levels, default reset, models without adjustable effort, and mobile selection. Typecheck, lint and production build pass. Real-account generation and native Windows remain unverified in this cloud environment.

# 0.2.0: local tasks and managed updates

The local task dialog now provides project-scoped file tools and individually approved command/write operations. Codex tasks use dynamic tool requests and keep their transcript separately from immutable canvas inputs. Manual tests need no model account. Task records include the project, selected model/depth, tool arguments, outcomes and the exact bounded result sent back to the model.

The Windows portable launcher keeps data outside version directories, verifies packages, checks readiness with a per-process identifier and restores the previous application/data on a failed or interrupted installation. Update checks, optional browser notifications, automatic downloads and local ZIP import are available; installation waits for user action and idle work. A tag-triggered release workflow and Windows/Linux portable smoke checks have been added. No tag or release is published by adding the workflow.

This does not implement MCP, a desktop screenshot/action loop, full filesystem RAG, or the context retention and large-canvas fixes identified in the assessment. Live ChatGPT dynamic-tool execution and Windows/iOS physical validation remain separate checks. See `docs/local-runtime-updates.md`.

Checks: 71 unit/integration tests, 18 Chromium browser tests, typecheck, lint and production build pass. The packaged application also passed four real process scenarios on Linux: successful upgrade with data/login/provenance retention, failed-start rollback, pending-journal recovery, and abrupt launcher exit cancelling generation followed by stale-lock recovery. Update feed responses and Codex model requests are simulated; no GitHub Release or paid model request was made.

## 0.3.0: MCP and visual desktop provenance

Added official SDK-based MCP stdio and Streamable HTTP connections with backend secret references, schema discovery/validation and explicit approval for server startup and every tool call. Local tasks also expose an approved Windows target-window tool for screenshots, coordinates, Unicode typing, fixed shortcuts and scrolling. Window/process identity and geometry are checked before input; results distinguish sent input from application success or uncertain side effects.

Canvas task cards persist independently from the native graph, show image/step summaries and link deterministically to an input context when present. The review dialog provides before/after images, click markers, approval and completion times, exact model image hashes, result details and a trace ZIP with image hashes and the existing input package. Evidence survives restarts and old pinned tasks remain reachable outside the recent history list. No SQLite schema migration is required; additions live under data/local-runtime. Desktop enablement expires on restart and project changes disconnect integrations.

Validation uses real local MCP stdio/HTTP services and a controlled model-image loop. Windows bridge enumeration is a platform-only test, skipped on Linux. Physical Windows screenshots/input, live ChatGPT multimodal execution and third-party MCP/OAuth remain unverified; see docs/mcp-desktop-traces.md.

Checks: 82 unit/integration tests pass, with one Windows-only bridge test skipped on Linux; 20 Chromium browser tests, typecheck, lint and production build pass. All four real portable upgrade/recovery scenarios pass on the 0.3.0 package. The source launcher also recovered a terminated zombie owner in this cloud container and served the 0.3.0 client and integration APIs. No Release tag or paid model request was made.

## 0.3.1: ordinary canvas text input (2026-10-14)

Reproduced missing characters with real keyboard typing in the 0.3.0 composer, including punctuation. A reduced React Flow example also lost rapid keystrokes when replacing the node array during each edit; it accepted the complete text with stable nodes. Card contents now render through React Context instead of being cached inside effect-synchronized node data. The stable canvas-open callback keeps layout nodes unchanged while typing and delivers current composer props immediately. The input remains a normal browser textarea, with no forced focus recovery.

Editing regions stop keydown propagation to the canvas without preventing browser defaults. The `nokey` class also protects content from Shift pointer selection capture. Keyup still bubbles to release a canvas modifier pressed before entering an editor. New browser regressions exercise punctuation with real key presses, rapid typing, Ctrl+A, Shift selection and punctuation, undo/redo, Tab navigation, simulated IME candidate confirmation, exact compiled/sent text and clearing after success. Existing zoom, five-minute simulated time, delayed generation and background-notification focus coverage remains in place.

Windows native IME candidate UI and iOS physical keyboard behavior cannot be verified in Linux; simulated composition events are not that validation. No schema migration is required. Local update instructions are in docs/editor-input.md; no Release tag is published by preparing the ZIP.

Checks: typecheck, lint and production build pass; 82 unit/integration tests pass with the Windows-only bridge test skipped on Linux; all 22 Chromium browser tests pass, including exact keyboard-generated text in the real compiled package and persisted human turn. The source launcher serves the 0.3.1 API and freshly built browser assets.

The 0.3.1 portable code also passes all four actual Linux process scenarios: install with data/login/provenance retention, failed-start rollback, interrupted-update journal recovery, and abrupt exit with stale-lock recovery. Native Windows execution remains unverified.

## 0.4.0: direct canvas actions and recoverable card deletion

Inspection found no deletion entry for conversation/excerpt cards. Added node and pane context menus, a touch-accessible overflow button, rename/copy/context controls, excerpt branching/source navigation, and single-card Delete/Backspace/F2 shortcuts outside editing regions. Direct send compiles the exact validated package before generation; blocked input opens the inspector and keeps the draft. The existing preview workflow remains available. Menus support keyboard navigation and stay within the viewport. Newly created/restored composers focus once the node is measured and visible; typing never triggers focus recovery.

Card deletion uses the existing hidden visibility state, not SQL cascades. It preserves immutable blocks, turns, excerpts, edges and input snapshots, persists across restart and native export/import, removes cards/links from the board and conversation list, and provides undo and searchable read-only trash. Unsent drafts require confirmation and are recoverable only from the most recent in-memory undo. Restoring keeps identity and existing pin/exclusion settings, finding free space if needed. Hidden sources, aliases and transitively derived answers are excluded from future context compilation and historical retries; viewing an archived source does not restore it. Individual message deletion and permanent erasure remain outside this card-focused change.

No SQLite table migration is needed. Viewport validation expands from 0.1–4 to 0.01–4, matching the lower canvas zoom limit so widely separated cards can be surveyed and then reached from the conversation list. Older versions require zoom at least 0.1 and do not hide recycled nodes; managed rollback restores the pre-upgrade snapshot. See docs/canvas-actions.md.

Checks: typecheck, lint and production build pass; 87 unit/integration tests pass with one Windows-only bridge test skipped on Linux; all 27 Chromium tests pass, including actual clipboard access, keyboard menu navigation, one-click send, draft safeguards, source viewing, touch menus, 100+ visible nodes with drag/reload, and the existing input-focus regressions. The source launcher serves 0.4.0 and its current built assets. No paid model request or GitHub Release is made by these checks.

All four real portable process scenarios pass on the 0.4.0 code on Linux: upgrade retaining data/login/provenance, failed-start rollback, interrupted-update recovery, and abrupt exit with stale-lock recovery. Physical Windows/iOS validation remains outstanding.

## 0.5.0: connected conversation blocks (2026-10-17)

Replaced avatar-led chat rows with aligned input/output blocks grouped by each human turn. A narrow seam and short connector keep a question close to its answer, while numbered exchanges have a larger gap. Original paragraphs stay in their output instead of becoming distant graph nodes. Excerpts use warm paper, a quote rail and a different corner shape, with compact source/branch actions. Branches carry a matching source tab; extraction links are warm dashed lines and continuation links are purple solid lines, each labelled. Closing the composer increases reading space.

Live output appears alongside the immutable submitted prompt. Long submissions reveal the output when generation starts, while subsequent drafts follow only near the bottom. A slow canonical refresh retains the visible exchange and editor until the saved replacement is ready. Retries update the original exchange. Returning to a source locates the highlighted range, including late paragraphs and phone canvas zoom, rather than relying on offsets from the old container structure. No SQLite/domain schema change, source rewriting or graph rearrangement is involved; exact blocks, ranges, hashes, history and input packages remain intact. See docs/conversation-blocks.md for local update steps and visual distinctions.

Checks: frozen install, migrations 001–002, typecheck, lint and production build pass; 87 unit/integration tests pass with one Windows-only bridge test skipped on Linux. Validated 30 distinct Chromium scenarios through the full regression and targeted rerun of all three block-reading tests: paired geometry, exact cross-paragraph provenance, long submitted input visibility, delayed save refresh with editor identity/reading position retained, phone source highlighting, existing punctuation/IME simulation, deletion, history and 100+ card navigation. All four real portable process scenarios pass on the 0.5.0 package on Linux. The source launcher serves 0.5.0 health and the final built assets. The Windows ZIP, SHA-256, update feed, reading guide and actual Demo browser screenshots are delivered outside the checkout in /workspace/deployment-context-canvas. No tag or GitHub Release is published; physical Windows/iOS and paid model execution remain unverified.

## Main development and GitHub update setup (2026-10-18)

Integrated the complete canvas development history into main by fast-forward, retaining the previous backup and feature branch. Main is now the default for subsequent coding and completed changes, recorded in AGENTS.md and README. Main pushes run CI; publishing remains a separate matching canvas-v tag action. docs/github-updates.md describes built-in workflow authentication, the private repository's client-side Contents-read token, versioned release assets, local notifications and publishing commands. No repository visibility change, release tag or Release publication is performed by this integration.

The hosted Windows CI exposed pre-existing bridge timeouts during console/Windows assembly initialization at 20 seconds; the Linux CI passed. Bridge requests now use explicit UTF-8 streams and newline-delimited JSON, without mutating global console encodings or waiting for redirected stdin EOF; native enumeration callbacks stay in C#. Built-in Utility cmdlets load from their trusted system module path, avoiding a scan of unrelated module paths. Cold initialization has a 60-second budget; the request itself retains a separate 20-second deadline. Embedded newlines remain JSON-escaped; the window selection and input safety checks are unchanged. The actual Windows bridge compilation/enumeration test remains required, with elapsed-time and fixed-stage diagnostics so CI annotations identify a timeout without exposing window titles or credentials. This bridge fix increments the application to 0.5.1; the release gate still requires all Windows tests and portable recovery checks before publishing.

The Windows forced-exit smoke also exposed a test assumption: a killed process may reset its HTTP stream instead of finishing an NDJSON error event. The test now attaches its body handler before the kill and accepts only that specific transport termination or a completed error event. It verifies the exact turn was streaming before the kill, the API stops, and restart recovers that same turn as failed with its original context ID. Successful completion and unrelated read errors still fail the check; upgrade, data-retention, rollback and journal-recovery assertions remain required.

## Anonymous public updates and compiled distribution (2026-10-21)

Version 0.5.2 separates the private development repository from `Yukayuyu/context-canvas-releases`, an artifact-only public release target defined in `release.config.json`. Installed clients query and download anonymously and ignore old GitHub token environment variables; asset URLs must belong to the exact configured repository, redirects remain HTTPS/host constrained, and archive/file integrity and rollback checks are retained. Source development and delivery continue on `main`.

The Windows packager now builds minified Node ESM server/launcher bundles and copies an explicit runtime allowlist, a standalone pinned dependency lockfile, public client assets, user documentation, an empty configuration template and the required PowerShell/C# desktop bridge. It does not enumerate tracked/untracked checkout files or distribute the development source tree, source maps, Git history, real configuration or credentials. Two one-line compatibility adapters keep previous bootstrap/server entry paths working. Compiled runtime files remain inspectable; compilation is not a secrecy guarantee. Legacy users manually import this first new package and restart their whole launcher to adopt the public update channel without losing data.

The release workflow uses a maintainer-only `RELEASE_PUBLISH_TOKEN` secret with Contents write access restricted to the public release repository. Preflight rejects missing credentials or a private/archived target. Public tags reference only the public repository's own README history; publishing explicitly selects the ZIP, checksum and update feed and does not expose private commit messages. CI runs actual portable lifecycle tests through both the compiled and legacy bootstrap entry points; package tests also initialize a disposable signed-out official Codex process without a model request and Windows CI enumerates through the compiled API and packaged desktop bridge.

Local validation: frozen root install, typecheck/build, lint and 92 unit/integration tests passed, with the native Windows-only unit test skipped on Linux. Real compiled-package install/upgrade, failed-server rollback, interrupted journal recovery and forced-exit recovery passed; legacy server entry and bootstrap compatibility also passed. No schema migration is required. GitHub creation of the public repository and Actions secret administration return HTTP 403 for this integration; the owner must create/initialize the public target and securely save the maintainer-only publishing secret in the private source repository before the first online release. Until then online public download validation is pending, not reported as working.
