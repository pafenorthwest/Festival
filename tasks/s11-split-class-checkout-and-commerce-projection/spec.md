# S11 — Split `class-checkout` & `commerce-projection` Bounded Contexts (Track 5A/5B Slice 3)

## Goal reference
- Locked goals: `goals/s11-split-class-checkout-and-commerce-projection/goals.v0.md`
- Goal establishment record: `goals/s11-split-class-checkout-and-commerce-projection/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/backend/src/domains/class-checkout/**` — `CustomerRegistrationQueryService` (`customer-registration-query-service.ts` — `listRegistrationEligibleClasses` and `listClassRegistrations` backed by single-query SQL read models), `ClassEligibilityService` (`class-eligibility-service.ts`), `ClassCheckoutExecutionService` (`class-checkout-execution-service.ts` / cart handoff), `CheckoutRecoveryService` (`checkout-recovery-service.ts`), `WaitlistService` (`waitlist-service.ts`), `DropTransferService` (split into validation, fee/credit calculation, and execution modules), `checkout-intent-repository.ts`, `checkout-execution-repository.ts`, `registration-metadata-repository.ts`, `waitlist-repository.ts`, and `PostgresRegistrationChangeRepository` (`orgs.registration_change_logs`), emitting `CheckoutIntentResolved` and `ClassCapacityChanged` events.
- `packages/backend/src/domains/commerce-projection/**` — `ShopifyGraphqlTransport` (`shopify-graphql-transport.ts`), `ShopifyCatalogAdminClient` (`shopify-catalog-client.ts`), `ShopifyOrdersAdminClient` (`shopify-orders-client.ts`), `ShopifyWebhooksAdminClient` (`shopify-webhooks-client.ts`), `ShopifyIntegrationRepository` (`shopify-integration-repository.ts`), `ShopifyWebhookDeliveryRepository` (`webhook-delivery-repository.ts`), `OrderProjectionRepository` (`order-projection-repository.ts`), `ClassEntitlementRepository` (`class-entitlement-repository.ts`), `BillingRepository` (`billing-repository.ts`), `ShopifyOrderProjectionService`, `ReconciliationService`, and `BillingService` (`ShopifySecretRotated`, `OrderProjected` events).
- `packages/backend/src/checkout/class-checkout-service.ts` (`1,390`L) and `packages/backend/src/checkout/**` (preserving `reap-class-checkout-recovery.ts` entrypoint contract from `S08`) — replace monoliths with `<=500`L delegating facades and retire `InMemoryCheckoutRepository` / `InMemoryCheckoutRecoveryRepository`.
- `packages/backend/src/shopify/admin-api-client.ts` (`1,878`L; `ShopifyAdminApiClient`, also referred to as `shopify-admin-api-client.ts`) and `packages/backend/src/shopify/**` (excluding `public-membership-product-service.ts` owned by `S10`) — decompose into `domains/commerce-projection/**` (`<=500`L/file) behind a thin delegating `ShopifyAdminApiClient` facade.
- `packages/backend/src/commerce/shopify-order-projection-service.ts` (`1,327`L), `packages/backend/src/commerce/postgres-membership-commerce-repository.ts` (`1,309`L), `packages/backend/src/commerce/membership-commerce-repository.ts`, and `packages/backend/src/commerce/class-entitlement-repository.ts` — decompose into `domains/commerce-projection/**` and retire `InMemoryMembershipCommerceRepository` & `InMemoryClassEntitlementRepository`.
- `packages/backend/src/registration/drop-transfer-service.ts` (`963`L), `packages/backend/src/registration/registration-change-repository.ts`, `packages/backend/src/waitlist/**`, and `packages/backend/src/billing/**` — extract into `domains/class-checkout/**` and `domains/commerce-projection/**` and retire `InMemoryRegistrationChangeRepository` & `InMemoryBillingRepository`.
- `packages/backend/tests/domains/class-checkout/**`, `packages/backend/tests/domains/commerce-projection/**`, and migrated checkout/commerce/Shopify/billing backend test suites.

