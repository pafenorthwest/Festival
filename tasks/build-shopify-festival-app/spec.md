# Build Shopify Festival App

## Overview
Create Shopify reference docs and a Bun/TypeScript monorepo app with Express backend + SolidJS frontend to support festival class registration, digital passes, parent/guardian payment records, eligibility filtering, and Shopify/Stripe payment-refund orchestration.

## Goals
1. Add concise `reference/shopify/*.md` docs with `https://shopify.dev/docs/api/...` citations.
2. Build monorepo structure with `packages/common`, `packages/backend`, and `packages/frontend`.
3. Implement payer profile records for guardians/parents linked to Shopify customers.
4. Implement digital class pass creation with student metadata managed outside Shopify.
5. Implement payment and refund/drop orchestration via Shopify + Stripe service boundaries.
6. Implement custom cart and eligibility logic outside Shopify:
   - Concert requires Solo.
   - Ensembles require multiple participants.
7. Provide a browser frontend in HTML + TypeScript + SolidJS.
8. Provide passing root verification commands for lint/build/test.

## Non-goals
- Discount rule implementation.
- Full production deployment, infra, and operations hardening.
- Replacing Shopify-native eligibility behavior (eligibility remains app-local).

## Use cases / user stories
- As a guardian/parent, I can register students for classes and complete payment.
- As a registrar, I can enforce class dependency and participant-count rules before checkout.
- As operations staff, I can process class drops/refunds consistently in Shopify and Stripe.
- As developers, we have concise Shopify docs for app APIs and integration points.

## Current behavior
- Notes: repository currently contains Solid reference docs only and no runnable backend/frontend app surfaces.
- Key files:
  - `package.json`
  - `project-structure.md`
  - `reference/solidjs/*`

## Proposed behavior
- Behavior changes:
  - add Shopify reference docs under `reference/shopify/`;
  - create TypeScript monorepo packages for common/backend/frontend;
  - add Express API routes for eligibility, pass creation, checkout, and refunds;
  - add SolidJS frontend for class selection and checkout initiation.
- Edge cases:
  - cart violation when Concert selected without Solo;
  - ensemble participant count below minimum;
  - ineligible classes blocked from cart submission;
  - partial failure between Shopify and Stripe payment/refund operations.

## Technical design
### Architecture / modules impacted
- `reference/shopify/*.md`
- `packages/common/*`
- `packages/backend/*`
- `packages/frontend/*`
- Root workspace/tooling files (`package.json`, TypeScript configs)

### API changes (if any)
- New backend HTTP endpoints under `/api/*` for:
  - payer profiles
  - eligibility/cart validation
  - pass creation
  - checkout intent creation
  - drop/refund processing

### UI/UX changes (if any)
- New SolidJS browser SPA for class/payer/student flow.

### Data model / schema changes (PostgreSQL)
- Migrations: none in this iteration (in-memory repository with typed interfaces).
- Backward compatibility: not applicable (new app surfaces).
- Rollback: remove added package surfaces and docs.

## Security & privacy
- No secrets committed to repository.
- Shopify and Stripe credentials resolved from environment variables.
- Student metadata and payment identifiers handled through explicit DTO boundaries.

## Observability (logs/metrics)
- Structured request/service logging in backend with operation IDs and external call statuses.

## Governing context
- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
  - `land-the-plan`
- Sandbox constraints:
  - workspace-write filesystem
  - network-restricted shell

## Goal lock assertion
Locked goals source: `goals/build-shopify-festival-app/goals.v0.md` (state: `locked`).
No reinterpretation/expansion permitted without relock.

## Ambiguity check
No blocking ambiguity remains for Stage 2.
Non-blocking assumptions are captured in `goals/build-shopify-festival-app/establish-goals.v0.md`.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `project-structure.md` and `codex-config.yaml` if canonical command records change).

- Lint:
  - `bun run lint`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit:
  - cart rule evaluator
  - eligibility filter
  - checkout/refund service coordination behavior with mocked adapters
- Integration:
  - Express route tests for main API flows
- E2E / UI (if applicable):
  - frontend component tests for class selection constraints and checkout trigger payloads

## Acceptance criteria checklist
- [ ] Shopify reference docs exist and cite Shopify API pages.
- [ ] Backend supports payer profile creation and linkage.
- [ ] Backend supports digital class pass creation with external metadata link.
- [ ] Backend supports checkout orchestration to Shopify + Stripe abstractions.
- [ ] Backend supports drop/refund orchestration to Shopify + Stripe abstractions.
- [ ] Cart dependency/ensemble rules are enforced and tested.
- [ ] Eligibility filter is enforced and tested.
- [ ] SolidJS frontend builds and uses backend APIs for core flow.
- [ ] Root lint/build/test pass.

## IN SCOPE
- New docs under `reference/shopify/`.
- New code surfaces under `packages/common`, `packages/backend`, `packages/frontend`.
- Root tooling updates required to run lint/build/test for new surfaces.

## OUT OF SCOPE
- Discount system.
- Production deployment/infrastructure.
- Persistent production-grade database/webhook infrastructure.

## Execution posture lock
- Simplicity bias locked.
- Surgical changes only, limited to task surfaces.
- Fail-fast behavior required for uncertain or blocked states.

## Change control
- Goal/constraint/success-criteria changes require relock through `establish-goals`.
- Verification contract (`lint`, `build`, `test`) cannot be weakened or bypassed.

## Stage 2 verdict
READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L2 (focused)
- Complexity scoring details: score=8; recommended-goals=4; guardrails-all-true=false; signals=/Users/eric/pafenorthwest/Festival/tasks/build-shopify-festival-app/complexity-signals.json
- Active phases: 1..3
- No new scope introduced: required
