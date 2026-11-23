# S17 — Issue `#417`: Account Membership Acquisition Buttons (`Acquire Memberships`)

## Goal reference
- Locked goals: `goals/s17-issue-417-account-membership-acquisition-buttons/goals.v0.md`
- Goal establishment record: `goals/s17-issue-417-account-membership-acquisition-buttons/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 4C, depends on `S16`; sequential before `S18`)
- Bounded context architecture: `specs/bounded-contexts-2026.md` (`teacher-directory` customer account UI slice)

## Scope

### In scope
- `packages/frontend/src/pages/customerMembershipStatus.ts` — pure, exhaustive per-class ownership/blocking evaluation helper (`isBlockingMembershipStatus` / `resolveMembershipAcquisitionState`) across all `CustomerMembershipStatusEntry["status"]` values (`"active"`, `"scheduled"`, `"processing"`, `"needs_review"`, `"expired"`, `"revoked"`, `"superseded"`, `"rejected"`), plus loading/error/checkout-processing fail-closed flags.
- `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` (`<= 500` lines) — render `<h1>Acquire Memberships</h1>` and the horizontal side-by-side primary `<Button type="button">` row (`Annual Teacher` left -> `buildOrgMembershipPath(props.slug)`, `Annual Accompanist` right -> `buildOrgAccompanistMembershipPath(props.slug)`) above `<h1>Memberships</h1>` as direct children of `CustomerAccountPageLayout`'s `<section class="customer-account-page parent-account-page">`, plus `pageshow` (`event.persisted`) refresh on back/forward return.
- `packages/frontend/src/styles.css` — minimal scoped horizontal row rule (e.g., `.customer-membership-acquire-actions` with `display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem;`) preserving `button:disabled` (`#9ca3af`).
- `packages/frontend/tests/customer-membership-status.test.ts` and `packages/frontend/tests/customer-account.test.ts` — unit and rendered DOM/interaction tests covering all 4 ownership combinations, all status states, direct-child `section > h1` structure, disabled mouse/keyboard inertness, route navigation, and post-acquisition return refresh.
- Packet delivery and review artifacts: `tasks/s17-issue-417-account-membership-acquisition-buttons/spec.md`, `tasks/s17-issue-417-account-membership-acquisition-buttons/code-review.md`, and the `S17` status flip in `specs/pre-thanksgiving-program.md` at Step 4 handoff.

### Out of scope
- `packages/frontend/src/pages/AccompanistMembershipPage.tsx`, `packages/frontend/src/pages/CustomerTeacherDirectoryCard.tsx`, `packages/frontend/src/pages/AdminTeacherDirectoryPanel.tsx`, `packages/frontend/src/lib/api/**`, `packages/common/**`, and `packages/backend/**` (reserved for sequential packet `S18` `#416` after `S17` merges).
- Paid Accompanist Shopify checkout (`#133`, deferred to summer per `D5`).
- `database/**` (`0` migrations) and `packages/frontend/src/pages/CustomerAccountPageLayout.tsx`.
- Using `variant="secondary"` on the acquisition buttons (which adds `.secondary-button` and overrides `button:disabled` `#9ca3af` with `background: transparent`).

## Approach
1. **Preflight & Sequential Lock**:
   - Confirm `S16` (`13ebbd0`) is `DONE` on `origin/main` and run `validate-packet.ps1 -TaskName s17-issue-417-account-membership-acquisition-buttons` (exit `0`).
   - Branch `feat/s17-issue-417-account-membership-acquisition-buttons` from `origin/main`. Complete and merge `S17` before starting `S18` so `CustomerAccountMembershipsPage.tsx` has zero parallel conflict.
