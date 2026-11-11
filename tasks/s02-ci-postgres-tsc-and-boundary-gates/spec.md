# S02 — Track 1: CI Real Postgres 17 Service, Strict `tsc`, `check:sql` `tx.unsafe`, and Boundary Gates

## Goal reference
- Goal contract: `goals/s02-ci-postgres-tsc-and-boundary-gates/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 1, Group W1-B parallel with `S03`, depends on `S01`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (mechanical boundary enforcement across all 7 bounded contexts)

## Scope

### In scope
- `.github/workflows/pr-checks.yml`
- `.github/workflows/deploy.yml`
- `packages/backend/tsconfig.json`
- `packages/backend/tests/**/*.ts` (strict type-annotation fixes only if surfaced by adding `tests/**/*.ts` to `packages/backend/tsconfig.json`, plus new `packages/backend/tests/architecture-boundaries.test.ts` and `check-sql` unit tests)
- `scripts/check-sql.ts`
- `tasks/s02-ci-postgres-tsc-and-boundary-gates/spec.md` and `tasks/s02-ci-postgres-tsc-and-boundary-gates/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S02` upon merge)

### Out of scope
- `packages/backend/src/routes/participant-profile/participant-profile.routes.ts`, `packages/frontend/src/pages/PublicDirectoryPage.tsx`, and directory membership/admin UI files (locked in parallel to `s03-issue-361-public-teacher-directory`)
- `package.json` version bumps and `CHANGELOG.md` (locked to `s04-release-v0-3-0-cutover`)
- `database/postgres17-schema.sql`, `scripts/migrate.ts`, and `packages/backend/src/repo/postgres-schema.ts` (locked to `s06-schema-migrations-ledger-runner`)
- Production runtime domain code under `packages/backend/src/**` and `packages/frontend/src/**`

## Approach
1. **Extend `scripts/check-sql.ts` (Red-Green)**:
   - Write unit tests exercising `scripts/check-sql.ts` against `tx.unsafe(...)` and `sql.unsafe(...)` AST patterns.
   - Update `scripts/check-sql.ts` so `tx.unsafe(...)` calls undergo the exact static safety validation applied to `sql.unsafe(...)`, and verify `bun run check:sql` passes across the repository.
2. **Backend Test TypeScript Coverage**:
   - Add `"tests/**/*.ts"` to `include` in `packages/backend/tsconfig.json` (with `noEmit` verification if `build` emits `src` via a separate build config or `rootDir` adjustment so `dist/` output remains clean).
   - Resolve any type errors surfaced in `packages/backend/tests/**/*.ts` without altering runtime behavior.
3. **Mechanical DDD Boundary Gate (`architecture-boundaries.test.ts`)**:
   - Implement `packages/backend/tests/architecture-boundaries.test.ts` encoding the 7 bounded contexts from `specs/bounded-contexts-2026.md` (`tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, `commerce-projection`, `volunteers-comms`), allowed acyclic import edges, and the `<=500`-line ceiling for files inside `packages/backend/src/domains/**`, plus self-tests validating violation detection.
4. **CI Workflow Hardening (`pr-checks.yml` & `deploy.yml`)**:
   - Configure `services.postgres` (`postgres:17-alpine`, `pg_isready` health check, port `5432`) and pass `POSTGRES_INTEGRATION_URL` to `bun run test` so all 12 `*.integration.test.ts` suites run actively.
   - Add blocking steps for `bun run --cwd packages/frontend check:types`, backend test `tsc --noEmit`, and `bun run check:sql`.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s02-ci-postgres-tsc-and-boundary-gates
$env:POSTGRES_INTEGRATION_URL = "postgres://postgres:postgres@127.0.0.1:5432/festival_test"
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run test
bun run check:sql
```

## Delivery
Pending execution.

## Quality gate results
Pending execution.
