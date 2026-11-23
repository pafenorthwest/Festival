# S21 — Issues `#335`, `#334` & `#329`: Membership Admin UI & Repertoire Piece Limits (`v0.4.2`)

## Goal reference
- Locked goals: `goals/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/goals.v0.md`
- Goal establishment record: `goals/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 4 `v0.4.2`, `DONE` via PR `#446` (`ca84970`), depends on `S14` (`v0.4.1`), Decision `D7`)
- Bounded context architecture: `specs/bounded-contexts-2026.md` (`teacher-directory` admin membership UI & `class-checkout` repertoire validation)

## Scope

### In scope
- Frontend (`#334`, `#335`):
  - `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`
  - `packages/frontend/src/pages/AdminEntitlementReportPanel.tsx`
  - `packages/frontend/src/pages/adminEntitlementReportHelpers.ts`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/admin-entitlement-report-panel.test.ts`
  - `packages/frontend/tests/admin-layout.test.ts` (and related admin membership tests)
- Backend (`#329`):
  - `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-line-helpers.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-line-runner.ts` (multi-line piece-count review follow-up)
  - `packages/backend/src/customer/customer-registration-legacy-helper.ts`
  - `packages/backend/src/checkout/class-checkout-helpers.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
- Packet & release readiness artifacts:
  - `CHANGELOG.md` (if updated for `v0.4.2` prep), `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/spec.md`, `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/code-review.md`, and `specs/pre-thanksgiving-program.md`

### Out of scope
- `#328` (held off to December Week 2 per Admin request)
- `#410`, `#357`, `#260` (December Week 1)
- `#333`, `#340`, `#341` (December Week 2)
- `database/migrations/**` (`0` DB migrations)
- `docker/**`

## Approach
1. **Preflight & Isolated Branch**:
   - Confirm `S14` (`v0.4.1`) is on `origin/main` and validate `s21-v0-4-2-membership-admin-ui-and-repertoire-limits` via `validate-packet.ps1` (exit `0`).
   - Branch `fix/s21-v0-4-2-membership-admin-ui-and-repertoire-limits` off `origin/main` and restrict edits strictly to `In scope` paths.
2. **Issue `#335` — Admin Membership Card Layout (`AdminMembershipProductsPage.tsx` & `styles.css`)**:
   - Restructure each membership card inside `div.admin-membership-list` on `/org/:slug/admin/memberships` into a top details section and a bottom right-aligned wrapping horizontal action row.
   - Ensure multiple membership cards stack vertically without clipping or fixed-height overflow across viewports.
   - Add/update layout regression assertions in `packages/frontend/tests/admin-layout.test.ts` (and related admin membership tests).
