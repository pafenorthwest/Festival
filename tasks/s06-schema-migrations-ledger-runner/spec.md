# S06 — Track 2: `orgs.schema_migrations` Ledger, `scripts/migrate.ts` Runner, CI Parity Gate, and Boot-DDL Removal

## Goal reference
- Goal contract: `goals/s06-schema-migrations-ledger-runner/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 2, Group W2-A parallel with `S08`, depends on `S04`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (foundational `orgs.*` PostgreSQL 17 schema lifecycle across all 7 bounded contexts)

## Scope

### In scope
- `database/postgres17-schema.sql`
- `database/migrations/` (baseline reconciliation / metadata alignment for tracked DDL migrations vs data seeds)
- `scripts/migrate.ts` (and schema-parity check helper script under `scripts/` if separated to stay `<=500`L)
- `package.json` (`"migrate"` and `"check:schema-parity"` script entries only)
- `packages/backend/src/repo/postgres-schema.ts` (and readiness route handler calling `initializePostgresSchema` / `/api/internal/ready`)
- `packages/backend/tests/` (migration runner and schema readiness Postgres 17 integration tests, plus test schema bootstrap alignment)
- `.github/workflows/pr-checks.yml`
- `.github/workflows/deploy.yml`
- `cloud-setup/05-rebuild-and-validate.sh`
- `tasks/s06-schema-migrations-ledger-runner/spec.md` and `tasks/s06-schema-migrations-ledger-runner/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S06` upon merge)

### Out of scope
- `packages/backend/src/index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile` (locked in parallel to `s08`)
- `packages/backend/src/customer/customer-account-service.ts`, `packages/backend/src/checkout/class-checkout-service.ts`, `packages/backend/src/shopify/public-membership-product-service.ts`, and PR `#358` files (locked to `s07-pr358-cache-invalidation-and-read-models`)
- Live host provisioning on `v0.3.0` (`s05-live-prod-firebase-shopify-launch`)

## Approach
1. **Ledger Schema & `scripts/migrate.ts` Runner (Red-Green)**:
   - Add `orgs.schema_migrations (version TEXT PRIMARY KEY, filename TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` to `database/postgres17-schema.sql`.
   - Write Postgres 17 integration tests covering fresh migration runs, idempotent re-runs, checksum mismatch rejection, advisory-lock concurrency serialization, and explicit handling of psql `\copy` bootstrap seeds (`20261109000000_load_pafe_concertos.sql`).
   - Implement `scripts/migrate.ts` (`<=500`L, functions `<=60`L) satisfying all tests.
2. **CI `pg_dump --schema-only` Drift Gate**:
   - Create a deterministic parity check comparing normalized `pg_dump --schema-only --schema=orgs` output between a database initialized from `database/postgres17-schema.sql` and a database migrated via `scripts/migrate.ts`, and wire it as a blocking step in `.github/workflows/pr-checks.yml`.
3. **Pre-Deploy Migration Hooks**:
   - Update `.github/workflows/deploy.yml` and `cloud-setup/05-rebuild-and-validate.sh` to execute `scripts/migrate.ts` before starting new backend containers.
4. **Strip Boot-Time DDL (`initializePostgresSchema` & `/api/internal/ready`)**:
   - Remove all 20+ runtime `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` statements in `packages/backend/src/repo/postgres-schema.ts` (`initializePostgresSchema`, lines 1050–1188) and `/api/internal/ready`, replacing them with a fast read-only schema/ledger assertion.
   - Update Postgres integration test setup helpers so every `*.integration.test.ts` suite provisions its isolated schema cleanly via the canonical schema/migration helper.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s06-schema-migrations-ledger-runner
$env:POSTGRES_INTEGRATION_URL = "postgres://postgres:postgres@127.0.0.1:5432/festival_test"
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- `database/postgres17-schema.sql`: added `orgs.schema_migrations` ledger table (`version TEXT PRIMARY KEY, filename TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).
- `database/bootstrap/20261109000000_load_pafe_concertos.sql`: moved from `database/migrations/20261109000000_load_pafe_concertos.sql` to separate `psql \copy` seed data from DDL migrations; updated `database/migrations/README.md`.
- `scripts/migrate.ts`: implemented tracked migration runner (deterministic `YYYYMMDDHHMMSS_*.sql` ordering, CRLF-to-LF SHA-256 checksums, `psql` meta-command rejection, `pg_advisory_lock(hashtextextended($1, 0))` serialization, atomic per-migration transactions).
- `scripts/check-schema-parity.ts`: implemented normalized `pg_dump --schema-only --schema=orgs` drift check.
- `package.json`: added `migrate` and `check:schema-parity` scripts.
- `packages/backend/src/repo/postgres-schema.ts`: stripped runtime DDL from `initializePostgresSchema` (read-only schema/ledger checks); added `provisionPostgresTestSchema` for isolated test schemas.
- `packages/backend/tests/migrate-runner.test.ts`, `packages/backend/tests/postgres-test-fixture.ts`, `packages/backend/tests/postgres-application-fixture.ts`, `packages/backend/tests/postgres-initializer-existing-schema.integration.test.ts`: added migration runner tests and aligned Postgres test fixtures.
- `.github/workflows/pr-checks.yml`: added blocking `Schema parity check` step against Postgres 17.
- `.github/workflows/deploy.yml` and `cloud-setup/05-rebuild-and-validate.sh`: wired `postgres --wait` and `bun run scripts/migrate.ts` under `set -euo pipefail` before starting/recreating backend containers.
- `tasks/s06-schema-migrations-ledger-runner/code-review.md` and `specs/pre-thanksgiving-program.md` (`S06` marked `DONE`).

## Quality gate results
- `bun run verify:toolchain`: host environment runs Bun `1.4.4` vs `verify:toolchain` pinned `1.4.2` (CI uses pinned toolchain).
- `bun run test` (host): unit/contract tests passed; 64 PostgreSQL integration tests skipped because `POSTGRES_INTEGRATION_URL` is unset on host (CI `.github/workflows/pr-checks.yml` runs full Postgres 17 integration suites and `Schema parity check`).
- Code review (`tasks/s06-schema-migrations-ledger-runner/code-review.md`): verdict `patch is correct` (confidence: high; 0 findings).
