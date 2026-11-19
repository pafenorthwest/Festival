# Code Review
- Task name: s07-pr358-cache-invalidation-and-read-models

## Context
Independent Step 4 code review (and post-fix re-audit after commit `1a2ea87`) of `s07-pr358-cache-invalidation-and-read-models` against `goals/s07-pr358-cache-invalidation-and-read-models/goals.v0.md` (`[G1]`–`[G4]`), `tasks/s07-pr358-cache-invalidation-and-read-models/spec.md`, and `specs/bounded-contexts-2026.md` (§2 Anti-Overkill Policy, §4 domain cache-invalidation events, §5.3–5.4 SQL read joins and zero uninvalidated/null cross-domain caches).

## Scope & Files Reviewed
- `packages/backend/src/lib/bounded-async-cache.ts` (220 lines; `BoundedAsyncCache` 187 lines; max method `35` lines) and re-exports in `packages/backend/src/customer/bounded-async-cache.ts` (1 line) & `packages/backend/src/commerce/bounded-async-cache.ts` (1 line)
- `packages/backend/src/lib/domain-cache-invalidator.ts` (71 lines)
- `packages/backend/src/app.ts` (`DomainCacheInvalidator` wiring across default and option-injected services, plus `sql.options.max = env.databasePoolMax`)
- `packages/backend/src/config/env.ts` (`parseDatabasePoolMax`, default `80`)
- `packages/backend/src/services/organization-service.ts` (`OrgUpdated`, `RegistrationAgeConfigUpdated`, `FestivalCatalogUpdated` emissions)
- `packages/backend/src/commerce/shopify-webhook-service.ts` (`bindCacheInvalidator`, re-entrancy-safe `clearCaches` / `flushLocalCaches`)
- `packages/backend/src/shopify/shopify-integration-service.ts` (`ShopifySecretRotated` emissions)
- `packages/backend/src/shopify/shopify-membership-product-service.ts` (`MembershipChanged` emissions, including partial `shopifyMutated` reconciliation path)
- `packages/backend/src/shopify/public-membership-product-service.ts` (189 lines; cached `list` with defensive cloning, live `resolvePurchasable`)
- `packages/backend/src/customer/customer-account-service.ts` (`organizationBySlugCache`, `registrationAgeConfigCache`, `listRegistrationEligibleClasses` batched counts, `listClassRegistrations` batched metadata/org cache)
- `packages/backend/src/customer/customer-account-repository.ts`, `packages/backend/src/customer/in-memory-customer-account-repository.ts`, `packages/backend/src/customer/customer-account-transport.ts`
- `packages/backend/src/customer/postgres-customer-account-repository.ts` (449 lines), `packages/backend/src/customer/postgres-customer-account-mappers.ts` (291 lines), `packages/backend/src/customer/postgres-customer-account-queries.ts` (252 lines)
- `packages/backend/src/checkout/class-checkout-service.ts` (`verifyOwnedChildren` batched `findChildrenByIds`), `packages/backend/src/checkout/checkout-repository.ts`, `packages/backend/src/checkout/postgres-checkout-repository.ts`, `packages/backend/src/checkout/postgres-registration-metadata-queries.ts` (107 lines)
- `packages/backend/src/commerce/postgres-class-entitlement-count.ts` (43 lines), `packages/backend/src/commerce/class-entitlement-repository.ts`, `packages/backend/src/commerce/membership-commerce-repository.ts`, `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`
- `packages/backend/scripts/perf-advanced-scenarios.ts` (385 lines), `packages/backend/scripts/perf-scenario-helpers.ts` (242 lines), `packages/backend/scripts/perf-500-children.ts`, `database/seeds/04-perf-test.sql`, `docs/performance/release-benchmarks.md`
- `cloud-setup/compose.yml` & `docker-compose.yml` (`max_connections=200`), `packages/backend/package.json`, `packages/backend/tsconfig.json`, `packages/backend/tsconfig.build.json`
- Tests: `domain-cache-invalidation.test.ts` (483 lines), `domain-cache-invalidation.integration.test.ts` (335 lines), `perf-advanced-scenarios.test.ts` (190 lines), `postgres-customer-account-repository.integration.test.ts` (220 lines), `read-models-query-count.integration.test.ts` (444 lines), `config-env.test.ts`, `customer-account-repository.test.ts`, `customer-account-service.test.ts`

