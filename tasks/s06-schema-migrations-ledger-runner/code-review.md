# Code Review
- Task name: s06-schema-migrations-ledger-runner

## Context
Independent code review of `s06-schema-migrations-ledger-runner` against `goals/s06-schema-migrations-ledger-runner/goals.v0.md` (`[G1]`–`[G4]`), `tasks/s06-schema-migrations-ledger-runner/spec.md`, and `specs/bounded-contexts-2026.md` (§4.8 Platform Infrastructure).

## Scope & Files Reviewed
- `database/postgres17-schema.sql` (`orgs.schema_migrations` table and primary key constraint)
- `database/migrations/20261109000000_load_pafe_concertos.sql` -> `database/bootstrap/20261109000000_load_pafe_concertos.sql` (separated `\copy` seed from DDL migrations)
- `database/migrations/README.md`
- `scripts/migrate.ts` (253 lines)
- `scripts/check-schema-parity.ts` (97 lines)
- `package.json` (`migrate` and `check:schema-parity` scripts)
- `packages/backend/src/repo/postgres-schema.ts` (`initializePostgresSchema` and `provisionPostgresTestSchema`)
- `packages/backend/src/routes/private-runtime.routes.ts` (`/ready` via `repository.ensureReady()`)
- `packages/backend/tests/migrate-runner.test.ts` (322 lines)
- `packages/backend/tests/postgres-test-fixture.ts`
- `packages/backend/tests/postgres-application-fixture.ts`
- `packages/backend/tests/postgres-initializer-existing-schema.integration.test.ts`
- `.github/workflows/pr-checks.yml`
- `.github/workflows/deploy.yml`
- `cloud-setup/05-rebuild-and-validate.sh`

## Audit Summary
1. **Goal & Spec Compliance (`[G1]`–`[G4]`, In-Scope / Out-of-Scope)**:
   - `[G1]` Met: `orgs.schema_migrations` is defined in `database/postgres17-schema.sql` and `buildCanonicalPostgresSchemaSql`. `scripts/migrate.ts` discovers `YYYYMMDDHHMMSS_*.sql` migrations in deterministic lexicographical order, normalizes CRLF to LF before SHA-256 checksum calculation, rejects `psql` meta-commands (`\copy`, `\set`, `\i`, `\ir`, `\echo`, `\connect`), and `20261109000000_load_pafe_concertos.sql` was moved to `database/bootstrap/`.
   - `[G2]` Met: `.github/workflows/deploy.yml` (under `set -euo pipefail`) and `cloud-setup/05-rebuild-and-validate.sh` (under `set -euo pipefail`) start `postgres --wait`, execute `bun run scripts/migrate.ts` before starting/recreating backend containers, and abort on non-zero exit.
   - `[G3]` Met: `.github/workflows/pr-checks.yml` runs a blocking `Schema parity check` step (`set -euo pipefail`) loading `database/postgres17-schema.sql`, running `bun run migrate`, dumping `--schema-only --schema=orgs --no-owner --no-privileges`, and running `bun run check:schema-parity`.
   - `[G4]` Met: `initializePostgresSchema` in `packages/backend/src/repo/postgres-schema.ts` contains zero `CREATE`, `ALTER`, or `DROP` DDL statements; it performs read-only checks against `information_schema.schemata`, `to_regclass`, and `schema_migrations`. `/api/internal/ready` delegates to `repository.ensureReady()` -> `initializePostgresSchema`, executing zero runtime DDL. Test fixtures (`postgres-test-fixture.ts`, `postgres-application-fixture.ts`) provision isolated test schemas via `provisionPostgresTestSchema`.
   - Out-of-scope boundaries respected: no edits to `index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile`, or `s07` files.

2. **Correctness, Security & Guardrails**:
   - Advisory lock lifecycle: `scripts/migrate.ts` reserves a dedicated connection (`db.reserve()`), acquires `pg_advisory_lock(hashtextextended($1, 0))`, and guarantees `pg_advisory_unlock` and `reserved.release()` in nested `finally` blocks, followed by `await db.close()`.
   - Transaction atomicity: each pending migration's SQL and its `INSERT INTO ... schema_migrations` ledger record execute together inside `reserved.begin(async (tx) => ...)`.
   - SQL injection safety: schema names are validated against `/^[A-Za-z_][A-Za-z0-9_]{0,62}$/`; ledger queries, advisory lock keys, and readiness probes use parameterized `$1`/`$2`/`$3` bindings.
   - Size & cleanliness guardrails: all new files are `<= 500` lines (`scripts/migrate.ts`: 253L, `scripts/check-schema-parity.ts`: 97L, `packages/backend/tests/migrate-runner.test.ts`: 322L); all new functions are `<= 36` lines and `<= 3` parameters; no secrets or debug logs present.

- Findings status: none

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: high
- Justification: All goals ([G1]-[G4]), bounded-context invariants (§4.8 zero runtime DDL), advisory-lock and transaction atomicity guarantees, CI/deploy abort-on-error hooks, and size/security guardrails are satisfied with zero out-of-scope modifications.
