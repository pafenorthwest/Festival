# Establish Goals
- Task name: s07-pr358-cache-invalidation-and-read-models
- Iteration: v0
- State: locked

## Status
Locked contract ready for execution in Wave 2 Group W2-B immediately after `S06` merges to `main`.

## Request
Execute Refactor Track 3 and merge PR `#358` (`issue347_perf_fixes`): introduce a plain TypeScript domain-event cache invalidation bus across `BoundedAsyncCache` consumers (`OrganizationService` and `ShopifyWebhookService.clearCaches`), remove 5-minute negative `null` caching, fix all PR `#358` file/function size limits, Scenario 4 (`3501..3750`), hermetic `process.env` test, CTE ISO timestamps, and `compose.yml` `max_connections=200`, replace N+1 loops in `listRegistrationEligibleClasses`, `listClassRegistrations`, and `ClassCheckoutService.evaluateEligibility` with batched SQL read models, and cache `PublicMembershipProductService.list`.

## Blocking ambiguity
None.

## Assumptions
- `S06` (`orgs.schema_migrations` + `scripts/migrate.ts`) has merged to `main` before `S07` begins so any PR `#358` index/schema migrations integrate cleanly into the tracked migration ledger and pass the CI `pg_dump` parity gate.
- Domain invalidation stays strictly in-process (single-node Docker Compose deployment on `/opt/Festival`) using plain typed TypeScript callbacks (`OrgUpdated`, `RegistrationAgeConfigUpdated`, `FestivalCatalogUpdated`, `ShopifySecretRotated`) with zero heavyweight mediator frameworks.
- `S08` (`packages/backend/src/index.ts`, `webhook-worker-queue.ts`, `reap-class-checkout-recovery.ts`, `docker/backend.Dockerfile`) owns disjoint runtime worker files and will not conflict with `S07`.

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

## Next action
Once `S06` merges to `main`, check out `issue347_perf_fixes` / `refactor/s07-pr358-cache-invalidation-and-read-models` and execute `tasks/s07-pr358-cache-invalidation-and-read-models/spec.md`.
