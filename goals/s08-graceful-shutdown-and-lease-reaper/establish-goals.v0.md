# Establish Goals
- Task name: s08-graceful-shutdown-and-lease-reaper
- Iteration: v0
- State: locked

## Status
Goals locked for Wave 2 (`Nov 15–17`, Parallel Group W2-B parallel with `S07`, depends on `S04` and `S06`; Track 4: Graceful Shutdown & Durable Lease Reaper).

## Request
Implement `SIGTERM`/`SIGINT` graceful drain in `packages/backend/src/index.ts` calling `shopifyWebhookService.drain()`, add a partial index `(organization_id, lease_expires_at) WHERE state = 'running'` on `orgs.class_checkout_executions` across both `database/migrations/` and `database/postgres17-schema.sql`, compile reaper entrypoints in `docker/backend.Dockerfile`, and run a periodic `FOR UPDATE SKIP LOCKED` lease recovery loop for stale 15-minute webhook deliveries, expired `#354` checkout execution leases, and expired OAuth/session cleanup.

## Blocking ambiguity
None.

## Assumptions
- Baseline `v0.3.0` (`S04`, including PR `#354` `orgs.class_checkout_executions` tables and Track 1 Postgres 17 CI gate) and Wave 2 foundation `S06` (`orgs.schema_migrations` runner and `pg_dump --schema-only` parity gate against `database/postgres17-schema.sql`) are merged to `main`.
- `S08` adds `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` and updates `database/postgres17-schema.sql` in lockstep so `S06`'s `pg_dump --schema-only` CI parity check passes, while avoiding `scripts/migrate.ts`, `postgres-schema.ts`, and `deploy.yml`.
- PostgreSQL 17 `FOR UPDATE SKIP LOCKED` provides multi-instance safe coordination without external queue infrastructure.

## Goals
1. Register `SIGTERM` and `SIGINT` graceful shutdown handlers in `packages/backend/src/index.ts` that stop accepting new HTTP requests, cancel the periodic background reaper loop, and await `shopifyWebhookService.drain()` before exiting cleanly.
2. Add a tracked SQL migration creating partial index `(organization_id, lease_expires_at) WHERE state = 'running'` on `orgs.class_checkout_executions` and update `database/postgres17-schema.sql` in lockstep so active checkout execution lease scans remain index-only under load while satisfying `S06`'s `pg_dump --schema-only` parity gate.
3. Compile all CLI and background reaper entrypoints (`reap:class-checkout` and reconciliation/reaper scripts) into `packages/backend/dist/` inside `docker/backend.Dockerfile` so production runtime containers can execute them without TypeScript sources.
4. Implement an in-process periodic `FOR UPDATE SKIP LOCKED` lease recovery and hygiene worker reclaiming stale 15-minute `orgs.shopify_webhook_deliveries` leases, expired `#354` `orgs.class_checkout_executions` leases, and expired `orgs.shopify_customer_oauth_states` and `orgs.shopify_customer_sessions` rows.
5. Enforce modular size ceilings (`<=500` lines/file, `<=250` lines/class, `<=60` lines/function) and full toolchain, lint, typecheck, SQL, and test gate compliance across all modified and newly created files.

## Non-goals
- Modifying `orgs.schema_migrations` runner internals (`scripts/migrate.ts`), boot-time DDL in `packages/backend/src/repo/postgres-schema.ts`, or `.github/workflows/deploy.yml` introduced in `S06`.
- Refactoring bounded-context domain directories (`packages/backend/src/domains/**`) scheduled for Wave 3 (`S09`–`S11`).
- Introducing external message brokers (Redis, RabbitMQ, or BullMQ) outside PostgreSQL 17 `FOR UPDATE SKIP LOCKED`.

## Success criteria
- [G1] Sending `SIGTERM` or `SIGINT` to the backend entrypoint stops HTTP listener intake, halts reaper scheduling, awaits in-flight `shopifyWebhookService.drain()` work within a bounded timeout, and exits `0` in deterministic unit/integration tests.
- [G2] Tracked migration `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` and `database/postgres17-schema.sql` both define partial index `(organization_id, lease_expires_at) WHERE state = 'running'` on `orgs.class_checkout_executions`, passing `bun run check:sql`, `S06`'s `pg_dump --schema-only` schema parity gate, and Postgres 17 integration tests.
- [G3] `docker/backend.Dockerfile` builds and copies compiled reaper entrypoints under `packages/backend/dist/`, and `packages/backend/package.json` exposes `reap:class-checkout` runnable in production containers.
- [G4] Concurrent Postgres 17 integration tests confirm two worker instances running `FOR UPDATE SKIP LOCKED` reclaim stale 15-minute webhook deliveries, transition expired `running` class checkout executions, and purge expired OAuth states/customer sessions without double-processing or lock contention.
- [G5] All modified and created files stay within `<=500` lines/file, `<=250` lines/class, and `<=60` lines/function, passing full toolchain, lint, typecheck, SQL, and test gates.

## Next action
Execute `tasks/s08-graceful-shutdown-and-lease-reaper/spec.md` in an isolated worktree branched from `main` after `S04` and `S06` merge.
