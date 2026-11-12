# Goals Extract
- Task name: s07-pr358-cache-invalidation-and-read-models
- Iteration: v0
- State: locked

## Goals
1. Replace isolated `BoundedAsyncCache` silos with a lightweight domain-event cache invalidation bus wired to `OrganizationService` (`OrgUpdated`, `RegistrationAgeConfigUpdated`) and `ShopifyWebhookService.clearCaches`, and eliminate 5-minute negative `null` caching from `organizationBySlugCache` and `registrationAgeConfigCache` in `packages/backend/src/customer/customer-account-service.ts`.
2. Resolve all PR `#358` (`issue347_perf_fixes`) correctness, hermeticity, and size blockers—splitting `perf-advanced-scenarios.ts` (`<=500`L) and `packages/backend/src/customer/postgres-customer-account-repository.ts` (`<=500`L, methods `<=60`L), fixing Scenario 4 Phase 2b (`3501..3750`), making `perf-advanced-scenarios.test.ts` hermetic from `process.env`, normalizing CTE `RETURNING` `Date` values to ISO `string`s, setting `compose.yml` Postgres `max_connections=200`—and merge PR `#358` into `main`.
3. Eliminate hot-path N+1 queries by converting `CustomerAccountService.listRegistrationEligibleClasses` (`GROUP BY festival_class_id`), `CustomerAccountService.listClassRegistrations` (`LEFT JOIN` metadata + cached org lookup), and `ClassCheckoutService.evaluateEligibility` (batched child lookup) to single/batched SQL read models.
4. Add domain-invalidated read caching to `PublicMembershipProductService.list` (`packages/backend/src/shopify/public-membership-product-service.ts`) so concurrent teacher/parent landing loads avoid redundant DB/Shopify roundtrips while invalidating immediately on catalog or integration updates.

## Non-goals
- Decomposing `CustomerAccountService`, `OrganizationService`, or `ClassCheckoutService` into their final Wave 3 `packages/backend/src/domains/*` folders (deferred to `S09`–`S11`).
- Implementing CQRS mediator frameworks, external Redis clusters, or abstract `AggregateRoot` classes (prohibited by the Strategic DDD Anti-Overkill Rule).
- Modifying `SIGTERM` shutdown hooks or lease reaper loops (owned by `s08`).

## Success criteria
- [G1] Updating `registrationAgeDate`, `timezone`, or organization slug in `OrganizationService` or invoking `ShopifyWebhookService.clearCaches` immediately invalidates dependent caches; missing slugs never cache `null` (zero 5-minute `404`/`409` lockouts and zero random-404 eviction of active tenants), verified by unit and integration tests.
- [G2] All PR `#358` files obey `<=500`L file and `<=60`L function ceilings, Scenario 4 Phase 2b targets `3501..3750`, `perf-advanced-scenarios.test.ts` passes hermetically regardless of ambient `process.env`, CTE `RETURNING` timestamps serialize as ISO `string`s, `compose.yml` sets `max_connections=200`, and PR `#358` merges cleanly.
- [G3] Query-count and Postgres 17 integration tests verify `listRegistrationEligibleClasses`, `listClassRegistrations`, and `ClassCheckoutService.evaluateEligibility` execute constant-count (`O(1)`) SQL queries independent of class, registration, or cart-item count.
- [G4] `PublicMembershipProductService.list` serves warm tenant membership listings from cache, invalidates deterministically on product/Shopify integration events, and passes the full repo quality gate.