3. **Issue `#334` — Entitlements State Badges Wrapping List (`AdminEntitlementReportPanel.tsx`, `adminEntitlementReportHelpers.ts` & `styles.css`)**:
   - Update Entitlements state badges (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`) and counts on `/org/:slug/admin/memberships` to render in a consistently spaced wrapping horizontal list across viewports.
   - Preserve all existing badge labels, colors, counts, and interactive behavior.
   - Add/update deterministic rendering and CSS contract tests in `packages/frontend/tests/admin-entitlement-report-panel.test.ts` and `packages/frontend/tests/admin-layout.test.ts`.
4. **Issue `#329` — Pre-Lookup Repertoire Piece Validation (`class-checkout-validation.ts` & Callers)**:
   - Enforce repertoire piece array shape, max piece count, and basic piece field validation prior to any `catalogWorkId` resolution in `packages/backend/src/domains/class-checkout/class-checkout-validation.ts` and all callers across checkout (`class-checkout-line-helpers.ts`, `class-checkout-helpers.ts`) and registration metadata edits (`customer-registration-legacy-helper.ts`).
   - Write Red-Green regression tests in `packages/backend/tests/class-checkout-service.test.ts` and `packages/backend/tests/customer-account-service.test.ts` proving oversized or structurally invalid repertoire submissions fail fast with zero catalog work lookups.
5. **Verification & `v0.4.2` Release Readiness**:
   - Run full deterministic verification (`validate-packet.ps1`, `verify:toolchain`, `format:check`, `lint`, `build`, frontend/backend `tsc`, `check:sql`, targeted suites, and full `bun run test`) and complete independent subagent code review (`code-review.md`).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s21-v0-4-2-membership-admin-ui-and-repertoire-limits
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run check:sql
bun test packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/customer-account-service.test.ts packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts
bun --cwd packages/frontend test tests/admin-entitlement-report-panel.test.ts tests/admin-layout.test.ts
bun run test
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s21-v0-4-2-membership-admin-ui-and-repertoire-limits -RequireCodeReview
```

## Delivery
- Merged PR: `#446` (`ca84970`, branch `feat/s21-v0-4-2-membership-admin-ui-and-repertoire-limits`)
- **Issue `#335` (Admin Membership Card Layout)**:
  - Restructured each membership card inside `div.admin-membership-list` in `packages/frontend/src/pages/AdminMembershipProductsPage.tsx` into a top `.admin-membership-card-details` section and a bottom right-aligned wrapping `.admin-membership-card-actions` row (`flex-direction: row-reverse; flex-wrap: wrap; justify-content: flex-start`) in `packages/frontend/src/styles.css`.
  - Updated `.admin-membership-list` to stack multiple membership cards vertically (`flex-direction: column; height: auto; max-height: none; overflow: visible`) without clipping or fixed-height overflow across viewports.
  - Added layout and CSS contract regression tests in `packages/frontend/tests/admin-layout.test.ts`.
- **Issue `#334` (Entitlements State Badges Wrapping List)**:
  - Updated `SummaryCountsSection` in `packages/frontend/src/pages/AdminEntitlementReportPanel.tsx` to render the five state badges (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`) and counts as a semantic `<ul class="entitlement-summary-counts">` wrapping horizontal flex list in `packages/frontend/src/styles.css`, preserving all existing badge labels, classes, counts, and interactive behavior.
  - Added rendering and CSS contract tests in `packages/frontend/tests/admin-entitlement-report-panel.test.ts`.
- **Issue `#329` (Pre-Lookup Repertoire Piece Validation)**:
  - Added `prevalidateRepertoirePieces` in `packages/backend/src/domains/class-checkout/class-checkout-validation.ts` (and exported via `packages/backend/src/checkout/class-checkout-helpers.ts`) to validate non-empty array shape, `maximumPerformancePieces`, and per-piece basic fields (including rejecting array items) before any `catalogWorkId` resolution.
  - Wired `prevalidateRepertoirePieces` ahead of `resolvePieceCatalogWorks` in both checkout (`packages/backend/src/domains/class-checkout/class-checkout-line-helpers.ts`) and registration metadata updates (`packages/backend/src/customer/customer-registration-legacy-helper.ts`), preserving existing error codes, HTTP statuses, and downstream duration/concerto/active-work validation precedence.
  - Added zero-lookup regression tests spying on `getCatalogWorkById` in `packages/backend/tests/class-checkout-service.test.ts` and `packages/backend/tests/customer-account-service.test.ts`.
  - Review follow-up (`4a7cebc`): Check every registration's piece count before resolving any catalog works in a multi-line checkout (`class-checkout-line-runner.ts`). Reuse the existing class configurations and cover an oversized later line with a zero-lookup regression test. The early check covers counts only.
- **Additional follow-up commits shipped in PR `#446` (`ca84970`)**:
  - `1979fec` (`consolidate-admin-memberships`): Consolidated admin membership controls into a single 6-column `AdminEntitlementTable.tsx` and moved Shopify reconciliation and validation (`AdminShopifyReconciliationPanel.tsx`) to `AdminIntegrationsPage.tsx` (`/org/:slug/admin/integrations`).
  - `080534f`: Preserved teacher membership edit lock state across entitlement report reloads.
- **Modified files**:
  - `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-line-helpers.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-line-runner.ts`
  - `packages/backend/src/checkout/class-checkout-helpers.ts`
  - `packages/backend/src/customer/customer-registration-legacy-helper.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
  - `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`
  - `packages/frontend/src/pages/AdminEntitlementReportPanel.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/admin-entitlement-report-panel.test.ts`
  - `packages/frontend/tests/admin-layout.test.ts`
  - `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/spec.md`
  - `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/code-review.md`
  - `specs/pre-thanksgiving-program.md`

## Quality gate results
All 11 verification checks passed with 0 errors and 0 warnings:
1. `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s21-v0-4-2-membership-admin-ui-and-repertoire-limits -RequireCodeReview`: PASS (exit 0)
2. `bun run verify:toolchain`: PASS
3. `bun run format:check`: PASS
4. `bun run lint`: PASS (0 warnings, 0 errors)
5. `bun run build`: PASS
6. `bun run --cwd packages/frontend check:types`: PASS
7. `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: PASS
8. `bun run check:sql`: PASS
9. Targeted backend tests (`class-checkout-service.test.ts`, `customer-account-service.test.ts`, `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`): PASS (223/223)
10. Targeted frontend tests (`admin-entitlement-report-panel.test.ts`, `admin-layout.test.ts`): PASS (9/9)
11. Full test suite (`bun run test`): PASS (`common`: 382 pass; `backend`: 1753 pass, 159 skip; `frontend`: 597 pass; `shopify-confirmation`: 21 pass)
- Independent code review (`tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/code-review.md`): `Verdict: patch is correct`, `Findings status: none`.
- Piece-count follow-up: The new regression test recorded one catalog lookup before the fix and zero after it. All 224 targeted backend tests, the backend type check, and Biome checks on the changed TypeScript files passed.
