# Code Review
- Task name: s08-graceful-shutdown-and-lease-reaper

## Context
Independent Step 4 code review (and post-fix re-audit) of `s08-graceful-shutdown-and-lease-reaper` against `goals/s08-graceful-shutdown-and-lease-reaper/goals.v0.md` (`[G1]`–`[G5]`), `tasks/s08-graceful-shutdown-and-lease-reaper/spec.md`, and `specs/bounded-contexts-2026.md` (§2, §4.3, §4.5, §4.6, §4.8, §5, §6).

## Scope & Files Reviewed
- `packages/backend/src/index.ts` (200 lines)
- `packages/backend/src/app.ts` (targeted diff `+14 / -1` around `createApp`)
- `packages/backend/src/commerce/shopify-webhook-service.ts` (448 lines; `ShopifyWebhookService` 240 lines)
- `packages/backend/src/commerce/webhook-worker-queue.ts` (231 lines; `WebhookWorkerQueue` 204 lines)
- `packages/backend/src/checkout/reap-class-checkout-recovery.ts` (66 lines)
- `packages/backend/src/runtime/periodic-lease-reaper.ts` (233 lines; `PeriodicLeaseReaper` 133 lines)
- `packages/backend/scripts/reap-class-checkout-executions.ts` (58 lines)
- `packages/backend/package.json`
- `packages/backend/tsconfig.json`
- `docker/backend.Dockerfile`
- `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` (10 lines)
- `database/postgres17-schema.sql` (`idx_class_checkout_executions_running_lease` snapshot parity diff)
- `packages/backend/tests/graceful-shutdown.test.ts` (476 lines)
- `packages/backend/tests/lease-reaper.integration.test.ts` (497 lines)

## Audit Summary
1. **Goal & Spec Compliance (`[G1]`–`[G5]`, In-Scope / Out-of-Scope)**:
   - `[G1]` Met: `packages/backend/src/index.ts` registers idempotent `SIGTERM` and `SIGINT` handlers that stop HTTP server intake, stop `PeriodicLeaseReaper`, await `shopifyWebhookService.drain()` within a configurable `.unref()`-backed timeout (default `15_000` ms), close the PostgreSQL pool (`sql.close()`), and exit cleanly. Each teardown step (`stopServer`, `stopReaper`, `drain`, `closeDatabase`) is isolated in its own `try/catch` block (`F1` resolved), guaranteeing remaining cleanup steps and `exit` execute even on failure while suppressing late post-timeout rejections on `drain()`.
   - `[G2]` Met: `database/migrations/20261115010000_idx_class_checkout_executions_running.sql` and `database/postgres17-schema.sql` define partial index `idx_class_checkout_executions_running_lease` on `orgs.class_checkout_executions USING btree (organization_id, lease_expires_at) WHERE (state = 'running'::text)` in canonical `pg_dump --schema-only` alphabetical index order.
   - `[G3]` Met: `packages/backend/package.json` bundles `reap-class-checkout-executions.ts`, `reap-class-checkout-recovery.ts`, `reconcile-firebase-claims.ts`, and `reconcile-shopify-orders.ts` into `dist/scripts/*.js` and exposes `reap:class-checkout`; `docker/backend.Dockerfile` verifies and copies compiled artifacts into the `runtime` image stage.
   - `[G4]` Met: `PeriodicLeaseReaper` coordinates `FOR UPDATE SKIP LOCKED` recovery across stale 15-minute `orgs.shopify_webhook_deliveries` rows, expired `running` `orgs.class_checkout_executions` rows (acquiring non-blocking `pg_try_advisory_xact_lock(hashtextextended(organization_id || ':checkout:' || intent_id, 0))` matching `PostgresClassCheckoutExecutionRepository.lock` and preserving all `CHECK` constraints), and expired `orgs.shopify_customer_oauth_states` / `orgs.shopify_customer_sessions` rows. Consumerless runs such as the one-shot `reap:class-checkout` CLI leave stale `'processing'` webhook rows untouched for live workers (`F2` resolved), and live webhook reclamation is bounded by `WebhookWorkerQueue.getAvailableReclaimSlots` with `retainForRecovery: true` overflow protection (`F3` resolved).
   - `[G5]` Met: All modified and created files stay within `<= 500` lines/file (max `497` lines), `<= 250` lines/class (max `240` lines), and `<= 60` lines/function (`<= 3` parameters on all new functions). Out-of-scope boundaries (`S06`, `S07`, Wave 3 `domains/**`, `common/**`, `frontend/**`) are untouched.

2. **Security, SQL Safety & Verification**:
   - All dynamic schema identifiers pass through `postgresSchemaName(...)`, and all values use parameterized `$1..$3` bindings compliant with `scripts/check-sql.ts`.
   - CLI failure paths withhold connection credentials (`connection details withheld`).
   - Deterministic unit and PostgreSQL 17 concurrency suites (`graceful-shutdown.test.ts` 9/9, `lease-reaper.integration.test.ts` 5/5) cover signal deduplication, teardown step error isolation, late post-timeout drain rejections, queue-capacity-bounded reclamation, consumerless CLI safety, partial index migration parity, and concurrent `SKIP LOCKED` workers.

- Findings status: none

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: high
- Justification: All locked goals (`[G1]`–`[G5]`), bounded-context ownership boundaries, SQL `FOR UPDATE SKIP LOCKED` / advisory-lock invariants, graceful shutdown error-isolation guarantees, queue-capacity-bounded webhook reclamation, compiled container CLI packaging, and structural size ceilings are satisfied with zero remaining defects.
