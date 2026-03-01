# Phase 2 — Backend APIs and Domain Rules

## Objective
Implement Express backend endpoints/services for payer records, pass creation, payment/refund orchestration, and enforce cart/eligibility business rules.

## Code areas impacted
- `packages/backend/src/*`
- `packages/common/src/*`
- `packages/backend/tests/*`

## Work items
- [x] Implement domain models and repositories for guardians/parents, classes, passes, and registrations.
- [x] Implement cart rules and eligibility service in custom app logic.
- [x] Implement Shopify/Stripe adapter interfaces and service-level orchestration for checkout + refund.
- [x] Add Express routes/controllers for payer, pass, checkout, and refund flows.
- [x] Add unit/integration tests for eligibility and cart constraints.

## Deliverables
- Backend API that can create payer records and class passes.
- Backend API that validates selection/cart rules and starts checkout/refund flows.
- Tests covering rule correctness and orchestration status behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Rule tests cover Concert->Solo and Ensemble participant minimum constraints.
- [x] Checkout/refund orchestration routes return deterministic status payloads.
- [x] Backend build and test pass.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test`
  - Expected: backend and common tests pass, including rule validation. PASS
- [x] Command: `bun run build`
  - Expected: backend compiles with strict TypeScript settings. PASS

## Risks and mitigations
- Risk:
  - External API operations can partially fail across Shopify and Stripe.
- Mitigation:
  - Use explicit fail-fast result envelopes and operation status fields for compensation handling.
