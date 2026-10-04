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

## First working slice

1. Create a conversation and enter a question.
2. Click **预览上下文**. The inspector shows included / excluded sources, explanations, conflicts and a conservative budget estimate.
3. Click **发送此上下文** to send that exact immutable package.
4. Select text in any saved message, then choose **摘录** or **摘录并分支**.
5. An excerpt preserves its source block, half-open UTF-16 range, exact text and SHA-256 source hash. **回到来源并高亮** navigates back to that range.
6. Use the card's **+**, pin and exclude controls to choose the next input. A branch starts with its excerpt, not the whole parent conversation. Exclusion also follows previous answers that depended on an excluded source.
7. Drag cards and pan / zoom; positions and viewport persist in SQLite. Double-click a card for the reading layer. Earlier assistant turns retain their own input packages.

The default is explicitly labelled **local demo**. It generates deterministic demonstration text, makes no model request, and is suitable for exercising the UI. It is not an AI answer or an answer-quality evaluation.

## Real model configuration

Configure the server's `.env` or secure environment settings:

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=<a Responses API model with structured outputs available to your account>
LLM_API_KEY=<enter securely; never commit>
```

Restart the API after configuration. `OPENAI_API_KEY` is accepted as a local fallback, but use `LLM_API_KEY` for cloud proxy bindings. The only model destination is `api.openai.com`. On a proxy-managed cloud machine, start with `NODE_USE_ENV_PROXY=1 pnpm dev` so Node's fetch uses the provided HTTPS proxy. Keep TLS verification enabled.

The adapter calls the Responses API with `store: false`, a strict JSON schema and server-side validation. Streamed drafts are temporary; only a complete schema-valid answer with valid source IDs is persisted. Provider errors leave a retryable assistant turn and preserve its original input. If exclusion rules have changed, re-preview instead of retrying an obsolete package. Live OpenAI access has **not** been verified; current automated coverage uses an injected SSE transport, not an external account.

## Storage and tests

- `data/context-canvas.sqlite` and its WAL hold the local workspace; `data/assets/` is reserved for later asset support. Do not commit `data/`. Back up the SQLite database only after closing the app, or use SQLite's backup facilities.
- `DATABASE_PATH`, `ASSET_PATH`, `APP_PORT`, `API_PORT` are configurable. `.env` is loaded by the API, migrations and Vite configuration; shell variables take precedence.
- Browser tests use a fresh temporary database, explicit demo mode and a separate port. They never write to the development workspace or invoke paid model APIs.
- Chromium is picked from `/usr/bin/chromium` when present. Otherwise run `pnpm exec playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- The service is intended for a single user on loopback. It has no public hosting / multi-user authentication layer.

Package import/export, graph deletion/undo, generated summaries, lexical retrieval and the other full-backlog features are not part of this slice. See `docs/progress.md` for exact scope and remaining work.
