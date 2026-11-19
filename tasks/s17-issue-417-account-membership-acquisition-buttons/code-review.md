# Code Review

- Task name: s17-issue-417-account-membership-acquisition-buttons
- Reviewer: Independent Code Review Subagent
- Date: 2026-11-17
- Branch: `feat/s17-issue-417-account-membership-acquisition-buttons`
- Findings status: none

## Context

Performed an independent code review and post-fix re-review of packet `S17` (`s17-issue-417-account-membership-acquisition-buttons`) on branch `feat/s17-issue-417-account-membership-acquisition-buttons` against `origin/main` (`450a9c86ad83fdcf4db4ed7993536c254c4e1c72`), locked packet goals (`goals/s17-issue-417-account-membership-acquisition-buttons/goals.v0.md`, `goals/s17-issue-417-account-membership-acquisition-buttons/establish-goals.v0.md`), packet specification (`tasks/s17-issue-417-account-membership-acquisition-buttons/spec.md`), and bounded-context guardrails (`specs/bounded-contexts-2026.md` §2, §4.4, §6). Initial review finding `S17-REV-01` (fail-closed gating during in-flight manual retries after error and persisted `pageshow` bfcache revalidation) was resolved and verified.

## Scope & Files Reviewed

Inspected `git status --untracked-files=all --short`, full `git diff origin/main`, every modified file in full, and read-only compatibility anchor `packages/frontend/tests/browser/account-return.tsx`:

- `packages/frontend/src/pages/customerMembershipStatus.ts` (`267` lines, modified)
- `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` (`402` lines, modified)
- `packages/frontend/src/styles.css` (`2,850` lines, modified; `+8` lines scoped `.customer-membership-acquire-actions` rule)
- `packages/frontend/tests/customer-membership-status.test.ts` (`388` lines, modified)
- `packages/frontend/tests/customer-account.test.ts` (`497` lines, modified)
- `packages/frontend/tests/browser/account-return.tsx` (`147` lines, read-only compatibility check — verified standalone `<CustomerAccountMembershipsPage slug="pafe" />` mount outside `<Router>` and all fixture text/button queries remain 100% compatible)

Verified strict scope isolation: zero out-of-scope modifications to `CustomerAccountPageLayout.tsx`, `AccompanistMembershipPage.tsx`, `CustomerTeacherDirectoryCard.tsx`, `AdminTeacherDirectoryPanel.tsx`, `packages/frontend/src/lib/api/**`, `packages/common/**`, `packages/backend/**`, or `database/**`.

## Audit Summary

1. **`[G1]` Heading Hierarchy, Direct-Child DOM Structure & Primary Button Styling (`CustomerAccountMembershipsPage.tsx`, `styles.css`)**:
   - `CustomerAccountMembershipsPage.tsx` renders `<h1>Acquire Memberships</h1>` followed by `<div class="customer-membership-acquire-actions">` (`Annual Teacher` left, `Annual Accompanist` right) above `<h1>Memberships</h1>` via a fragment inside `CustomerAccountPageLayout`, preserving `#app > main > div > div > section > h1` with both `<h1>` elements as direct children of `<section class="customer-account-page parent-account-page">`.
   - Both buttons use default primary `<Button type="button">` (`class="button"`, without `.secondary-button`), preserving `button:disabled` (`background: #9ca3af; cursor: not-allowed;`) in `packages/frontend/src/styles.css` without specificity overrides.
2. **`[G2]` Independent Ownership Evaluation & Fail-Closed Readiness (`customerMembershipStatus.ts`, `CustomerAccountMembershipsPage.tsx`, resolving `S17-REV-01`)**:
   - `isBlockingMembershipStatus` and `resolveMembershipAcquisitionState` exhaustively classify all 8 `CUSTOMER_MEMBERSHIP_STATUSES` (`"active"`, `"scheduled"`, `"processing"`, `"needs_review"` blocking; `"expired"`, `"revoked"`, `"superseded"`, `"rejected"` non-blocking) independently per `entitlementClass` (`"teacher_membership"` vs. `"accompanist_membership"`), scoping `checkoutProcessing` strictly to `teacherDisabled` and failing closed when `loading || Boolean(error)`.
   - Resolving `S17-REV-01`, `createMembershipPollStore` tracks `statusVerified` (`false` initially, set `true` when `getCustomerMembershipStatus` resolves, reset `false` in `catch` and synchronously on persisted `pageshow` before `refreshMembershipStatus`), and `CustomerAccountMembershipsPage` passes `loading: store.loading() || store.refreshing() || !store.statusVerified()`. Both acquisition buttons remain fail-closed (`disabled: true`) throughout initial loads, in-flight manual refreshes, retries after `500`/network errors (even after `store.setError("")` clears the prior error alert), and persisted bfcache `pageshow` revalidations without getting stuck if an overlapping request is already in flight.
3. **`[G3]` Route Navigation, Standalone Router Independence, Inertness & Return Refresh (`CustomerAccountMembershipsPage.tsx`)**:
   - Enabled buttons navigate to `buildOrgMembershipPath(props.slug)` (`/org/:slug/membership`) and `buildOrgAccompanistMembershipPath(props.slug)` (`/org/:slug/accompanist-membership`) via `props.onNavigate` or `window.location.assign(path)` without calling `@solidjs/router` `useNavigate()`.
   - Disabled buttons remain visible, set `disabled={true}`, and guard `onClick`, blocking mouse clicks and `Enter`/`Space` keyboard activation. `registerMembershipLifecycle` cleans up polling timers and the `window` `"pageshow"` listener in `onCleanup` while guarding `event.persisted && store.authenticated && !store.disposed`.
4. **`[G4]` Deterministic Tests, Structural Ceilings & Toolchain Gate**:
   - Verified zero pre-existing or `[G1]`–`[G4]` assertions were dropped in `customer-account.test.ts` (`497` lines `<= 500`), while adding deterministic `deferStatus` in-flight fail-closed assertions for both persisted `pageshow` revalidation and manual retry after an initial `500` error.
   - AST and file-hygiene audit confirmed all modified TypeScript/TSX files are `<= 500` lines with LF line endings (`crlf=false`), all new/modified functions and `it` blocks are `<= 60` lines with `<= 3` parameters and cyclomatic complexity `<= 9` (pre-existing untouched `customerMembershipViewModel` remains `72` lines), and zero `console.*`, `debugger`, or credentials/secrets are present.
   - Independent verification executed in `pwsh`: `bun run format:check` (`839` files, `0` issues), `bun run lint` (`839` files, `0` issues), `bun run --cwd packages/frontend check:types` (`0` errors), `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit` (`0` errors), `bun run check:sql` (`522` files), and `bun test` across `customer-membership-status.test.ts`, `customer-account.test.ts`, `architecture-boundaries.test.ts`, and `file-size-ratchet.test.ts` (`30` pass, `0` fail, `222` `expect()` calls).

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: `S17-REV-01` is cleanly resolved with deterministic in-flight regression coverage, and all `[G1]`–`[G4]` functional, DOM structure, standalone router compatibility, bounded-context isolation, file/function size, lint, typecheck, and SQL guardrails pass with zero defects.
