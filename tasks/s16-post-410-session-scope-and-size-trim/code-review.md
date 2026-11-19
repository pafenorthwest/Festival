# Code Review

- Task name: s16-post-410-session-scope-and-size-trim
- Reviewer: Independent Code Review Auditor Subagent
- Date: 2026-11-16
- Branch: `fix/s16-post-410-session-scope-and-size-trim`
- Findings status: none

## Context

Performed an independent code review audit of packet `S16` (`s16-post-410-session-scope-and-size-trim`) on branch `fix/s16-post-410-session-scope-and-size-trim` against `origin/main` (`e55b67eee91e33b1c6b9730ac28879551ac735f0`, containing merged PRs `#412` `84df859`, `#413` `2d90c74`, and `#414` `S15`), the locked packet goals (`goals/s16-post-410-session-scope-and-size-trim/goals.v0.md`, `goals/s16-post-410-session-scope-and-size-trim/establish-goals.v0.md`), packet specifications (`tasks/s16-post-410-session-scope-and-size-trim/spec.md`, `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md`), bounded-context rules (`specs/bounded-contexts-2026.md` §3, §4.3, §6), and the program ledger (`specs/pre-thanksgiving-program.md`).

## Scope & Files Reviewed

Inspected `git status --untracked-files=all --short`, the complete `git diff origin/main`, and every modified or newly added file in full:

- `packages/frontend/src/domains/customer/CustomerIdentityContext.tsx` (`178` lines, modified)
- `packages/frontend/src/app/AppRoutes.tsx` (`250` lines, modified)
- `packages/frontend/tests/customer-registration-session.test.ts` (`370` lines, modified)
- `packages/frontend/tests/customer-identity-session-scope.test.ts` (`228` lines, new)
- `CHANGELOG.md` (`81` lines, modified)
- `goals/s16-post-410-session-scope-and-size-trim/goals.v0.md` (`20` lines, modified)
- `goals/s16-post-410-session-scope-and-size-trim/establish-goals.v0.md` (`37` lines, modified)
- `tasks/s16-post-410-session-scope-and-size-trim/spec.md` (`64` lines, modified)
- `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md` (`86` lines, modified)
- `specs/pre-thanksgiving-program.md` (`250` lines, modified)

Verified strict scope isolation: zero modifications to grandfathered non-domain files (`registration.ts`, `customer-class-checkout.routes.ts`, `CustomerAccountOrdersPage.tsx`, `in-memory-class-checkout-execution-helpers.ts`), zero modifications to `S15`-owned backend/CI/ratchet files, and zero modifications to `#410` backend checkout restoration logic or `S14` release-cutover files.

## Audit Summary

1. **`[G1]` Active-Org Session Scope & Race-Condition Analysis (`CustomerIdentityContext.tsx`)**:
   - `activeOrgSlug` is derived via SolidJS `createMemo` (`const r = shell.route(); return isOrganizationPageRoute(r) && "slug" in r ? r.slug : null;`), which uses `===` memoization so intra-org route transitions across the 17 customer-facing `isOrganizationPageRoute` kinds do not notify downstream observers.
   - Both `createEffect(on(activeOrgSlug, ...))` and `isCurrentRequest()` (`!disposed && request === latestRequest && activeOrgSlug() === targetSlug`) consume `activeOrgSlug()`, preventing intra-org route changes from resetting `customerSession` to `unauthenticated`, dropping in-flight session responses, leaving `isCustomerSessionLoading` stuck `true`, or triggering per-click `/session` and `pendingCheckout.refresh()` live Shopify Storefront/Admin GraphQL roundtrips.
   - Audited race conditions across rapid org switches (`org-a` -> `org-b` -> `org-a`, guarded by monotonic `request === latestRequest` plus `activeOrgSlug() === targetSlug`), leaving customer org routes for `home` or `org-admin-*` (`targetSlug === null` increments `latestRequest` and synchronously clears `customerSession`, `pendingCheckout`, and `isCustomerSessionLoading`), `slugOverride` mismatches (`slugOverride !== targetSlug` exits before incrementing `latestRequest`, leaving active org loads undisturbed), `refreshOnReturn` (`pageshow`/`focus`/`visibilitychange` coalesced via `returnRefresh` without resetting `customerSession` to `unauthenticated` prior to `fetchSession`), confirmed sign-out (`parentRegistration.clear` + `pendingCheckout.clearOrganization`), and session replacement (`csrfToken` rotation clearing prior-account drafts and handoffs inside `batch` before publishing the new session).
   - Deterministic unit suites in `customer-identity-session-scope.test.ts` and `customer-registration-session.test.ts` cover all transitions cleanly and restore `globalThis.window` and SolidJS roots in `finally` blocks.
