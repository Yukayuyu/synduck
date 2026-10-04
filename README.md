# AI Context Canvas

A local-first spatial conversation workspace. Canvas is the view; domain entities and provenance are the source of truth. The Context Compiler makes each model input inspectable.

## Development

Use Node **24.19.0** (`.nvmrc`) and pnpm **11.19.0** (`packageManager`).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

The web app uses port 3000 and the API uses port 3001, both bound to loopback. `pnpm build` builds the client; `pnpm start` runs the API. Keys belong only in the server environment, never in `VITE_*` variables.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The original specification is in `docs/source-spec.md`. Focused specifications are in `docs/`; the unchanged proposed backlog is in `issues.json`. Implementation progress and deliberate scope limits are tracked separately in `docs/progress.md`.

This repository starts from the cleared `main`. The previous application remains on `backup/main-before-clear-20261004`.