### Out of scope
- `packages/backend/src/domains/tenant-org/**`, `packages/backend/src/domains/catalog-repertoire/**`, `packages/backend/src/repo/**`, `packages/backend/src/services/organization-service.ts`, `packages/backend/src/repertoire/**`, and `packages/backend/src/rooms/**` (locked by parallel Wave 3 packet `S09`).
- `packages/backend/src/domains/customer-identity/**`, `packages/backend/src/domains/teacher-directory/**`, `packages/backend/src/customer/**` (locked by `S10`; `S11` implements `customer-registration-query-service.ts` cleanly inside `domains/class-checkout/**` and `S14` wires final `app.ts` / facade callers), `packages/backend/src/participant-profile/**`, `packages/backend/src/commerce/membership-status-service.ts`, `packages/backend/src/commerce/accompanist-membership-service.ts`, and `packages/backend/src/shopify/public-membership-product-service.ts` (locked by parallel Wave 3 packet `S10`).
- `packages/common/src/**`, `packages/backend/src/routes/route-security.ts`, `packages/frontend/src/lib/api.ts`, and `packages/frontend/src/lib/api/**` (locked by Wave 3 packet `S12`).
- `packages/frontend/src/app/**`, `packages/frontend/src/lib/routes.ts`, `packages/frontend/src/pages/**`, and `packages/frontend/src/components/**` (locked by parallel Wave 3 packet `S13`).
- `packages/backend/src/app.ts` — preserve constructor compatibility via thin facades until `S14`.

## Approach
1. **Decompose `ShopifyAdminApiClient` (`1,878`L)**: Extract `ShopifyGraphqlTransport` (auth headers, rate-limit/error parsing, retry/timeout handling) and three focused operation clients (`ShopifyCatalogAdminClient`, `ShopifyOrdersAdminClient`, `ShopifyWebhooksAdminClient`), keeping a thin `ShopifyAdminApiClient` composition facade (`<=250`L) at `packages/backend/src/shopify/admin-api-client.ts`.
2. **Extract `CustomerRegistrationQueryService` & Decompose `ClassCheckoutService` (`1,390`L) / `DropTransferService` (`963`L)**: Implement `CustomerRegistrationQueryService` (`packages/backend/src/domains/class-checkout/customer-registration-query-service.ts` — `listRegistrationEligibleClasses` and `listClassRegistrations` using `S07`'s single-query PostgreSQL `GROUP BY` / `LEFT JOIN` read models across `orgs.festival_class_configurations`, `orgs.class_entitlements`, and `orgs.registration_metadata`) and partition eligibility checks (`S07` batched `findChild`), cart storefront binding (`#354` `orgs.checkout_carts`, `orgs.checkout_intents`, `orgs.checkout_intent_lines`), checkout execution state transitions (`orgs.class_checkout_executions`, `orgs.class_checkout_execution_events`, `orgs.checkout_recovery_requests`), waitlist handoffs (`orgs.festival_class_waitlist_entries`, `orgs.festival_class_waitlist_events`), 42-day metadata edits (`orgs.registration_metadata`, `orgs.registration_repertoire_items`, `orgs.registration_repertoire_item_contributors`), and drop/transfer workflows (`orgs.registration_change_logs`) under `packages/backend/src/domains/class-checkout/**` (`<=500`L/file, `<=250`L/class, `<=60`L/fn), emitting `CheckoutIntentResolved` and `ClassCapacityChanged`.
3. **Decompose `ShopifyOrderProjectionService` (`1,327`L) & `PostgresMembershipCommerceRepository` (`1,309`L)**: Split Shopify integration credentials/webhook delivery persistence (`ShopifyIntegrationRepository`) from entitlement/order projection persistence, separate order line classification from entitlement grant orchestration under `domains/commerce-projection/**`, and emit `ShopifySecretRotated` and `OrderProjected`.
4. **Retire `InMemory*` Clones & Verify**: Remove duplicate SQL-emulator repositories across checkout, commerce, registration changes, and billing; migrate suites to transactional Postgres 17 tests (`POSTGRES_INTEGRATION_URL`) plus thin unit stubs; confirm `architecture-boundaries.test.ts` passes (`commerce-projection` -> `class-checkout` / `teacher-directory` / `customer-identity` / `catalog-repertoire` / `tenant-org` acyclic).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s11-split-class-checkout-and-commerce-projection
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
