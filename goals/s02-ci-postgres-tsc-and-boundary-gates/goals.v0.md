# Goals Extract
- Task name: s02-ci-postgres-tsc-and-boundary-gates
- Iteration: v0
- State: locked

## Goals
1. Provision a live `postgres:17-alpine` service container and wire `POSTGRES_INTEGRATION_URL` in `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml` so all 12 `*.integration.test.ts` suites execute deterministically in CI instead of skipping.
2. Enforce strict frontend and backend test TypeScript compilation by adding blocking `bun run --cwd packages/frontend check:types` (`tsc --noEmit`) to CI workflows and including `tests/**/*.ts` in `packages/backend/tsconfig.json` with zero compiler errors.
3. Promote `bun run check:sql` (`scripts/check-sql.ts`) to a blocking gate in `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml`, and extend AST inspection in `scripts/check-sql.ts` to validate `tx.unsafe(...)` calls alongside `sql.unsafe(...)`.
4. Add `packages/backend/tests/architecture-boundaries.test.ts` to mechanically enforce acyclic bounded-context imports across `packages/backend/src/domains/*` (`tenant-org` <- `catalog-repertoire` / `customer-identity` <- `teacher-directory` / `class-checkout` <- `commerce-projection`) and `<=500`-line file limits on domain modules.

## Non-goals
- Refactoring existing monolithic repositories or services into `packages/backend/src/domains/*` (deferred to Wave 3 packets `S09`–`S11`).
- Adding `orgs.schema_migrations` or removing boot-time DDL from `initializePostgresSchema` (owned by `s06-schema-migrations-ledger-runner`).
- Modifying `#361` Public Teacher Directory routes or frontend components (owned in parallel by `s03-issue-361-public-teacher-directory`).

## Success criteria
- [G1] `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml` start `postgres:17-alpine` with health checks, export `POSTGRES_INTEGRATION_URL`, and execute all 12 `*.integration.test.ts` suites with `0` skipped integration suites and `0` failures.
- [G2] `bun run --cwd packages/frontend check:types` and `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit` (with `tests/**/*.ts` included) pass with `0` errors locally and as blocking steps in CI.
- [G3] `scripts/check-sql.ts` flags unparameterized or disallowed `tx.unsafe(...)` and `sql.unsafe(...)` usages (covered by unit tests) and runs as a blocking step in `pr-checks.yml` and `deploy.yml`.
- [G4] `packages/backend/tests/architecture-boundaries.test.ts` runs under `bun run test`, enforces the 7-context acyclic dependency graph and `<=500`-line ceiling on `packages/backend/src/domains/**`, and passes cleanly.
