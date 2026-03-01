# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): build-shopify-festival-app

## Request restatement

- Create concise Shopify API reference docs under `reference/shopify/` with citations to `https://shopify.dev/docs/api`.
- Build a TypeScript monorepo app with:
  - Express backend that integrates Shopify + Stripe for guardian/parent payment records, class pass creation, drops/refunds, and cart-rule enforcement.
  - Browser frontend using HTML + TypeScript + SolidJS for class selection, participant capture, and checkout initiation.
- Keep class eligibility logic in custom app logic (outside Shopify).
- Support special cart constraints:
  - Concert class requires Solo class registration.
  - Ensemble classes require multiple participants.
  - No discount-rule implementation.

## Context considered

- Repo/rules/skills consulted:
  - `AGENTS.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `/Users/eric/.codex/skills/prepare-takeoff/SKILL.md`
  - `/Users/eric/.codex/skills/prepare-phased-impl/SKILL.md`
  - `/Users/eric/.codex/skills/implement/SKILL.md`
- Relevant files (if any):
  - `project-structure.md`
  - `package.json`
  - `reference/solidjs/*`
- Constraints (sandbox, commands, policy):
  - Workspace-write sandbox; network-restricted shell.
  - Lifecycle gate order must be respected.
  - Verification classes required: `lint`, `build`, `test`.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. Shopify commerce primitives will be modeled as products/variants + checkout/order flows, while custom business metadata is persisted in app-side storage.
2. "Create records for guardians and parents" means creating and maintaining app-side payer profiles linked to Shopify customer records.
3. Stripe integration is orchestrated by the app and tied to Shopify order/payment state via metadata, webhooks, and refund coordination.
4. A lightweight development persistence layer is acceptable for this iteration (in-memory/file) while keeping service boundaries ready for PostgreSQL.

## Questions for user

1. None required for lock at this stage.

## Assumptions (explicit; remove when confirmed)

1. Backend will target Node.js with Express + TypeScript and include explicit service abstractions for Shopify/Stripe calls.
2. Frontend will use Vite + SolidJS + TypeScript in browser mode.
3. Docs under `reference/shopify/` will be concise engineering references rather than exhaustive API copies.
4. Discount logic will be explicitly omitted from implementation and docs except as a non-goal note.

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

## Risks / tradeoffs

- Real Shopify/Stripe API keys are not available in this environment, so integrations will be implemented as typed service clients with mock-friendly boundaries and deterministic tests.
- Production-grade persistence and webhook idempotency are simplified to keep changes surgical while preserving extension points.

## Next action

- Goals locked. Handoff to `prepare-takeoff` for task scaffolding/spec readiness.
