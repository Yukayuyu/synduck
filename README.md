# AI Context Canvas

A local-first spatial conversation workspace. Canvas is the view; domain entities and provenance are the source of truth. The Context Compiler makes each model input inspectable.

## Development

Use Node **24.19.0** (`.nvmrc`) and pnpm **11.19.0** (`packageManager`).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm dev
```

The web app uses port 3000 and the API uses port 3001, both bound to loopback. `pnpm build` builds the client; `pnpm start` serves the built app and API together on the API port. Run commands from the repository root. Keys belong only in the server environment, never in `VITE_*` variables.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

The original specification is in `docs/source-spec.md`. Focused specifications are in `docs/`; the unchanged proposed backlog is in `issues.json`. Implementation progress and deliberate scope limits are tracked separately in `docs/progress.md`.

This repository starts from the cleared `main`. The previous application remains on `backup/main-before-clear-20261004`.

## Connected conversation blocks (0.5.0)

Each question and its answer share a close, aligned pair of **輸入 / 輸出** blocks. Numbered exchanges have a wider gap between them; paragraphs stay together inside their original output. Excerpts use warm paper, a quote rail and a dashed source link, while branches have a matching source tab and a solid continuation link. Closing the composer gives the text more reading space. Exact selections, source highlighting and historical context inspection remain available. See [reading and extracting from blocks](docs/conversation-blocks.md) for the layout and local update steps.

## MCP and visual desktop tasks (0.3.0)

Open **本地任務 → 整合設定** to connect a local stdio or remote Streamable HTTP MCP service, or choose a Windows application window. Every tool call, screenshot and desktop input is approved individually. Canvas task cards show screenshots, operation paths and confirmation status; the review dialog compares before/after frames, annotates click locations and exports records with image hashes. Read [MCP, desktop control and provenance](docs/mcp-desktop-traces.md) for setup and validation limits. Desktop control targets the backend Windows computer; physical Windows and live ChatGPT image-tool execution remain unverified.

## Local tasks and updates (since 0.2.0)

Open **本地任務** to select a backend project directory. Manual file/command tests work without AI; Codex tasks use the selected model and reasoning level, with explicit approval for each command or write. Tool outcomes and task history stay in `data/local-runtime/`; they do not mutate sealed canvas inputs. Open **版本與更新** for automatic release checks, optional browser notifications, verified downloads and ZIP import. The Windows launcher installs into separate version folders and keeps the previous version and data for recovery. See [local runtime and updates](docs/local-runtime-updates.md) for first-time Windows migration, capability limits and release instructions. `pnpm start:local` runs the source launcher; `pnpm package:windows` creates a portable source-and-built-client package.

## First working slice

1. Double-click empty canvas space to create a conversation there, or use **提問** in the floating toolbar. Enter your question directly in the card.
2. Click **预览上下文**. The inspector shows included / excluded sources, explanations, conflicts and a conservative budget estimate.
3. Click **发送此上下文** to send that exact immutable package. The answer streams into its card on the canvas; other conversations remain readable alongside it.
4. Select text in any saved message on any card, then choose **摘录** or **延伸提問** from the nearby floating toolbar. A linked excerpt and branch appear beside the source.
5. An excerpt preserves its source block, half-open UTF-16 range, exact text and SHA-256 source hash. **回到来源并高亮** navigates back to that range.
6. Use the card's **+**, pin and exclude controls to choose the next input. A branch starts with its excerpt, not the whole parent conversation. Exclusion also follows previous answers that depended on an excluded source.
7. Drag card headers to move cards; drag message text to select it. Use the hand tool to pan, or pinch / scroll to navigate. Positions and viewport persist in SQLite. Click a card title or **繼續提問** to open its composer. Earlier assistant turns retain their own input packages. Conversation navigation and context inspection are collapsible floating panels, opened from the bottom toolbar.
8. Open **备份与恢复** in the top bar to download a native project file, validate an imported backup, or preview an automatic recovery point.

The default is explicitly labelled **local demo**. It generates deterministic demonstration text, makes no model request, and is suitable for exercising the UI. It is not an AI answer or an answer-quality evaluation.

## ChatGPT account, Windows and iOS

Open **模型與登入** in the header to sign in with your ChatGPT account through the bundled official Codex App Server (device authorization), select **ChatGPT / Codex**, choose a **Codex 模型** from the official catalog and click **使用此模式**. **思考深度** offers the model's advertised reasoning levels and **模型預設**; changing the model resets depth to its default until you choose again. Use **刷新模型列表** to reload the catalog. No API key is required for that provider. The mode, selected Codex model and reasoning depth persist across restarts. Previously configured models or depths absent from the catalog require a new explicit choice. Official Codex credentials stay in the application-owned `data/codex/`, separate from your other Codex installations. Real account authorization and model generation remain unverified in this cloud environment.

See [Windows, iOS and ChatGPT setup](docs/windows-ios.md) for PowerShell commands, HTTPS access, workspace authentication, phone navigation and the exact validation limits. iOS uses Safari and an optional home-screen shortcut; it requires a running backend. This is not an offline or native iOS application.

## Real model configuration

For direct OpenAI API access, configure the server's `.env` or secure environment settings:

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=<a Responses API model with structured outputs available to your account>
LLM_API_KEY=<enter securely; never commit>
```

