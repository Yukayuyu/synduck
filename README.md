# synduck

Monorepo for a collaborative online editor/playground (Next.js) + AWS IaC + CI/CD.

## Structure
- `apps/web` — Next.js (App Router, TypeScript)
- `infra` — Infrastructure as Code (TBD)

## Local dev
```bash
cd apps/web
npm install
npm run dev
```

## CI
GitHub Actions runs lint + build on PRs.
