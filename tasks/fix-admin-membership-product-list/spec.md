# Fix Admin Membership Product Listing

## Overview

Correct the Admin memberships page's guaranteed 403 by adding and consuming an authenticated Admin-only list endpoint.

## Goals

1. Protect membership-product listing with Firebase authentication, tenant resolution, and Admin authorization.
2. Use the existing tenant-scoped listing service and shared response shape.
3. Update the Admin frontend request to send an ID token to the protected route.
4. Preserve the forbidden public endpoint; separate verified/setup presentation from capability-gated creation.
5. Cover authorization, successful listing, and frontend endpoint/token wiring.
6. Pass canonical verification.

## Non-goals

- Public membership-product browsing.
- Changes to Shopify credential verification, creation semantics, persistence/schema, or unrelated frontend behavior.

## Use cases / user stories

- As an organization Admin with a verified Shopify integration, I can open Admin Memberships and see the organization's associated products without false setup or availability messaging.
- As a non-Admin or unauthenticated caller, I cannot list tenant membership products.

## Current behavior
- Notes: the Admin page currently calls a public endpoint that always returns 403.
- Key files:
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/tests/organization-routes.test.ts`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/app/createFestivalDataLoaders.ts`
  - `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`
  - `packages/frontend/tests/onboarding-integration.test.ts`

## Proposed behavior
- Behavior changes: authenticated Admin listing succeeds; the Admin frontend calls it with a Firebase ID token.
- Edge cases: missing service yields the existing explicit 503; unauthenticated/non-Admin requests are rejected; public route remains 403; genuine Shopify load failures remain visible.

## Technical design
### Architecture / modules impacted
- Backend route/security declarations, frontend API/loader, and focused tests.

### API changes (if any)

- Add `GET /api/organizations/:slug/admin/membership-products` with Admin authentication.
- Keep `GET /api/organizations/:slug/membership-products` forbidden.

### UI/UX changes (if any)

- The false availability error disappears when the corrected request succeeds.
- Verification status `ok` shows `Ready` and hides setup guidance independently from capabilities; required capabilities still disable protected creation when unavailable.

### Data model / schema changes (PostgreSQL)
- Migrations: none.
- Backward compatibility: public endpoint behavior is unchanged; POST endpoint is unchanged.
- Rollback: remove the GET handler/declaration and restore the frontend request path/signature.

## Security & privacy

- Reuse the standard Firebase auth, tenant, and Admin-role middleware chain before invoking Shopify or repository work.

## Observability (logs/metrics)

- Preserve existing HTTP error handling; no new logging or metrics required.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: existing service tests remain authoritative for Shopify mapping.
- Integration: backend route tests cover authentication, authorization, success, and public denial.
- E2E / UI (if applicable): frontend source-contract test covers protected endpoint and token wiring plus readiness UI.

## Acceptance criteria checklist
- [x] Authorized Admin GET returns membership products.
- [x] Unauthenticated/non-Admin GET requests fail before Shopify access.
- [x] Public GET remains forbidden.
- [x] Admin frontend sends a Firebase ID token to the Admin GET endpoint.
- [x] Verification status `ok` shows `Ready` without prerequisite guidance independently from capabilities.
- [x] Protected creation remains disabled unless required capabilities are granted.
- [x] Canonical lint, build, and tests pass.

## IN SCOPE
- The seven source/test files listed under Current behavior plus this task's lifecycle artifacts.

## OUT OF SCOPE
- Database/schema, Shopify client and credential behavior, product creation, public listing, and unrelated dirty-worktree changes.

## Goal lock assertion

- Relocked by `goals/fix-admin-membership-product-list/goals.v1.md` to include the initially requested verified/setup presentation while preserving independent capability enforcement.

## Dirty worktree decision

- Continue surgically. Preserve all unrelated issue #75 and #81 changes already present in the worktree.

## Stage 2 verdict

- READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L3 (multi-surface)
- Complexity scoring details: score=10; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/pafenorthwest/Festival/tasks/fix-admin-membership-product-list/complexity-signals.json
- Active phases: 1..4
- No new scope introduced: required
