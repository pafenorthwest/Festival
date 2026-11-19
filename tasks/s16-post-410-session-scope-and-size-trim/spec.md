# S16 — Post-`#413` Session Scope, Route Provider Cleanup & Pre-Cutover Verification

## Goal reference
- Locked goals: `goals/s16-post-410-session-scope-and-size-trim/goals.v0.md`
- Goal establishment record: `goals/s16-post-410-session-scope-and-size-trim/establish-goals.v0.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md` (`customer-identity`, `class-checkout`, §2.4 & §6.2 boundaries)

## Scope

### In scope
- `packages/frontend/src/domains/customer/CustomerIdentityContext.tsx` and frontend customer session tests (`packages/frontend/tests/customer-registration-session.test.ts`, `packages/frontend/tests/customer-account.test.ts`, or dedicated context tests) — update both `createEffect` and `isCurrentRequest()` to track `activeOrgSlug`, preserve `#413`'s `refreshOnReturn` focus/pageshow check without flashing `customerSession` to `unauthenticated` on same-org return, and add delayed-response intra-org navigation test coverage (`#385` + `#393`).
- `packages/frontend/src/app/AppRoutes.tsx` — remove unused `<ClassRegistrationProvider>` wrapper around membership `CustomerCheckoutRecoveryPage` (`/org/:slug/checkout-recovery/:token`).
- `CHANGELOG.md` — update `## [0.4.0]` with `#412`, `#413`, `S15`, and `S16` release notes ahead of `S14` `main` to `release` cutover.
- `tasks/s16-post-410-session-scope-and-size-trim/spec.md` and `tasks/s16-post-410-session-scope-and-size-trim/code-review.md`.

### Out of scope
- Any code modification prior to PR `#413` merging to `main` and `S16` transitioning from `State: blocked` to `State: locked`.
- Forced pre-release file splits on grandfathered non-domain files under the `2,000`-line baseline (`packages/frontend/src/lib/api/registration.ts`, `packages/backend/src/routes/customer/customer-class-checkout.routes.ts`, `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`, `packages/backend/src/checkout/in-memory-class-checkout-execution-helpers.ts`).
- `S15`-owned backend, CI, and ratchet files (`refresh-concurrency-limiter.ts`, `customer-session-repository.ts`, `customer-token-refresh.ts`, `tenant-organization-service.ts`, `.github/workflows/*.yml`, `file-size-ratchet.test.ts`, `file-size-ratchet-baseline.ts`).
- `S14` release execution (`main` to `release` merge, `v0.4.0` tag push, and `.github/workflows/deploy.yml` rollout) and live partial-payment acceptance testing tracked under Issue `#410`.
- Functional behavior changes to `#410` checkout restoration beyond `CustomerIdentityContext.tsx` active-org session scoping.

## Approach
1. **Preflight Unblock Gate**:
   - Confirm PR `#413` (and `S15` / PR `#412` as applicable) have merged onto `origin/main`; Issue `#410` itself stays open for live partial-payment acceptance.
   - Clear `## Blocking ambiguity` and update `- State: blocked` to `- State: locked` in `goals/s16-post-410-session-scope-and-size-trim/establish-goals.v0.md` and `goals/s16-post-410-session-scope-and-size-trim/goals.v0.md`; verify exit `0` via `validate-packet.ps1`.
2. **Active-Org Session Scope & Freshness Guard (`#385` + `#393` + `#413`)**:
   - In `packages/frontend/src/domains/customer/CustomerIdentityContext.tsx`, introduce an `activeOrgSlug` `createMemo` (`const r = shell.route(); return isOrganizationPageRoute(r) && "slug" in r ? r.slug : null;`).
   - Update **both** the `createEffect` trigger (`on(activeOrgSlug, ...)`) and the `isCurrentRequest()` freshness guard inside `refreshCustomerSession()` (`!disposed && request === latestRequest && activeOrgSlug() === targetSlug`) so in-flight responses are not dropped during same-org route changes.
   - Preserve PR `#413`'s `refreshOnReturn` focus/pageshow check without flashing `customerSession` to `unauthenticated` on same-org return, eliminating `#413`'s per-click live Shopify Storefront/Admin GraphQL calls while still resetting cleanly on org switches, leaving org routes, and explicit sign-out.
   - Add frontend tests including a delayed-response intra-org navigation test verifying that an in-flight session refresh completes after navigating between routes in the same organization without flashing `unauthenticated` or issuing duplicate roundtrips.
