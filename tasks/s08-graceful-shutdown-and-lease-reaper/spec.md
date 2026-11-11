# S08 — Graceful Shutdown & Durable Lease Reaper (Track 4)

## Goal reference
- Locked goals: `goals/s08-graceful-shutdown-and-lease-reaper/goals.v0.md`
- Goal establishment record: `goals/s08-graceful-shutdown-and-lease-reaper/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 2, Group W2-B parallel with `S07`, depends on `S04`, `S06`)
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/backend/src/index.ts` — wire `SIGTERM`/`SIGINT` handlers, `server.stop()`, periodic lease reaper startup/stop, and `await drain()` lifecycle hook.
- `packages/backend/src/app.ts` — expose a minimal runtime `drain()` / background worker handle from `createApp()` (keep diff surgical; full DI split belongs to `S14`).
- `packages/backend/src/commerce/shopify-webhook-service.ts` and `packages/backend/src/commerce/webhook-worker-queue.ts` — expose `drain()` awaiting active webhook jobs and `FOR UPDATE SKIP LOCKED` stale 15-minute webhook delivery lease recovery.
- `packages/backend/src/checkout/reap-class-checkout-recovery.ts` and `packages/backend/src/runtime/periodic-lease-reaper.ts` — periodic in-process and standalone CLI `FOR UPDATE SKIP LOCKED` reaper for expired `#354` `orgs.class_checkout_executions` (`state = 'running'`), stale `orgs.shopify_webhook_deliveries`, and expired `orgs.shopify_customer_oauth_states` / `orgs.shopify_customer_sessions`.
- `packages/backend/scripts/reap-class-checkout-executions.ts` and `packages/backend/package.json` — compiled CLI entrypoint (`reap:class-checkout`) included in `packages/backend/tsconfig.json` build output.
- `docker/backend.Dockerfile` — ensure compiled `dist/` worker and reaper entrypoints ship cleanly in the `runtime` image stage.
- `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` and `database/postgres17-schema.sql` — additive partial index `idx_class_checkout_executions_running_lease` on `orgs.class_checkout_executions (organization_id, lease_expires_at) WHERE state = 'running'`, keeping `database/postgres17-schema.sql` in parity with `S06`'s `pg_dump --schema-only` CI gate.
- `packages/backend/tests/graceful-shutdown.test.ts` and `packages/backend/tests/lease-reaper.integration.test.ts` — deterministic shutdown and Postgres 17 `SKIP LOCKED` concurrency tests.

### Out of scope
- `scripts/migrate.ts`, `packages/backend/src/repo/postgres-schema.ts`, and `.github/workflows/deploy.yml` (owned by upstream Wave 2 packet `S06`).
- `packages/backend/src/customer/customer-account-service.ts`, `packages/backend/src/services/organization-service.ts`, and `packages/backend/src/shopify/public-membership-product-service.ts` (locked by parallel Wave 2 packet `S07`).
- `packages/backend/src/domains/**` bounded-context directory extractions (scheduled for Wave 3 packets `S09`–`S11`).
- `packages/common/**` and `packages/frontend/**` (locked for Wave 3 packets `S12` and `S13`).

## Approach
1. **Red-Green Shutdown & Reaper Tests First**: Author failing unit tests for `SIGTERM`/`SIGINT` drain coordination (verifying new requests stop while in-flight webhook promises resolve before process exit) and failing Postgres 17 integration tests seeding stale 15m webhook deliveries, expired `running` `orgs.class_checkout_executions` rows, and expired OAuth state/customer session rows across two concurrent reaper instances.
2. **Partial Index Migration & Schema Snapshot Parity**: Create `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` adding `CREATE INDEX IF NOT EXISTS idx_class_checkout_executions_running_lease ON orgs.class_checkout_executions (organization_id, lease_expires_at) WHERE state = 'running'` using schema-parameterized SQL compliant with `scripts/check-sql.ts`, and update `database/postgres17-schema.sql` in lockstep so `S06`'s `pg_dump --schema-only` CI parity gate passes cleanly.
3. **Durable `FOR UPDATE SKIP LOCKED` Reaper**: Implement `PeriodicLeaseReaper` (`<=250`L class, `<=60`L methods) executing bounded batches via `FOR UPDATE SKIP LOCKED` to (a) reset or re-enqueue `orgs.shopify_webhook_deliveries` stuck in processing >15 minutes, (b) invoke `#354` checkout execution lease recovery for expired `state = 'running'` rows, and (c) batch-delete expired `orgs.shopify_customer_oauth_states` and `orgs.shopify_customer_sessions`. Use `.unref()` on timers so tests never hang.
4. **Graceful Drain & Container Build**: Wire `shopifyWebhookService.drain()` and `periodicLeaseReaper.stop()` into `createApp()` return handles and `packages/backend/src/index.ts` signal handlers (`SIGTERM`, `SIGINT`) with a configurable drain timeout (default `15_000` ms). Update `packages/backend/package.json` and `docker/backend.Dockerfile` so `dist/` contains the compiled reaper CLI entrypoint (`bun ./packages/backend/dist/scripts/reap-class-checkout-executions.js`).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s08-graceful-shutdown-and-lease-reaper
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
Pending execution.

## Quality gate results
Pending execution.
