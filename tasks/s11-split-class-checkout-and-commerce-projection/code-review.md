# Code Review
- Task name: s11-split-class-checkout-and-commerce-projection

## Context
Independent code review of Wave 3 packet S11 (`s11-split-class-checkout-and-commerce-projection`) against `goals/s11-split-class-checkout-and-commerce-projection/goals.v0.md`, `tasks/s11-split-class-checkout-and-commerce-projection/spec.md`, `specs/bounded-contexts-2026.md`, and `git diff origin/main`.

- **Scope lock**: Verified all 169 changed/added files against `origin/main`. Zero modifications to `AGENTS.md`, `packages/backend/src/app.ts`, `packages/backend/src/repo/**`, `packages/backend/src/routes/**`, `packages/common/**`, `packages/frontend/**`, or S09/S10-owned paths (`customer/**`, `participant-profile/**`, `repertoire/**`, `rooms/**`, `services/organization-service.ts`, `commerce/{membership-status-service,accompanist-membership-service}.ts`, `shopify/public-membership-product-service.ts`).
- **Bounded-context & modular size rules**: AST inspection across all 155 modified/added `packages/backend/src/**/*.ts` files confirmed 0 size violations (`<=500` lines/file, `<=250` lines/class, `<=60` lines/function). Across all 94 domain files (`domains/class-checkout` and `domains/commerce-projection`), there are 0 `InMemory*` classes, `AppError` is imported exclusively from `@festival/common`, `class-checkout` imports no sibling domains, and `commerce-projection` imports only `../class-checkout/index.js` and `../../infra/s11-infra.js` externally (zero unmerged domain barrel imports). Legacy `InMemory*` adapters remain modularized (`<=500` lines/file) outside `domains/` solely to preserve `app.ts`, `routes/api-router.ts`, and pre-S14 test compatibility.
- **Functional & security invariants**:
  - `CustomerRegistrationQueryService` (`domains/class-checkout/customer-registration-query-service.ts` and `customer-registration-sql-queries.ts`) implements S07 `GROUP BY` and joined SQL read models for `listRegistrationEligibleClasses` and `listClassRegistrations`, with `OrgUpdated` cache invalidation and tenant isolation.
  - S08 lease recovery (`reapExpiredClassCheckoutExecutions` via `checkout/reap-class-checkout-recovery.ts` -> `domains/class-checkout/checkout-execution-repository.ts` and `checkout-execution-lifecycle-queries.ts`) and `WebhookWorkerQueue.drain()` (`domains/commerce-projection/webhook-worker-queue.ts`) preserve recovery and graceful drain contracts.
  - `ClassCheckoutEventBus` emits `CheckoutIntentResolved` and `ClassCapacityChanged`; `CommerceProjectionEventBus` emits `ShopifySecretRotated` and `OrderProjected`.
  - `ShopifyAdminApiClient` (`shopify/admin-api-client.ts`) delegates cleanly to `ShopifyGraphqlTransport`, `ShopifyCatalogAdminClient`, `ShopifyOrdersAdminClient`, and `ShopifyWebhooksAdminClient`; `OrderProjectionFinalization` (`order-projection-finalization.ts`, `order-projection-class-tx.ts`) preserves advisory locks, `class_checkout_executions` checkpoint/state guards, and parameterized `organization_id`-scoped SQL.
- **Observed verification results**:
  - `bun run format:check` (`biome check packages`): passed (689 files checked, 0 errors, 0 warnings).
  - `bun run lint` (`biome lint packages`): passed (689 files checked, 0 warnings).
  - `bun run check:sql`: passed (410 backend TypeScript files validated).
  - `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit` & `bun run --cwd packages/frontend check:types`: passed (0 errors).
  - `bun run build`: passed (common, backend + 4 script bundles, frontend Vite build, shopify-confirmation).
  - `bun test packages/backend/tests/architecture-boundaries.test.ts`: 6 pass, 0 fail (9 expect() calls).
  - `bun test` (20 S11 domain, migrated repository, and service test files with `POSTGRES_INTEGRATION_URL` set): 196 pass, 0 fail (844 expect() calls).
  - `bun test` (25 S07, S08, Shopify, checkout, commerce, and billing test files with `POSTGRES_INTEGRATION_URL` set): 361 pass, 0 fail (1564 expect() calls).

- Findings status: none

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: high
- Justification: All S11 goals, bounded-context DAG constraints, file/class/function size ceilings, SQL parameterization, tenant isolation, S07/S08 invariants, domain event emissions, and Postgres 17 integration checks pass with zero out-of-scope edits and zero findings.
