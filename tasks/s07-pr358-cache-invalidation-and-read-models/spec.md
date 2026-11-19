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
- **PR `#358` Merge & `[G2]` Remediations**:
  - Merged `origin/issue347_perf_fixes` (`3f7e5ae`) via `--no-ff` (`4f27367`), preserving ancestry so GitHub auto-merges PR `#358`.
  - Split `packages/backend/scripts/perf-advanced-scenarios.ts` (`385`L) and `packages/backend/scripts/perf-scenario-helpers.ts` (`242`L) with hermetic `parseConfig(options?)` and Scenario 4 Phase 2b partitioned across `3001..3750` (`3501..3750` joiners).
  - Split `packages/backend/src/customer/postgres-customer-account-repository.ts` (`449`L), `packages/backend/src/customer/postgres-customer-account-mappers.ts` (`291`L), and `packages/backend/src/customer/postgres-customer-account-queries.ts` (`252`L) with canonical ISO-8601 `.toISOString()` normalization on all `TIMESTAMPTZ` `Date` columns (including CTE `RETURNING` and joined reads).
  - Configured `max_connections=200` in `cloud-setup/compose.yml` and `docker-compose.yml`, plus optional `databasePoolMax?: number` (`default 80`) in `packages/backend/src/config/env.ts`.
- **`[G1]` Domain Cache Invalidation Bus & Non-Null Policy**:
  - Implemented `packages/backend/src/lib/bounded-async-cache.ts` (`220`L; `cacheNullish = false` default, `(key, value)` `deleteWhere`, and in-flight `inFlight`/`pending` race protection in `1a2ea87` so pre-invalidation loads never coalesce post-invalidation readers or repopulate stale entries), with 1-line re-export shims in `packages/backend/src/customer/bounded-async-cache.ts` and `packages/backend/src/commerce/bounded-async-cache.ts`.
  - Implemented `packages/backend/src/lib/domain-cache-invalidator.ts` (`71`L; `OrgUpdated`, `RegistrationAgeConfigUpdated`, `FestivalCatalogUpdated`, `ShopifySecretRotated`, `MembershipChanged`, `CachesCleared`) and wired `bindCacheInvalidator` across `OrganizationService`, `CustomerAccountService`, `ShopifyWebhookService` (`clearCaches` / `flushLocalCaches`), `ShopifyIntegrationService`, `ShopifyMembershipProductService`, `PublicMembershipProductService`, and `packages/backend/src/app.ts` (including option-injected test/DI instances).
- **`[G3]` Constant-Count (`O(1)`) SQL Read Models**:
  - Added `countConfirmedClassEntitlementsByClassIds` (`GROUP BY festival_class_id`) in `packages/backend/src/commerce/postgres-class-entitlement-count.ts` (`43`L) for `CustomerAccountService.listRegistrationEligibleClasses` (`11` constant SQL queries across 2 vs. 8 classes).
  - Added `findRegistrationMetadataMap` (`LEFT JOIN` across `registration_metadata`, `registration_repertoire_items`, and `registration_repertoire_item_contributors`) in `packages/backend/src/checkout/postgres-registration-metadata-queries.ts` (`107`L), plus `organizationBySlugCache` and preloaded festival class configs in `CustomerAccountService.listClassRegistrations` (`8` constant SQL queries, `0` uncached slug queries on warm cache).
  - Added batched `findChildrenByIds` across `CustomerAccountRepository` implementations and wired `ClassCheckoutService.evaluateEligibility` (`7` constant SQL queries, `1` `festival_children` query, preserving `404` IDOR protection).
- **`[G4]` Public Membership Product Listing Cache**:
  - Added 5-minute domain-invalidated read caching with defensive cloning on store and read to `PublicMembershipProductService.list(slug)` (`packages/backend/src/shopify/public-membership-product-service.ts`, `189`L), without caching thrown `404`/`503` errors and keeping `resolvePurchasable` live for real-time OAuth checkout validation.
- **Exceptions**: None (`customer-account-service.ts`, `organization-service.ts`, and `class-checkout-service.ts` remain pre-existing Wave 3 split targets scheduled for `S09`–`S11`, with extracted helpers keeping net-new units cohesive and within size limits).
- **Deferred work**: None.

## Quality gate results
- `validate-packet.ps1 -TaskName s07-pr358-cache-invalidation-and-read-models -RequireCodeReview`: `exit 0` (`PACKET VALID: task=s07-pr358-cache-invalidation-and-read-models iteration=v0 state=locked goals=4 codeReview=valid(none)`).
- `bun run verify:toolchain`: `exit 0` (`Bun 1.4.2`, `TypeScript 5.9.3`).
- `bun run format:check`: `exit 0` (`547` files checked, `0` issues).
- `bun run lint`: `exit 0` (`547` files checked, `0` warnings, `0` errors).
- `bun run build`: `exit 0` (`@festival/common`, `@festival/backend`, `@festival/frontend`, `@festival/shopify-confirmation`).
- `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: `exit 0`.
- `bun run --cwd packages/frontend check:types`: `exit 0`.
- `bun run check:sql`: `exit 0` (`295` backend TypeScript files verified).
- Workspace tests (`POSTGRES_INTEGRATION_URL="postgres://postgres:postgres@127.0.0.1:5432/festival_test"`): `exit 0` — `@festival/common` (`353 pass, 0 fail`), `@festival/backend` (`1,656 pass, 0 fail, 0 skip` across `140` files including unit and PostgreSQL 17 integration suites `domain-cache-invalidation.test.ts`, `domain-cache-invalidation.integration.test.ts`, `perf-advanced-scenarios.test.ts`, `postgres-customer-account-repository.integration.test.ts`, and `read-models-query-count.integration.test.ts`), `@festival/frontend` (`455 pass, 0 fail`), `@festival/shopify-confirmation` (`20 pass, 0 fail`).
- Independent code review (`tasks/s07-pr358-cache-invalidation-and-read-models/code-review.md`): `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`Confidence: high`, round-1 in-flight invalidation race `F1` resolved in `1a2ea87`).
