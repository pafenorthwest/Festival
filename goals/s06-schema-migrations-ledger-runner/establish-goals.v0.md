# Establish Goals
- Task name: s06-schema-migrations-ledger-runner
- Iteration: v0
- State: locked

## Status
Locked contract ready for execution in Wave 2 Group W2-A (parallel with `S08`) immediately after `S04` (`v0.3.0`) completes.

## Request
Execute Refactor Track 2 by creating the `orgs.schema_migrations` ledger and deterministic `scripts/migrate.ts` runner, wiring pre-deploy migration hooks into `.github/workflows/deploy.yml` and `cloud-setup/05-rebuild-and-validate.sh`, enforcing a CI `pg_dump --schema-only` parity check against `database/postgres17-schema.sql`, and stripping all 20+ boot-time DDL statements from `initializePostgresSchema` (`packages/backend/src/repo/postgres-schema.ts`) and `/api/internal/ready`.

## Blocking ambiguity
None.

## Assumptions
- `S04` (`v0.3.0`, containing `#354` migrations `20261108000000_class_checkout_execution_recovery.sql` + `20261108010000_class_checkout_storefront_binding.sql` and `#360` seed `20261109000000_load_pafe_concertos.sql`) is on `main` before `S06` branches.
- `S06` runs in parallel with `S08` (`packages/backend/src/index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile`) across disjoint files; any new partial index for `S08` lands either as a tracked migration after `S06` or coordinated via `database/migrations/`.
- Postgres integration test harnesses initialize test schemas via `database/postgres17-schema.sql` / `scripts/migrate.ts` once boot-time DDL is removed from `initializePostgresSchema`.

## Goals
1. Define the `orgs.schema_migrations` ledger table in `database/postgres17-schema.sql` and implement a deterministic, advisory-locked migration runner in `scripts/migrate.ts` that tracks version, filename, SHA-256 checksum, and `applied_at` across `database/migrations/*.sql`.
2. Wire pre-deploy migration execution into `.github/workflows/deploy.yml` and `cloud-setup/05-rebuild-and-validate.sh` so schema migrations apply atomically before updated backend containers start serving requests.
3. Add a blocking CI schema-parity check in `.github/workflows/pr-checks.yml` verifying via `pg_dump --schema-only` that sequential `database/migrations/*.sql` execution matches canonical `database/postgres17-schema.sql` with zero drift.
4. Remove all 20+ imperative boot-time `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` DDL statements from `initializePostgresSchema` in `packages/backend/src/repo/postgres-schema.ts` and `/api/internal/ready`, replacing runtime DDL mutation with fast read-only schema/ledger readiness verification.

## Non-goals
- Splitting `PostgresOrganizationRepository` or `PostgresMembershipCommerceRepository` into bounded-context repositories (deferred to Wave 3 packets `S09`–`S11`).
- Modifying graceful `SIGTERM` drain or `reap-class-checkout-recovery.ts` worker loops (owned in parallel by `s08`).
- Merging PR `#358` or modifying application-level read caches (owned sequentially by `s07-pr358-cache-invalidation-and-read-models`).

## Success criteria
- [G1] `orgs.schema_migrations` is defined in `database/postgres17-schema.sql` and `scripts/migrate.ts` idempotently applies pending SQL migrations under a PostgreSQL advisory lock, rejects modified historical checksums, cleanly separates `\copy` bootstrap seeds (`20261109000000_load_pafe_concertos.sql`), and passes Postgres 17 integration tests.
- [G2] `.github/workflows/deploy.yml` and `cloud-setup/05-rebuild-and-validate.sh` invoke `scripts/migrate.ts` prior to backend container cutover and abort deployment cleanly on non-zero migration exit.
- [G3] `.github/workflows/pr-checks.yml` runs a blocking `pg_dump --schema-only` parity check confirming zero structural diff between `database/postgres17-schema.sql` and the migrated schema.
- [G4] `initializePostgresSchema` (`packages/backend/src/repo/postgres-schema.ts`) and `/api/internal/ready` execute zero `CREATE`/`ALTER`/`DROP` DDL statements during server startup or readiness probes, and all 12+ Postgres integration suites pass.

## Next action
Branch `refactor/s06-schema-migrations-ledger-runner` from `main` once `S04` completes and execute `tasks/s06-schema-migrations-ledger-runner/spec.md`.
