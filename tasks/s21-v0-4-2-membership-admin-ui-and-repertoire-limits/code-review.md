# Code Review

- Task name: s21-v0-4-2-membership-admin-ui-and-repertoire-limits
- Findings status: none

## Context

Independent code review of S21 (`s21-v0-4-2-membership-admin-ui-and-repertoire-limits`) covering issues `#329`, `#334`, and `#335` against `goals/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/goals.v0.md`, `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/spec.md`, and `specs/bounded-contexts-2026.md` (`class-checkout` and `teacher-directory`).

### Scope and Boundary Audit
- All 11 modified files fall strictly within `### In scope` of `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/spec.md`:
  - Backend: `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`, `packages/backend/src/domains/class-checkout/class-checkout-line-helpers.ts`, `packages/backend/src/checkout/class-checkout-helpers.ts`, `packages/backend/src/customer/customer-registration-legacy-helper.ts`, `packages/backend/tests/class-checkout-service.test.ts`, `packages/backend/tests/customer-account-service.test.ts`.
  - Frontend: `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`, `packages/frontend/src/pages/AdminEntitlementReportPanel.tsx`, `packages/frontend/src/styles.css`, `packages/frontend/tests/admin-layout.test.ts`, `packages/frontend/tests/admin-entitlement-report-panel.test.ts`.
- Zero out-of-scope edits (`#328`, `#410`, `#357`, `#260`, `#333`, `#340`, `#341`, `database/migrations/**`, `docker/**`).
- All modified source files remain under the 500-line ceiling (`166` to `497` lines), newly added `prevalidateRepertoirePieces` is cohesive (18 lines, 2 parameters), and the diff contains zero debug statements or secrets.

### Technical Review Summary
- **`#329` (Backend — Pre-lookup repertoire validation)**:
  - `prevalidateRepertoirePieces` in `packages/backend/src/domains/class-checkout/class-checkout-validation.ts` validates non-empty array shape, `maximumPerformancePieces`, and per-piece basic fields via `validateRepertoirePiece` (which also now rejects array items via `Array.isArray(piece)`).
  - Both checkout (`resolveLinePiecesAndInstrument` in `class-checkout-line-helpers.ts`) and registration metadata edits (`applyLegacyMetadataUpdate` in `customer-registration-legacy-helper.ts`) call `prevalidateRepertoirePieces` before `resolvePieceCatalogWorks`. Recursive search across `packages/backend/src` confirmed no other callers of `resolvePieceCatalogWorks` exist.
  - Existing error codes, HTTP statuses, and total-duration/concerto/active-work validation precedence in `validateAndNormalizeRepertoirePieces` are preserved.
  - Deterministic regression tests in `class-checkout-service.test.ts` and `customer-account-service.test.ts` spy on `getCatalogWorkById` and assert `0` calls for oversized, empty/non-array, invalid-object, and invalid-field payloads.
- **`#335` (Frontend — Admin membership card layout)**:
  - `AdminMembershipProductsPage.tsx` restructures each card inside `div.admin-membership-list` into `<article class="admin-membership-item admin-membership-card">` with a top `.admin-membership-card-details` section (heading with wrapping title + non-wrapping price, optional description, wrapping meta row) and a bottom `.admin-membership-card-actions` row (`display: flex; flex-direction: row-reverse; flex-wrap: wrap; justify-content: flex-start`).
  - `.admin-membership-list` uses vertical flex stacking (`flex-direction: column; height: auto; max-height: none; overflow: visible`) so multiple cards stack cleanly without clipping or fixed-height overflow while keeping `.admin-membership-item` compatible with `AdminTeacherDirectoryPanel.tsx` and mobile media queries.
  - Layout and CSS contract assertions in `packages/frontend/tests/admin-layout.test.ts` cover card structure, ordering, vertical stacking, and right-aligned wrapping actions.
- **`#334` (Frontend — Entitlements state badges wrapping list)**:
  - `AdminEntitlementReportPanel.tsx` renders `SummaryCountsSection` as a semantic `<ul class="entitlement-summary-counts">` of `<li class="entitlement-summary-card">` items, preserving all five labels (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`), badge classes, counts, and filter/table interactions.
  - `styles.css` styles `.entitlement-summary-counts` as a wrapping horizontal flex list (`flex-wrap: wrap`, consistent row/column gaps) with non-wrapping pill items and tabular-num counts.
  - Contract assertions in `packages/frontend/tests/admin-entitlement-report-panel.test.ts` verify all five labels, badge classes, list markup, and wrapping flex CSS.

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: All three scoped issues (`#329`, `#334`, `#335`) are implemented cleanly within the locked S21 scope and bounded-context guidelines, with no regressions, no out-of-scope edits, and deterministic backend and frontend regression tests verifying every success criterion.
