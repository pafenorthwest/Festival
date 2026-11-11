# S07 — Track 3 + PR #358: Domain Cache Invalidation Bus, PR #358 Fixes, and Batched SQL Read Models

## Goal reference
- Goal contract: `goals/s07-pr358-cache-invalidation-and-read-models/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 2, Group W2-B, depends on `S06`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (domain invalidation events `OrgUpdated`, `RegistrationAgeConfigUpdated`, `FestivalCatalogUpdated`, `ShopifySecretRotated` across `tenant-org`, `customer-identity`, `teacher-directory`, `class-checkout`, and `commerce-projection`)

## Scope

### In scope
- PR `#358` (`issue347_perf_fixes`) touched files, including:
  - `packages/backend/src/lib/bounded-async-cache.ts` and new lightweight domain cache invalidation bus (`packages/backend/src/lib/domain-cache-invalidator.ts`)
  - `packages/backend/src/customer/postgres-customer-account-repository.ts` (and extracted helper query modules `<=500`L)
  - `packages/backend/scripts/perf-advanced-scenarios.ts` (split into cohesive `<=500`L modules) and `packages/backend/tests/perf-advanced-scenarios.test.ts`
  - `compose.yml` (`max_connections=200`)
- `packages/backend/src/services/organization-service.ts` (emit `OrgUpdated` / `RegistrationAgeConfigUpdated` invalidation events)
- `packages/backend/src/commerce/shopify-webhook-service.ts` (`clearCaches` hook wired to domain invalidator)
- `packages/backend/src/customer/customer-account-service.ts` (`organizationBySlugCache` / `registrationAgeConfigCache` non-null caching + `listRegistrationEligibleClasses` and `listClassRegistrations` N+1 replacements)
- `packages/backend/src/checkout/class-checkout-service.ts` (`evaluateEligibility` batched `findChildrenByIds` lookup)
- `packages/backend/src/shopify/public-membership-product-service.ts` (cached `list` with invalidation)
- `packages/backend/src/app.ts` (wiring the shared domain invalidator across services)
- Unit and Postgres 17 integration tests under `packages/backend/tests/`
- `tasks/s07-pr358-cache-invalidation-and-read-models/spec.md` and `tasks/s07-pr358-cache-invalidation-and-read-models/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S07` upon merge)

### Out of scope
- `packages/backend/src/index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile` (locked to `s08`)
- `scripts/migrate.ts` and `packages/backend/src/repo/postgres-schema.ts` (completed in `s06-schema-migrations-ledger-runner`, except registering any PR `#358` SQL migration cleanly in `database/migrations/` + `database/postgres17-schema.sql`)
- Full repository/service directory moves into `packages/backend/src/domains/*` (locked to Wave 3 packets `S09`–`S11`)
- All `packages/frontend/**` files

## Approach
1. **Domain Cache Invalidation Bus & Non-Null Policy (Red-Green)**:
   - Write failing unit tests proving: (a) `BoundedAsyncCache` does not cache `null`/`undefined` misses when configured for non-negative caching, preventing 256 random `404` slugs from evicting live tenants or locking out newly created orgs for 5 minutes; (b) `OrganizationService` mutations (`registrationAgeDate`, `timezone`, slug/org settings) immediately invalidate `organizationBySlugCache` and `registrationAgeConfigCache`; and (c) `ShopifyWebhookService.clearCaches` flushes shared caches.
   - Implement `domain-cache-invalidator.ts` (`<=150`L, plain TypeScript functions/callbacks) and wire it into `OrganizationService`, `CustomerAccountService`, `PublicMembershipProductService`, `ShopifyWebhookService`, and `app.ts`.
2. **PR `#358` Remediation & Merge Prep**:
   - Rebase/merge `main` (post-`S06`) into `issue347_perf_fixes`, aligning any SQL index migrations with `database/postgres17-schema.sql` and `scripts/migrate.ts`.
   - Split `perf-advanced-scenarios.ts` (`602`L down to `<=500`L) and `postgres-customer-account-repository.ts` (`885`L down to `<=500`L; refactor `85`L/`73`L methods to `<=60`L).
   - Fix Scenario 4 Phase 2b index range (`3501..3750`), pass explicit env maps to `parseConfig` in `perf-advanced-scenarios.test.ts` (zero `process.env` coupling), convert CTE `RETURNING` `Date` columns to `.toISOString()`, and set `max_connections=200` in `compose.yml`.
3. **Replace Hot-Path N+1 Queries with SQL Read Models (Red-Green)**:
   - Add Postgres 17 integration tests asserting query counts and exact output parity for:
     - `CustomerAccountService.listRegistrationEligibleClasses`: replace per-class queries with a single `GROUP BY festival_class_id` aggregation.
     - `CustomerAccountService.listClassRegistrations`: use `organizationBySlugCache` and fetch registration metadata via a single `LEFT JOIN` query.
     - `ClassCheckoutService.evaluateEligibility`: batch child lookups (`findChildrenByIds`) instead of per-item `findChild` calls.
     - `PublicMembershipProductService.list`: cache active membership product listings per tenant with automatic invalidation on catalog/Shopify mutations.
4. **Full Verification & Merge**:
   - Execute all unit, Postgres 17 integration, schema-parity, `check:sql`, Biome, and `tsc` gates, record independent subagent `code-review.md`, and merge `#358` / `S07` to `main`.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s07-pr358-cache-invalidation-and-read-models
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
Pending execution.

## Quality gate results
Pending execution.