## Audit Summary
1. **Goal & Spec Compliance (`[G1]`–`[G4]`, In-Scope / Out-of-Scope)**:
   - `[G1]` Met: `BoundedAsyncCache` defaults `cacheNullish = false`, preventing 404 misses from entering cache or evicting active tenants. `DomainCacheInvalidator` (`71`L, plain TypeScript, re-entrancy safe on `clearAll()`) is wired across `OrganizationService`, `CustomerAccountService`, `PublicMembershipProductService`, `ShopifyMembershipProductService`, `ShopifyIntegrationService`, and `ShopifyWebhookService` (including option-injected instances in `createApp`). In-flight invalidation race `F1` is resolved in `1a2ea87`: `this.inFlight` and `this.pending` track `invalidatedPredicates` and `superseded` state so mid-flight `deleteWhere` or `force = true` calls detach stale coalescing and prevent pre-invalidation loads from repopulating `this.entries` or overwriting fresher entries.
   - `[G2]` Met: Commit `3f7e5ae` (`origin/issue347_perf_fixes`) is cleanly merged into branch ancestry. All split/extracted PR `#358` and S07 modules obey `<= 500`L file and `<= 60`L function ceilings (`bounded-async-cache.ts`: `220`L / max fn `35`L; `perf-advanced-scenarios.ts`: `385`L / max fn `51`L; `perf-scenario-helpers.ts`: `242`L / max fn `39`L; `postgres-customer-account-repository.ts`: `449`L / max fn `37`L; `postgres-customer-account-mappers.ts`: `291`L / max fn `17`L; `postgres-customer-account-queries.ts`: `252`L / max fn `56`L). Scenario 4 partitions Phase 1 (`3001..3500`), Phase 2a (`3001..3250`), and Phase 2b (`3501..3750`) with preseeded children. `parseConfig` and `perf-advanced-scenarios.test.ts` are strictly hermetic from ambient `process.env`. All Postgres `TIMESTAMPTZ` values (including CTE `RETURNING` and `LEFT JOIN` reads) normalize `Date` instances to ISO-8601 strings. Both `cloud-setup/compose.yml` and `docker-compose.yml` configure `max_connections=200`.
   - `[G3]` Met: `listRegistrationEligibleClasses` (`GROUP BY festival_class_id`), `listClassRegistrations` (`LEFT JOIN` across `registration_metadata`, `registration_repertoire_items`, and `registration_repertoire_item_contributors` with deterministic `ORDER BY meta.id, item.display_order, contributor.position` + `organizationBySlugCache`), and `ClassCheckoutService.evaluateEligibility` (batched `findChildrenByIds` preserving `404` IDOR protection) execute constant-count (`O(1)`) SQL queries verified against PostgreSQL 17 and `bun run check:sql`.
   - `[G4]` Met: `PublicMembershipProductService.list` serves warm tenant listings from cache with defensive cloning on store and read, skips caching thrown `404`/`503` errors, keeps `resolvePurchasable` live, and invalidates deterministically on both settled and in-flight product/Shopify/org/catalog events.
   - Out-of-scope boundaries respected: zero edits to `index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile`, `scripts/migrate.ts`, `postgres-schema.ts`, `packages/frontend/**`, or `AGENTS.md`.

2. **Security, SQL Safety & Verification**:
   - All dynamic schema identifiers are validated and all SQL parameters use `$1..$N` / `sql.array(...)` bindings passing `bun run check:sql` (295 backend files validated).
   - Zero Tactical DDD ceremony, zero credentials/secrets, and zero debug `console.*` statements in `src/`.
   - Unit, deterministic deferred-promise concurrency, `architecture-boundaries.test.ts`, and PostgreSQL 17 integration suites pass (`40 pass, 0 fail`), alongside `format:check`, `lint`, and `build`.

- Findings status: none

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: high
- Justification: All locked goals ([G1]-[G4]), PR #358 remediation and ancestry requirements, in-flight and settled domain cache invalidation invariants (F1 resolved), O(1) PostgreSQL 17 read models, bounded-context rules, and file/function size guardrails are satisfied with zero remaining defects.
