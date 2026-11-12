# Goals Extract
- Task name: s06-schema-migrations-ledger-runner
- Iteration: v0
- State: locked

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
