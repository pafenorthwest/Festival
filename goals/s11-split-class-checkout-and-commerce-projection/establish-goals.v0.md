# Establish Goals
- Task name: s11-split-class-checkout-and-commerce-projection
- Iteration: v0
- State: locked

## Status
Goals locked for Wave 3 (`Nov 18–21`, Parallel Group W3, Track 5A/5B Slice 3: `class-checkout` & `commerce-projection` Decomposition).

## Request
Extract `packages/backend/src/domains/class-checkout/**` (including `customer-registration-query-service.ts` — `CustomerRegistrationQueryService` for `listRegistrationEligibleClasses` and `listClassRegistrations`) and `packages/backend/src/domains/commerce-projection/**` from `class-checkout-service.ts` (`1,390`L), `shopify/admin-api-client.ts` (`1,878`L; `ShopifyAdminApiClient`), `shopify-order-projection-service.ts` (`1,327`L), `postgres-membership-commerce-repository.ts` (`1,309`L), and `drop-transfer-service.ts` (`963`L); enforce `<=500`L/file, `<=60`L/fn; and retire duplicate `InMemory*` commerce/checkout clones.

## Blocking ambiguity
None.

## Assumptions
- Baseline `v0.3.0` (`#354` `orgs.class_checkout_executions` store) and Wave 2 (`S06` migrations, `S07` single-query registration read models + batch `findChild` + invalidation bus, `S08` `FOR UPDATE SKIP LOCKED` lease reaper) are merged to `main`.
- `S10` owns `packages/backend/src/customer/**`, `membership-status-service.ts`, `accompanist-membership-service.ts`, and `public-membership-product-service.ts`; `S11` implements `CustomerRegistrationQueryService` (`packages/backend/src/domains/class-checkout/customer-registration-query-service.ts` — `listRegistrationEligibleClasses`, `listClassRegistrations`) inside `domains/class-checkout/**` without editing `packages/backend/src/customer/**` directly, owns `postgres-membership-commerce-repository.ts` (`ShopifyIntegrationRepository` + commerce persistence), and preserves thin re-exports so `S10` and `app.ts` merge without conflict (cross-wiring finalizes in `S14`).
- Functional edge-case behavior changes (`#357` `B1`/`B2`) remain deferred to December Week 1 unless explicitly pulled forward; `S11` is a pure behavior-preserving structural refactor.

## Goals
1. Extract the `class-checkout` bounded context (`packages/backend/src/domains/class-checkout/**`) owning `orgs.checkout_carts`, `orgs.checkout_intents`, `orgs.checkout_intent_lines`, `orgs.class_checkout_executions`, `orgs.class_checkout_execution_events`, `orgs.checkout_recovery_requests`, `orgs.registration_metadata`, `orgs.registration_repertoire_items`, `orgs.registration_repertoire_item_contributors`, `orgs.festival_class_waitlist_entries`, `orgs.festival_class_waitlist_events`, and `orgs.registration_change_logs` by implementing `CustomerRegistrationQueryService` (`customer-registration-query-service.ts` — `listRegistrationEligibleClasses`, `listClassRegistrations`) and decomposing `class-checkout-service.ts` (`1,390`L) and `drop-transfer-service.ts` (`963`L) into focused `<=500`L modules emitting `CheckoutIntentResolved` and `ClassCapacityChanged` domain events.
2. Extract the `commerce-projection` bounded context (`packages/backend/src/domains/commerce-projection/**`) owning `orgs.shopify_integrations`, `orgs.shopify_webhook_deliveries`, `orgs.shopify_order_projections`, `orgs.class_entitlements`, `orgs.membership_validation_decisions`, `orgs.membership_validation_decision_audits`, `orgs.membership_reconciliation_runs`, `orgs.billing_adjustments`, `orgs.billing_ledger`, `orgs.credit_balances`, `orgs.invoices`, `orgs.invoice_line_items`, and `orgs.refund_events` by decomposing `shopify/admin-api-client.ts` (`1,878`L; `ShopifyAdminApiClient` into GraphQL transport + `catalog`, `orders`, and `webhooks` operations), `shopify-order-projection-service.ts` (`1,327`L), and `postgres-membership-commerce-repository.ts` (`1,309`L), emitting `ShopifySecretRotated` and `OrderProjected` domain events.
3. Enforce strict modular size and dependency boundaries (`<=500` lines/file, `<=250` lines/class, `<=60` lines/function, acyclic `specs/bounded-contexts-2026.md` DAG where `class-checkout` imports cross-domain only from `tenant-org`, `catalog-repertoire`, `customer-identity`, and `teacher-directory`, and `commerce-projection` imports cross-domain only from `tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, and `class-checkout`) while preserving thin legacy facades so `app.ts` and parallel Wave 3 worktrees merge cleanly.
4. Retire duplicate `InMemoryCheckoutRepository`, `InMemoryCheckoutRecoveryRepository`, `InMemoryMembershipCommerceRepository`, `InMemoryClassEntitlementRepository`, `InMemoryRegistrationChangeRepository`, and `InMemoryBillingRepository` SQL clones behind transactional Postgres 17 integration tests and minimal unit stubs.

## Non-goals
- Modifying `tenant-org` or `catalog-repertoire` files (`postgres-organization-repository.ts`, `organization-service.ts`, `repertoire/**`) owned by parallel Wave 3 packet `S09`.
- Modifying `customer-identity` or `teacher-directory` files (`customer-account-service.ts`, `postgres-customer-account-repository.ts`, `participant-profile/**`) owned by parallel Wave 3 packet `S10`.
- Modifying `@festival/common` DTO schemas, `route-security.ts`, frontend API clients (`S12`), frontend SolidJS state (`S13`), final `packages/backend/src/app.ts` DI cleanup (`S14`), or December `#357` functional checkout edge cases (`B1`/`B2`).

## Success criteria
- [G1] `packages/backend/src/domains/class-checkout/**` isolates `CustomerRegistrationQueryService` (`customer-registration-query-service.ts` — `listRegistrationEligibleClasses`, `listClassRegistrations`), eligibility evaluation, Shopify cart handoff, `#354` checkout execution/lease recovery, waitlist management, 42-day metadata edits, and drop/transfer operations across `<=500`L files, emitting `CheckoutIntentResolved` and `ClassCapacityChanged`.
- [G2] `packages/backend/src/domains/commerce-projection/**` splits `ShopifyAdminApiClient` (`1,878`L) into reusable GraphQL transport + `catalog`/`orders`/`webhooks` clients, decomposes `ShopifyOrderProjectionService` (`1,327`L) and `PostgresMembershipCommerceRepository` (`1,309`L), and emits `ShopifySecretRotated` and `OrderProjected`.
- [G3] Every created or modified file in `S11` meets `<=500` lines/file, `<=250` lines/class, and `<=60` lines/function, and `packages/backend/tests/architecture-boundaries.test.ts` passes with zero boundary or cycle violations.
- [G4] Duplicate `InMemory*` commerce/checkout SQL emulators are retired, migrated integration tests pass against real Postgres 17 (`POSTGRES_INTEGRATION_URL`), and zero files owned by `S09`, `S10`, `S12`, `S13`, or `S14` are modified.

## Next action
Execute `tasks/s11-split-class-checkout-and-commerce-projection/spec.md` in an isolated Wave 3 git worktree (`refactor/s11-split-class-checkout-and-commerce-projection`).