2. **Pure Ownership & Blocking State Evaluation (`customerMembershipStatus.ts`)**:
   - Add an exhaustive status classifier over `CustomerMembershipStatusEntry["status"]`:
     - **Disabled (`true`)**: `"active"`, `"scheduled"`, `"processing"`, `"needs_review"`.
     - **Enabled (`false`)**: `"expired"`, `"revoked"`, `"superseded"` (and validation `"rejected"`, which grants no membership rights).
   - Expose `resolveMembershipAcquisitionState(input: { memberships: readonly CustomerMembershipStatusEntry[]; loading: boolean; error: string; checkoutProcessing?: boolean })` returning `{ teacherDisabled: boolean; accompanistDisabled: boolean }` evaluated independently per `entitlementClass` (`"teacher_membership"` vs `"accompanist_membership"`):
     - If `loading || Boolean(error)`, both `teacherDisabled` and `accompanistDisabled` are `true` (fail-closed while status is unknown).
     - Otherwise `teacherDisabled` is `true` when `Boolean(checkoutProcessing)` or any `"teacher_membership"` entry has a blocking status; `accompanistDisabled` is `true` when any `"accompanist_membership"` entry has a blocking status.
3. **Account Memberships UI & Navigation (`CustomerAccountMembershipsPage.tsx` & `styles.css`)**:
   - Inside `CustomerAccountMembershipsPage`'s fragment child of `<CustomerAccountPageLayout>`, render above `<h1>Memberships</h1>`:
     - `<h1>Acquire Memberships</h1>` as a **direct child** of `<section class="customer-account-page parent-account-page">` (preserving `#app > main > div > div > section > h1`).
     - `<div class="customer-membership-acquire-actions">` containing two default primary `<Button type="button">` elements ordered left-to-right:
       1. `Annual Teacher` (`disabled={acquisition().teacherDisabled}`, `data-preload-path={buildOrgMembershipPath(props.slug)}`, navigating to `buildOrgMembershipPath(props.slug)` only when `!acquisition().teacherDisabled`).
       2. `Annual Accompanist` (`disabled={acquisition().accompanistDisabled}`, `data-preload-path={buildOrgAccompanistMembershipPath(props.slug)}`, navigating to `buildOrgAccompanistMembershipPath(props.slug)` only when `!acquisition().accompanistDisabled`).
   - Navigate via `window.location.assign(path)` with an optional `onNavigate?: (path: string) => void` prop override on `CustomerAccountMembershipsPage` (do **not** call bare `@solidjs/router` `useNavigate()`, because `packages/frontend/tests/browser/account-return.tsx` mounts `<CustomerAccountMembershipsPage slug="pafe" />` standalone outside `<Router>`), and register a `window` `"pageshow"` listener (cleaned up in `onCleanup`) calling `refreshMembershipStatus(store)` when `event.persisted` is `true` so back-button/bfcache returns as well as fresh route mounts immediately reflect newly acquired memberships.
   - Add `.customer-membership-acquire-actions` in `packages/frontend/src/styles.css` (`display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem;`).
