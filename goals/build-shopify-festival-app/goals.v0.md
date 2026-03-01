# Goals Extract
- Task name: build-shopify-festival-app
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Create concise Shopify reference markdown documents under `reference/shopify/` covering APIs needed for this app.
2. Include explicit source citations to Shopify developer API docs using `https://shopify.dev/docs/api` URLs.
3. Scaffold a TypeScript Bun monorepo layout with `packages/common`, `packages/backend`, and `packages/frontend`.
4. Implement Express backend routes/services to create and manage guardian/parent payer records linked to Shopify customer identities.
5. Implement backend flows to create digital class passes representing festival entrance and associate them with student-specific metadata managed outside Shopify.
6. Implement backend payment flow orchestration integrating Shopify order/checkout primitives with Stripe payment intents.
7. Implement backend drop/refund flow orchestration across Shopify and Stripe with explicit status handling.
8. Implement cart rule enforcement in custom app logic:
   - Concert class requires Solo class in selection.
   - Ensemble class requires multiple participants.
9. Implement eligibility filtering logic in custom app layer so ineligible classes cannot be selected for cart submission.
10. Provide SolidJS browser frontend (HTML + TS compiled to JS) for selecting classes/participants, enforcing visible constraints, and initiating checkout calls.
11. Provide runnable repository verification commands for lint/build/test with meaningful coverage for core business rules.


## Non-goals (explicit exclusions)

- Building discount rules or promotional pricing logic.
- Implementing full production infrastructure/deployment, Shopify Admin UI extensions, or complete billing operations beyond requested flows.


## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] `reference/shopify/` contains concise markdown docs for auth, customers, products/variants/passes, carts/checkouts/orders, webhooks, and refunds.
- [G2] Each Shopify doc contains direct `https://shopify.dev/docs/api/...` references.
- [G3] Monorepo structure exists under `packages/common`, `packages/backend`, and `packages/frontend` with TypeScript configs and scripts.
- [G4] Backend exposes payer profile endpoints and maps app records to Shopify customer IDs.
- [G5] Backend exposes digital class pass endpoints with external metadata storage linkage.
- [G6] Backend exposes payment-intent + checkout coordination endpoint(s) with Shopify/Stripe service wiring.
- [G7] Backend exposes class drop/refund endpoint(s) with Shopify/Stripe refund orchestration path.
- [G8] Automated tests assert Concert->Solo dependency and Ensemble participant minimum checks.
- [G9] Automated tests assert eligibility filtering behavior.
- [G10] Frontend builds and can execute core flow screens/components in browser environment.
- [G11] Root `lint`, `build`, and `test` commands pass.

