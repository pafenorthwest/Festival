# Establish Goals
- Task name: s17-issue-417-account-membership-acquisition-buttons
- Iteration: v0
- State: locked

## Status
Locked for Wave 4C execution (`#417`) under resolved decision `D5` (`2026-11-16`). Upstream dependency `S16` (`#415`, `13ebbd0`) is `DONE` on `origin/main`. Must merge before `S18` (`#416`) begins due to shared ownership of `CustomerAccountMembershipsPage.tsx` and customer account membership tests.

## Request
On `/org/:slug/account/memberships`, add a direct-child `<h1>Acquire Memberships</h1>` heading and a side-by-side horizontal row of two default primary `<Button type="button">` controls (`Annual Teacher` on the left routing to `/org/:slug/membership`, `Annual Accompanist` on the right routing to `/org/:slug/accompanist-membership`) above the existing `<h1>Memberships</h1>` heading, evaluating ownership independently per membership class across all `CustomerMembershipStatusEntry["status"]` states with disabled greyed-out styling (`#9ca3af`), mouse/keyboard inertness when disabled, and automatic state refresh upon returning after acquisition (`#417`).

## Blocking ambiguity
None.

## Assumptions
- `S16` (`s16-post-410-session-scope-and-size-trim`, `#415`) is merged on `origin/main`.
- `CustomerAccountPageLayout.tsx` renders `<section class="customer-account-page parent-account-page">` directly around `CustomerAccountMembershipsPage` children, so rendering `<h1>Acquire Memberships</h1>` as a top-level fragment child above `<h1>Memberships</h1>` preserves the `#app > main > div > div > section > h1` selector chain without wrapper `<div>` or `<section>` nesting.
- Default primary `<Button type="button">` (omitting `variant="secondary"`) inherits `button:disabled` (`background: #9ca3af; cursor: not-allowed;`) in `packages/frontend/src/styles.css`, avoiding the `button.secondary-button` rule (`background: transparent`) that overrides `button:disabled` specificity.
- Paid Accompanist Shopify checkout (`#133`) is deferred to summer per `D5`; `Annual Accompanist` routes to the supported `/org/:slug/accompanist-membership` (`$0` unpaid form) acquisition flow.

## Goals
1. Render `<h1>Acquire Memberships</h1>` (exact text) followed by a horizontal side-by-side action row (`Annual Teacher` on the left, `Annual Accompanist` on the right) above the existing `<h1>Memberships</h1>` heading as direct children of `<section class="customer-account-page parent-account-page">` in `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx`, preserving `#app > main > div > div > section > h1` and using default primary `<Button type="button">` controls so `:disabled` renders greyed out (`#9ca3af`) without `button.secondary-button` background overrides (`#417`).
2. Implement pure, independent per-class ownership evaluation in `packages/frontend/src/pages/customerMembershipStatus.ts` for `"teacher_membership"` and `"accompanist_membership"` across every `CustomerMembershipStatusEntry["status"]` value: disable when `"active"`, `"scheduled"`, `"processing"`, or `"needs_review"` (plus fail-closed while `store.loading()`, `Boolean(store.error())`, or `store.checkoutProcessing()` for Teacher return), and enable when no blocking status is held—including when only `"expired"`, `"revoked"`, `"superseded"`, or `"rejected"` entries exist (`#417`).
3. Wire enabled `Annual Teacher` and `Annual Accompanist` buttons to navigate to `buildOrgMembershipPath(slug)` (`/org/:slug/membership`) and `buildOrgAccompanistMembershipPath(slug)` (`/org/:slug/accompanist-membership`), enforce mouse and keyboard inertness (`disabled` attribute + click guard) when disabled, and refresh button disabled/enabled state when returning to `/org/:slug/account/memberships` after acquisition (`#417`).
4. Add deterministic unit and DOM/component tests in `packages/frontend/tests/customer-membership-status.test.ts` and `packages/frontend/tests/customer-account.test.ts` covering all 4 ownership combinations (neither, Teacher-only, Accompanist-only, both), all `CustomerMembershipStatus` lifecycle/decision values, loading/error fail-closed states, heading/button DOM order (`#app > main > div > div > section > h1` / direct `<section>` child), disabled mouse/keyboard inertness, navigation targets, and post-acquisition return refresh, passing full workspace verification with `0` errors and `0` warnings (`<= 500` lines/file).

## Non-goals
- Implementing paid Accompanist Shopify checkout (`#133`, deferred to summer per `D5`).
- Modifying Accompanist registration form consent or Public Directory moderation (`#416`, owned by sequential downstream packet `S18`).
- Modifying backend routes, `@festival/common` schemas, or `database/` migrations.
- Wrapping `<h1>Acquire Memberships</h1>` or `<h1>Memberships</h1>` inside an extra `<section>` or `<div>` that breaks `#app > main > div > div > section > h1`.

## Success criteria
- [G1] `CustomerAccountMembershipsPage.tsx` renders `<h1>Acquire Memberships</h1>` above `<h1>Memberships</h1>` as direct children of `<section class="customer-account-page parent-account-page">` (preserving `#app > main > div > div > section > h1`) with a horizontal side-by-side row ordering `Annual Teacher` left and `Annual Accompanist` right using default primary `<Button type="button">` styling (`button:disabled` `#9ca3af`).
- [G2] Pure helper logic in `customerMembershipStatus.ts` evaluates `"teacher_membership"` and `"accompanist_membership"` independently across all `CustomerMembershipStatusEntry["status"]` values (`"active"`, `"scheduled"`, `"processing"`, `"needs_review"` + `store.loading()` / `store.error()` / Teacher `store.checkoutProcessing()` => disabled; `"expired"`, `"revoked"`, `"superseded"`, `"rejected"` or absent => enabled) across all 4 ownership combinations.
- [G3] Enabled buttons navigate to `/org/:slug/membership` and `/org/:slug/accompanist-membership` respectively, disabled buttons remain visible and cannot trigger navigation via mouse click or keyboard interaction, and returning to `/org/:slug/account/memberships` after acquisition reflects newly held memberships in button states.
- [G4] `customer-membership-status.test.ts` and `customer-account.test.ts` verify all 4 ownership combinations, all status states, DOM structure/order, disabled inertness, navigation, and post-acquisition refresh; all modified files stay `<= 500` lines; and full verification (`validate-packet.ps1 -RequireCodeReview`, `verify:toolchain`, `format:check`, `lint`, `build`, frontend/backend `tsc --noEmit`, `check:sql`, `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, and `bun run test`) passes with `0` errors and `0` warnings.

## Next action
Execute `tasks/s17-issue-417-account-membership-acquisition-buttons/spec.md` on an isolated branch (`feat/s17-issue-417-account-membership-acquisition-buttons`) off `origin/main` before starting `S18`.
