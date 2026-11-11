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
- `packages/backend/tsconfig.build.json`
- `packages/backend/package.json` (`build` script target only: `tsc -p tsconfig.build.json`)
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
- **`[G1]` CI PostgreSQL 17 Service & Zero-Skip Integration Suites**:
  - Added a `postgres:17-alpine` service container (`pg_isready -U postgres -d festival_test` health check, port `5432`, `POSTGRES_DB=festival_test`) and wired `DATABASE_URL` plus `POSTGRES_INTEGRATION_URL` in `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml` with zero `continue-on-error: true` overrides, covered by workflow contract assertions in `packages/backend/tests/cd-workflow.test.ts`.
  - Updated PostgreSQL test fixtures (`packages/backend/tests/postgres-application-fixture.ts`, `packages/backend/tests/postgres-test-fixture.ts`, `packages/backend/tests/postgres-application-catalog.integration.test.ts`, `packages/backend/tests/postgres-initializer-existing-schema.integration.test.ts`, and `packages/backend/tests/postgres-profile-postal-code.integration.test.ts`) to self-bootstrap `DATABASE_URL` from `POSTGRES_INTEGRATION_URL` and initialize the `orgs` schema on fresh databases so all `14` `*.integration.test.ts` suites (plus `3` PostgreSQL-gated `*.test.ts` suites) execute actively with `0` skips.
- **`[G2]` Blocking Frontend & Backend+Test `tsc --noEmit` Gates**:
  - Included `"tests/**/*.ts"` in `packages/backend/tsconfig.json` and added `packages/backend/tsconfig.build.json` (`"build": "tsc -p tsconfig.build.json"` in `packages/backend/package.json`) so `packages/backend/dist/index.js` continues to emit cleanly without `dist/src/` or `dist/tests/` nesting.
  - Resolved all `208` strict TypeScript diagnostics across `50` backend test files without changing runtime behavior or assertions, and added blocking `bun run --cwd packages/frontend check:types` and `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit` steps to `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml`.
- **`[G3]` `scripts/check-sql.ts` `tx.unsafe` AST Validation & Blocking CI Gate**:
  - Extended `scripts/check-sql.ts` static AST and SQL lexer validation to cover `tx.unsafe(...)` alongside `sql.unsafe(...)`, `transaction`, `runner`, `database`, `client`, and property-chained receivers (including `${this.schema}` `ThisKeyword` support, unparameterized `$1` single-argument detection, `+` string concatenation bans, and single-quoted interpolation bans).
  - Added comprehensive unit tests in `packages/backend/tests/check-sql.test.ts` and promoted `bun run check:sql` to a blocking step in `.github/workflows/pr-checks.yml` and `.github/workflows/deploy.yml`.
- **`[G4]` Mechanical DDD Bounded-Context Gate (`architecture-boundaries.test.ts`)**:
  - Added `packages/backend/tests/architecture-boundaries.test.ts` enforcing the 7 bounded contexts (`tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, `commerce-projection`, `volunteers-comms`), the acyclic `ALLOWED_UPSTREAM_CONTEXTS` DAG, public `index` barrel imports, permitted backend layers, and the `<=500`-line file ceiling across domain directories per `specs/bounded-contexts-2026.md`.
- **Exceptions**: None.
- **Deferred work**: None.

## Quality gate results
- Packet validator (`validate-packet.ps1 -TaskName s02-ci-postgres-tsc-and-boundary-gates -RequireCodeReview`): `PASS` — `PACKET VALID: task=s02-ci-postgres-tsc-and-boundary-gates iteration=v0 state=locked goals=4 codeReview=valid(none)` (`exit=0`)
- `bun run verify:toolchain`: `PASS` — Bun `1.4.2` and TypeScript `5.9.3` (`exit=0`)
- `bun run format:check`: `PASS` — `523` files checked, `0` issues (`exit=0`)
- `bun run lint`: `PASS` — `523` files checked, `0` warnings, `0` errors (`exit=0`)
- `bun run build`: `PASS` — clean `packages/backend/dist/index.js` emission with no `dist/src/` or `dist/tests/` artifacts (`exit=0`)
- `bun run --cwd packages/frontend check:types`: `PASS` — `0` errors (`exit=0`)
- `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: `PASS` — `0` errors across `src/**/*.ts` and `tests/**/*.ts` (`exit=0`)
- `bun run test` (with `POSTGRES_INTEGRATION_URL`): `PASS` — `2,409 pass / 0 skip / 0 fail` across `204` test files, including all `14` `*.integration.test.ts` suites (`exit=0`)
- `bun run check:sql`: `PASS` — `279` backend TypeScript files validated, `0` errors (`exit=0`)
- Code review (`tasks/s02-ci-postgres-tsc-and-boundary-gates/code-review.md`): `PASS` — `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`high` confidence)