4. **Red-Green Tests & Verification Gate**:
   - Write failing unit tests in `packages/frontend/tests/customer-membership-status.test.ts` covering every `CustomerMembershipStatus` state (`"active"`, `"scheduled"`, `"processing"`, `"needs_review"`, `"expired"`, `"revoked"`, `"superseded"`, `"rejected"`), loading/error/checkoutProcessing states, and all 4 ownership combinations (`neither`, `teacher only`, `accompanist only`, `both`).
   - Write failing component/DOM tests in `packages/frontend/tests/customer-account.test.ts` verifying:
     - `<h1>Acquire Memberships</h1>` appears above `<h1>Memberships</h1>` as a direct child of `section.customer-account-page` (`section > h1`).
     - `Annual Teacher` renders first (left) and `Annual Accompanist` renders second (right) as primary `button.button` elements without `.secondary-button`.
     - Disabled buttons have `disabled === true`, do not fire navigation on mouse `click()` or keyboard `Enter`/`Space` events, and remain visible in all 4 combinations.
     - Enabled buttons navigate to `/org/:slug/membership` and `/org/:slug/accompanist-membership`, and re-mounting / `pageshow` after acquisition updates the held button to `disabled`.
   - Pass all workspace verification gates (`<= 500`L/file, `0` warnings, `0` errors) and independent subagent code review (`tasks/s17-issue-417-account-membership-acquisition-buttons/code-review.md`).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s17-issue-417-account-membership-acquisition-buttons
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run check:sql
bun test packages/frontend/tests/customer-membership-status.test.ts packages/frontend/tests/customer-account.test.ts
bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts
bun run test
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s17-issue-417-account-membership-acquisition-buttons -RequireCodeReview
```

## Delivery
- **Direct-Child `Acquire Memberships` Heading & Primary Action Row (`#417`, `[G1]`)**: Rendered `<h1>Acquire Memberships</h1>` and `<div class="customer-membership-acquire-actions">` (`Annual Teacher` on the left, `Annual Accompanist` on the right) above `<h1>Memberships</h1>` as direct fragment children of `CustomerAccountPageLayout`'s `<section class="customer-account-page parent-account-page">` in `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` (`402` lines `<= 500`), preserving `#app > main > div > div > section > h1` and using default primary `<Button type="button">` styling (`button:disabled` `#9ca3af` in `packages/frontend/src/styles.css`, `+8` lines).
- **Pure Ownership & Fail-Closed Readiness Evaluation (`#417`, `[G2]`)**: Added `isBlockingMembershipStatus` and `resolveMembershipAcquisitionState` in `packages/frontend/src/pages/customerMembershipStatus.ts` (`267` lines `<= 500`) across all 8 `CUSTOMER_MEMBERSHIP_STATUSES` (`"active"`, `"scheduled"`, `"processing"`, `"needs_review"` blocking; `"expired"`, `"revoked"`, `"superseded"`, `"rejected"` non-blocking) evaluated independently per `entitlementClass`, plus `statusVerified` tracking on `createMembershipPollStore` so both buttons stay fail-closed during initial loads, errors, in-flight manual retries after errors, and persisted `pageshow` bfcache revalidations (`checkoutProcessing` scoped to `teacherDisabled`).
- **Standalone Navigation, Disabled Inertness & Return Refresh (`#417`, `[G3]`)**: Wired enabled `Annual Teacher` and `Annual Accompanist` controls to `buildOrgMembershipPath(props.slug)` (`/org/:slug/membership`) and `buildOrgAccompanistMembershipPath(props.slug)` (`/org/:slug/accompanist-membership`) via optional `onNavigate` override or `window.location.assign(path)` (preserving standalone `<Router>`-free compatibility with `packages/frontend/tests/browser/account-return.tsx`), enforced mouse and `Enter`/`Space` keyboard inertness when disabled, and registered a cleaned-up `window` `"pageshow"` listener refreshing status when `event.persisted` is `true`.
- **Deterministic Unit & DOM Test Coverage (`[G4]`)**: Expanded `packages/frontend/tests/customer-membership-status.test.ts` (`388` lines `<= 500`) and `packages/frontend/tests/customer-account.test.ts` (`497` lines `<= 500`) covering all 8 status values, all 4 ownership combinations, direct-child `section > h1` hierarchy, primary button classes, disabled mouse/keyboard inertness, route navigation, persisted `pageshow` return refresh, and in-flight fail-closed retry behavior; completed independent code review in `tasks/s17-issue-417-account-membership-acquisition-buttons/code-review.md` (`Findings status: none`, `Verdict: patch is correct`).

## Quality gate results
- `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s17-issue-417-account-membership-acquisition-buttons -RequireCodeReview`: PASS (exit `0`)
- `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`, `bun run check:sql`: PASS (all exit `0`, `0` errors, `0` warnings)
- `bun test packages/frontend/tests/customer-membership-status.test.ts packages/frontend/tests/customer-account.test.ts`: PASS (`19 pass`, `0 fail`, `171` `expect()` calls, exit `0`)
- `bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts`: PASS (`11 pass`, `0 fail`, exit `0`, `0` errors, `0` warnings)
- `bun run test`: PASS (`common` `365 pass`, `backend` `1,731 pass` / `153` Postgres-gated `skip` / `0 fail`, `frontend` `559 pass`, `shopify-confirmation` `20 pass`; full PostgreSQL 17 integration matrix verified in GitHub Actions `Pull Request Checks / verify`)
