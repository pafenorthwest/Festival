# Establish Goals
- Task name: s21-v0-4-2-membership-admin-ui-and-repertoire-limits
- Iteration: v0
- State: locked

## Status
Locked for Wave 4 (`v0.4.2`) pre-Thanksgiving execution per Decision `D7` (2026-11-19 Open Issues Triage), depending on `S14` (`v0.4.1`). Pulls `#335`, `#334`, and `#329` forward ahead of the December 1, 2026 Phase 1 Live Launch while keeping `#328` in December Week 2 per Admin request and `#410`/`#357`/`#260` in December Week 1.

## Request
Deliver three targeted pre-Thanksgiving fixes for `v0.4.2`: (1) `#335` membership card vertical stacking with a top details section and bottom right-aligned wrapping horizontal action row on `/org/:slug/admin/memberships`; (2) `#334` consistently spaced wrapping horizontal Entitlements state badges (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`) and counts across viewports on `/org/:slug/admin/memberships`; and (3) `#329` fail-fast validation of repertoire piece array shape, max piece count, and basic piece fields before resolving `catalogWorkId`s across both checkout and registration metadata edit paths with zero-catalog-lookup regression tests.

## Blocking ambiguity
None.

## Assumptions
- `S14` (`v0.4.1`) is released on `origin/main` (`6a16a43`); `0` database schema migrations and `0` `docker/**` changes are required.
- All modified and newly introduced files stay within repository size and architecture boundary rules (`file-size-ratchet.test.ts`, `architecture-boundaries.test.ts`).
- Both checkout (`packages/backend/src/domains/class-checkout/class-checkout-validation.ts`, `class-checkout-line-helpers.ts`, `packages/backend/src/checkout/class-checkout-helpers.ts`) and registration metadata edit (`packages/backend/src/customer/customer-registration-legacy-helper.ts`) paths share or invoke the pre-lookup repertoire validation contract consistently.

## Goals
1. `#335`: On `/org/:slug/admin/memberships` (`div.admin-membership-list`), split each membership card into a top details section and a bottom right-aligned wrapping horizontal action row, stacking multiple cards vertically without clipping or fixed-height overflow.
2. `#334`: On `/org/:slug/admin/memberships`, display Entitlements state badges (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`) and counts in a consistently spaced wrapping horizontal list across viewports while preserving labels, colors, counts, and behavior.
3. `#329`: Validate repertoire piece array shape, max piece count, and basic piece fields before resolving `catalogWorkId`s in both checkout and registration metadata edit paths (`packages/backend/src/domains/class-checkout/class-checkout-validation.ts` and callers), with regression tests proving oversized submissions are rejected with zero catalog lookups.
4. Prepare clean `v0.4.2` pre-Thanksgiving release readiness with zero regressions and all quality gates green.

## Non-goals
- `#328` (held off to December Week 2 per Admin request).
- `#410`, `#357`, and `#260` (December Week 1).
- `#333`, `#340`, and `#341` (December Week 2).
- Database schema migrations (`database/migrations/**`) or `docker/**` changes.
- Unrelated refactoring outside the scoped admin membership UI and repertoire validation paths.

## Success criteria
- [G1] On `/org/:slug/admin/memberships` (`div.admin-membership-list`), each membership card renders a top details section and a bottom right-aligned wrapping horizontal action row, with multiple cards stacking vertically without clipping or fixed-height overflow, verified by frontend tests (`#335`).
- [G2] On `/org/:slug/admin/memberships`, Entitlements state badges (`Active`, `Scheduled`, `Superseded`, `Expired`, `Revoked`) and counts render in a consistently spaced wrapping horizontal list across viewports while preserving existing labels, colors, counts, and interactions, verified by frontend tests (`#334`).
- [G3] Both checkout and registration metadata edit paths validate repertoire piece array shape, max piece count, and basic piece fields before resolving `catalogWorkId`s, with deterministic regression tests proving oversized submissions are rejected with zero catalog lookups (`#329`).
- [G4] `v0.4.2` release readiness is verified with zero regressions: `validate-packet.ps1`, toolchain verification, format check, lint, frontend/backend typecheck, build, `check:sql`, and the full test suite all pass with `0` errors and `0` warnings.

## Next action
Execute `tasks/s21-v0-4-2-membership-admin-ui-and-repertoire-limits/spec.md` in an isolated branch/worktree (`fix/s21-v0-4-2-membership-admin-ui-and-repertoire-limits`) off `origin/main`.
