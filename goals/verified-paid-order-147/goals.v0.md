# Goals Extract
- Task name: verified-paid-order-147
- Iteration: v0
- State: locked

## Goals

1. Audit every #147 acceptance criterion against current implementation and tests, record evidence, and identify only defensible remaining gaps.
2. Persist immutable confirmed registration snapshots sufficient to interpret purchased class/configuration, teacher identity, division, repertoire including optional movement/variation, and accompanist selection after source records change; audit instrument capture separately and retain its unresolved acceptance gap pending the user's decision.
3. Complete any verified-payment, tenant/customer/child correlation, idempotency/retry, or grandfathered-cart paid-placement gaps found by the acceptance audit while preserving existing commerce boundaries.
4. Verify the remaining changes with meaningful regression tests and pinned repository checks, documenting results and any concrete limitations.

## Non-goals

- Free student waitlist persistence/APIs (#283), parent class badges/signup UX (#29), promotion policy, scheduling, or unrelated performance/refactoring work.
- Replace the existing Shopify checkout/payment flow or relax payment authority, tenant isolation, cart integrity or authorization.
- Create a new branch/worktree, commit, push, create a PR, publish, or deploy.
- Modify unrelated untracked artifacts, shell configuration, shared workflow manifests, or external bootstrap configuration.

## Success criteria

- [G1] The task spec contains a criterion-by-criterion matrix with existing evidence, implementation decisions, and final verification evidence.
- [G2] Confirmed records preserve existing historical registration selections and class configuration across later catalog, entitlement/contact and capacity edits; tests exercise source-data changes and snapshot immutability. Instrument capture has an explicit gap/decision record and cannot be reported complete without an approved source and verified implementation.
- [G3] Unpaid/invalid, uncorrelated, stale or cross-tenant evidence cannot create registrations; retries/replays create no duplicates; valid attached carts paid over capacity retain one placed outcome per registration; targeted tests verify any touched behavior.
- [G4] Pinned lint/build/test commands and required SQL checks pass, or the task records the exact failure/blocker without declaring completion. Sensitive-data handling is reviewed and covered where changed.
