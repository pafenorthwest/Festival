# Establish Goals

## Status

- Task name: verified-paid-order-147
- Iteration: v1
- State: locked

## Request

- Audit GitHub issue #147 and finish its remaining acceptance gaps on the existing local branch `ericp/verified-paid-order`.
- Source: https://github.com/pafenorthwest/Festival/issues/147

## Blocking ambiguity

- None. The original finish-#147 authorization covers instrument capture. Parent offered an optional split preference and, after reasonable opportunity, proceeds with the recommended reversible implementation assumption; no new approval is claimed.

## Assumptions

- Existing paid-order correlation, payment verification, confirmed entitlement creation, grandfathered-cart placement, and registration metadata are starting evidence to audit, not features to replace wholesale.
- Add optional tenant-catalog instrumentId capture in checkout API and frontend selection when instruments are configured. Validate tenant/catalog ownership and freeze selected instrument ID/name. Preserve older clients and legacy rows with explicit unknown values; never invent historical selections.
- Dependencies #145, #28, and #284 are completed; preserve their trusted multi-line checkout and soft-capacity policy.
- Scope may include shared types, database migrations/repositories, paid-order projection, optional instrument-selection UI and focused tests where required by #147.
- Continue on the requested existing branch. Preserve unrelated untracked database/test-data, goals and tasks directories; do not stage or modify them.

## Goals

1. Audit every #147 acceptance criterion against current implementation and tests, record evidence, and identify only defensible remaining gaps.
2. Persist immutable confirmed registration snapshots sufficient to interpret purchased class/configuration, teacher identity, division, instrument, repertoire including optional movement/variation, and accompanist selection after source records change. Add optional tenant-catalog instrumentId capture and frontend selection when configured; freeze selected instrument ID/name while preserving older clients and unknown legacy values.
3. Complete any verified-payment, tenant/customer/child correlation, idempotency/retry, or grandfathered-cart paid-placement gaps found by the acceptance audit while preserving existing commerce boundaries.
4. Verify the remaining changes with meaningful regression tests and pinned repository checks, documenting results and any concrete limitations.

## Non-goals

- Free student waitlist persistence/APIs (#283), parent class badges/signup UX (#29), promotion policy, scheduling, or unrelated performance/refactoring work.
- Replace the existing Shopify checkout/payment flow or relax payment authority, tenant isolation, cart integrity or authorization.
- Create a new branch/worktree, commit, push, create a PR, publish, or deploy.
- Modify unrelated untracked artifacts, shell configuration, shared workflow manifests, or external bootstrap configuration.

## Success criteria

- [G1] The task spec contains a criterion-by-criterion matrix with existing evidence, implementation decisions, and final verification evidence.
- [G2] Confirmed records preserve historical registration selections and class configuration across later catalog, entitlement/contact and capacity edits; tests exercise source-data changes and snapshot immutability. Configured tenant-catalog instruments can be optionally selected and are validated/frozen as ID/name. Older clients and legacy unknown values remain supported and are not backfilled with invented history.
- [G3] Unpaid/invalid, uncorrelated, stale or cross-tenant evidence cannot create registrations; retries/replays create no duplicates; valid attached carts paid over capacity retain one placed outcome per registration; targeted tests verify any touched behavior.
- [G4] Pinned lint/build/test commands and required SQL checks pass, or the task records the exact failure/blocker without declaring completion. Sensitive-data handling is reviewed and covered where changed.

## Next action

- Hand off to implement. Parent integrates audit evidence and final validation; these goal artifacts remain immutable.