2. **`[G2]` Route Provider Cleanup & `CHANGELOG.md` Pre-Cutover Sync (`AppRoutes.tsx`, `CHANGELOG.md`)**:
   - `AppRoutes.tsx` renders `<Pages.CustomerCheckoutRecoveryPage app={useFestivalShell()} />` directly on `/checkout-recovery/:token` (under `/org/:slug` and `/organizations/:slug`) with the unused `<ClassRegistrationProvider>` wrapper and dead `useParams()` call removed, while keeping `RegistrationLayout` (`<ClassRegistrationProvider>`) intact on `/festival/:festivalSlug/register` (`/`, `/class/:classId`, `/cart`).
   - `CHANGELOG.md` `## [0.4.0]` accurately records PR `#412` (`#336` portal-anchored admin class and waitlist modals), PR `#413` (`#410` cross-session pending Shopify checkout discovery/verification/resume, cart badge routing, and sign-in readiness decoupling), `S15` / PR `#414` (`#407` `RefreshConcurrencyLimiter` and per-session coalescing, `#383` `publicOrganizationListCache` invalidation, CI parity, and `#216` `500`/`2,000`-line file-size ratchet), and `S16` (`#385`/`#393`/`#413` `activeOrgSlug` scoping and `AppRoutes` cleanup).
3. **`[G3]`, `S15` Handoff Reconciliation & Structural/Security Checks**:
   - `specs/pre-thanksgiving-program.md`, `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md`, and `tasks/s16-post-410-session-scope-and-size-trim/spec.md` accurately reflect merged PR `#414` (`e55b67eee91e33b1c6b9730ac28879551ac735f0`, implementation commit `fdfa469`) and `S16` delivery.
   - All touched and newly added files are `<= 500` lines (`max 370` lines in `customer-registration-session.test.ts`, `228` lines in new `customer-identity-session-scope.test.ts`), all newly added/updated functions and test blocks are `<= 60` lines (`refreshCustomerSession` `50`L, `mountScopeIdentity` `45`L, new `it` blocks `23`–`46`L; pre-existing outer factory `createCustomerIdentityState` shrunk `121`L -> `120`L and `publicOrgRoutes` shrunk `82`L -> `74`L), all files use LF line endings (`crlf=false`), and zero `console.*`, `debugger`, or credentials/secrets are present.
   - Independent verification executed in `pwsh`: `bun run format:check` (`839` files, `0` issues), `bun run lint` (`839` files, `0` issues), `bun run --cwd packages/frontend check:types` (`0` errors), `bun --cwd packages/frontend test tests/customer-registration-session.test.ts tests/customer-identity-session-scope.test.ts` (`11 pass`, `0 fail`, `92 expect()` calls), and `bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts` (`11 pass`, `0 fail`, `51 expect()` calls).

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: All `[G1]`, `[G2]`, and `[G3]` criteria, bounded-context rules, file-size ratchet constraints, and `S15`/`S16` ledger handoff reconciliations are satisfied with zero functional, race-condition, structural, or security defects.