3. **Clean Up `AppRoutes.tsx` Provider Wrapping & Sync `CHANGELOG.md`**:
   - Remove the unused `<ClassRegistrationProvider>` wrapper around `<Pages.CustomerCheckoutRecoveryPage app={useFestivalShell()} />` on `/org/:slug/checkout-recovery/:token` in `packages/frontend/src/app/AppRoutes.tsx`.
   - Update `CHANGELOG.md` `## [0.4.0]` with concise entries covering `#412`, `#413`, `S15`, and `S16` ahead of `S14` `main` to `release` promotion.
4. **Full Pre-Cutover Verification**:
   - Run the complete toolchain, lint, format, build, frontend/backend `tsc`, `check:sql`, `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, and PostgreSQL 17 integration suites under the `500`L-new / `2,000`L-existing policy without forcing splits on grandfathered files.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s16-post-410-session-scope-and-size-trim
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run check:sql
bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts
bun run test
```
Plus PostgreSQL 17 integration verification (`POSTGRES_INTEGRATION_URL` / `DATABASE_URL`) passing with `0` errors and `0` warnings.

## Delivery
- **Active-Org Session Scope & Freshness Guard (`#385`, `#393`, `#413`)**: Scoped `CustomerIdentityContext` (`packages/frontend/src/domains/customer/CustomerIdentityContext.tsx`) session refresh `createEffect` and `isCurrentRequest()` freshness guard to an `activeOrgSlug` `createMemo` while preserving `#413` `refreshOnReturn` (`pageshow`, `focus`, `visibilitychange`) without flashing `customerSession` to `unauthenticated` on same-org return or triggering per-click Shopify GraphQL calls.
- **Deterministic Session-Scope Test Coverage**: Added `packages/frontend/tests/customer-identity-session-scope.test.ts` and updated `packages/frontend/tests/customer-registration-session.test.ts` covering delayed-response intra-org navigation, post-auth intra-org navigation, mid-refresh `refreshOnReturn` intra-org navigation, org switching, non-customer routes, sign-out, and stale response dropping.
- **Route Provider Cleanup**: Removed unused `<ClassRegistrationProvider>` wrapper around `<Pages.CustomerCheckoutRecoveryPage app={useFestivalShell()} />` on `/org/:slug/checkout-recovery/:token` in `packages/frontend/src/app/AppRoutes.tsx`.
- **`CHANGELOG.md` Pre-Cutover Sync**: Updated `CHANGELOG.md` `## [0.4.0]` with `#412`, `#413`, `S15` (`#414`), and `S16` release notes ahead of `S14` `main` to `release` cutover, with zero forced splits of grandfathered files (`<= 2,000`L baseline).

## Quality gate results
- `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s16-post-410-session-scope-and-size-trim -RequireCodeReview`: PASS (exit `0`)
- `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`, `bun run check:sql`: PASS (all exit `0`, `0` errors, `0` warnings)
- `bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts`: PASS (`11 pass`, `0 fail`, exit `0`, `0` errors, `0` warnings)
- `bun run test`: PASS (`common` `365 pass`, `backend` `1,731 pass` / `153` Postgres-gated `skip` / `0 fail`, `frontend` `560 pass`, `shopify-confirmation` `20 pass`; full PostgreSQL 17 integration matrix verified in GitHub Actions `Pull Request Checks / verify`)
