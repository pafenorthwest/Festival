# Festival Project Structure

## Metadata

- Name: Festival multi-tenant starter
- Type: Bun workspace monorepo
- Language/runtime: TypeScript, Bun, SolidJS, Hono
- Package manager: Bun
- Workspaces: `packages/common`, `packages/backend`, `packages/frontend`
- Primary integrations: Firebase Authentication, PostgreSQL
- Canonical verification commands:
  - Lint: `bun run format:check`
  - Build: `bun run build`
  - Test: `bun run test`

## Objectives

- Share organization, membership, invite, and auth contracts in `@festival/common`.
- Run a Hono backend that verifies Firebase identities and persists organization data in PostgreSQL.
- Run a SolidJS frontend for no-org onboarding, invite acceptance, and organization landing flows.
- Keep root verification commands stable and runnable in local development and pull-request automation.

## Layout

```text
/
├── README.md
├── package.json
├── biome.json
├── scripts/
│   ├── run-dev.sh
│   └── run-prod.sh
├── specs/
│   ├── Multi-Tenant-Starter.md
│   └── Style.md
├── reference/
│   ├── solidjs/
│   └── shopify/
└── packages/
    ├── common/
    │   ├── src/
    │   └── tests/
    ├── backend/
    │   ├── src/
    │   └── tests/
    └── frontend/
        ├── src/
        └── tests/
```

## Actions

- Place shared organization/auth domain logic in `packages/common/src`.
- Place backend HTTP routes, auth verification, and repository implementations in `packages/backend/src`.
- Place frontend routing, Firebase auth helpers, and organization UI flows in `packages/frontend/src`.
- Keep root development commands and `README.md` aligned so backend dev flows default to the repo-root `.env` unless explicitly overridden.
- Keep tests close to each workspace under `tests/`.
- Document repo-level command or architecture changes in `README.md`, task specs, and this file together.

## Verification

- Lint: `bun run format:check`
- Build: `bun run build`
- Test: `bun run test`

## Constraints

- Use workspace links (`workspace:*`) for internal dependencies.
- Keep TypeScript strict mode enabled.
- Treat the repo-root `.env` as the default env-file source for root backend development commands unless an explicit override is supplied.
- Do not assume a default PostgreSQL `public` schema exists; operators must provide `DB_SCHEMA`.
- Keep secrets in environment variables only.
- Keep PR automation limited to commands that run without live DB or Firebase dependencies.

## Success Criteria

- Root `bun run format:check`, `bun run build`, and `bun run test` pass.
- Frontend, backend, and common packages remain aligned on the org-onboarding contract.
- Repo metadata accurately reflects the current multi-tenant starter instead of the retired Shopify/Stripe app description.
- Canonical verification commands stay synchronized across `package.json`, task specs, and pull-request automation.

## Non-Goals

- Production deployment infrastructure.
- Broader enterprise tenant administration beyond the implemented starter flows.
- Using the legacy Shopify reference material as the active product architecture.