Restart the API after configuration and select **OpenAI API** in the model dialog if a previous mode was saved. `OPENAI_API_KEY` is accepted as a local fallback, but use `LLM_API_KEY` for cloud proxy bindings. The only model destination is `api.openai.com`. On a proxy-managed cloud machine, start with `NODE_USE_ENV_PROXY=1 pnpm dev` so Node's fetch uses the provided HTTPS proxy. Keep TLS verification enabled.

The adapter calls the Responses API with `store: false`, a strict JSON schema and server-side validation. Streamed drafts are temporary; only a complete schema-valid answer with valid source IDs is persisted. Provider errors leave a retryable assistant turn and preserve its original input. If exclusion rules have changed, re-preview instead of retrying an obsolete package. Live OpenAI access has **not** been verified; current automated coverage uses an injected SSE transport, not an external account.

## Storage and tests

- `data/context-canvas.sqlite` and its WAL hold the local workspace; `data/assets/` is reserved for later asset support. Do not commit `data/`. Back up the SQLite database only after closing the app, or use SQLite's backup facilities.
- `DATABASE_PATH`, `ASSET_PATH`, `APP_PORT`, `API_PORT` are configurable. `.env` is loaded by the API, migrations and Vite configuration; shell variables take precedence.
- Browser tests use a fresh temporary database, explicit demo mode and a separate port. They never write to the development workspace or invoke paid model APIs.
- Chromium is picked from `/usr/bin/chromium` when present. Otherwise run `pnpm exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- The service is intended for a single owner. Loopback is the default; optional HTTPS reverse-proxy access requires PUBLIC_ORIGIN and APP_PASSWORD. It is not a multi-user service.

Recoverable card deletion, undo and trash are available through the [canvas action menu](docs/canvas-actions.md). Permanent deletion of individual messages, generated summaries, lexical retrieval, the JSON Canvas adapter and other full-backlog features remain outside this slice. See `docs/progress.md` for exact scope and remaining work.

## Native project backups

The top-bar **备份与恢复** dialog exports a versioned `.json` project containing the complete text workspace: conversations, turns, blocks, excerpts, nodes, edges, positions, selection settings, context sets and immutable context packages. It preserves canonical IDs and source provenance. Provider keys, server configuration and unrelated local files are never exported.

Import has two steps: **validate / preview**, then explicitly check **我确认用此备份替换当前工作区** and confirm. Validation checks the format, checksum, IDs, referential integrity, turn ordering, source hashes, exact excerpt ranges and recorded model-input references. A fingerprint detects intervening edits, including geometry changes, so stale previews cannot silently overwrite new work.

Replacement is transactional and automatically stores the previous workspace in `recovery_snapshots` in the same SQLite database. **导入前的恢复点 → 预览恢复** follows the same confirmation process. These recovery points protect against a mistaken import, not loss of the database file; download a separate backup for that. The UI lists the latest 20 recovery points; older records remain in the database and are not automatically deleted.

- Import replaces the current single workspace; it does not merge graphs. IDs stay the same, while the live workspace revision advances to invalidate old send previews.
- The current native format is version 1 with a 12 MiB limit. It supports the application's text-based data. Asset-bearing / unknown future fields are rejected explicitly, not silently discarded.
- Backups include original conversation text and model-input snapshots. Keep the downloaded file private as appropriate.
- The SHA-256 checksum detects corruption; it is not an authenticity signature. Browser content remains escaped text.
- Export/import waits until active generation finishes. Native project files and Obsidian `.canvas` files are different formats; a JSON Canvas adapter remains on the backlog.
