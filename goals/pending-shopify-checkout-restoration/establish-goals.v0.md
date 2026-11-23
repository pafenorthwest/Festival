# Establish Goals

## Status

- Task name: pending-shopify-checkout-restoration
- Iteration: v0
- State: locked

## Request

- Implement the user-approved specification at `specs/pending-shopify-checkout-restoration.md` for GitHub issue #410.
- Approval evidence: after the issue and specification were delivered for review, the user replied, "approved proceed". This approves the specification's behavior, scope, non-goals, and AC1–AC9; no second approval is required.

## Blocking ambiguity

- None. Supported, complete Shopify order discovery is an implementation dependency. Unverifiable or incomplete provider evidence must remain unresolved and blocked, as the approved specification requires.

## Assumptions

- Shopify remains authoritative for current cart contents and payment state. Existing database records provide customer/cart linkage, Festival registration metadata, and last-known evidence.
- The current checkout can be reused. Preserve the existing `AGENTS.md` and `bun.lock` modifications and the approved specification; do not mix unrelated changes into implementation.
- Resume applies to the same authenticated owner across renewed sessions and does not introduce cancellation, replacement, payment capture, or a new deposit policy.

## Goals

1. Restore the reported outstanding Solo Class checkout after Shopify handoff and a new login, showing Cart (1), saved details, and same-cart continuation while preventing a second registration checkout.
2. Restore across reloads, new devices, and renewed sessions without browser request keys, preserving exact registration-line identity, multi-line counts, and owning-festival navigation.
3. Secure customer-level discovery and resume with organization/customer authorization, current-session CSRF/origin checks for mutation, verified storefront binding, and validated Shopify navigation URLs.
4. Preserve partial payment across login and local expiry, display live verified received/outstanding amounts, and permit eventual full-payment confirmation exactly once without creating another cart or partial entitlement.
5. Keep pending/authorized, paid-but-processing, refunded/cancelled/voided exceptions, absent carts, and uncertain provider states visible and blocked until appropriately verified or reviewed.
6. Handle missing, delayed, duplicate, and out-of-order payment events without treating incomplete payment as a terminal rejection, hiding payment evidence, or duplicating registrations.
7. Discover checkout candidates and correlated Shopify orders across financial states with bounded complete pagination; represent ambiguity, missing identifiers, limits, and conflicts as unresolved review rather than no checkout.
8. Preserve private customer state and admission/idempotency safeguards under stale async responses, identity changes, multiple tabs, repeated resumes, and payment/resume/restart races.
9. Reuse existing storage and checkout/projection contracts proportionately, preserve eligibility and paid-line rules, keep discovery read-only, and prove the affected behavior with appropriate checks and tests.

## Non-goals

- Persisting ordinary browser drafts before checkout, editing/merging submitted Shopify carts, automatic discard or replacement on expiry, or adding a cancel checkout action.
- A new deposit/installment or partial-registration policy, payment capture, refund-policy implementation, or changes to eligibility, registration windows, capacity, and paid-line allocations.
- Two new payment-state/history tables as a baseline, payment-write scopes, broader replacement-cart recovery from #260, or unrelated membership recovery changes.
- Committing, pushing, or creating a pull request without an applicable later landing instruction.

## Success criteria

- [G1, AC1] The exact one-child Solo Class reproduction restores Cart (1), saved selections, the registration block, and the original Shopify cart on continuation; frontend and backend tests cover it.
- [G2, AC2] Reload/new device/new session restore without original keys; multi-line and same-variant sibling identity survives line reordering and festival changes.
- [G3, AC3] Cross-customer/organization and tampered references fail; CSRF/origin, shop-domain URL, and storefront-binding checks are tested.
- [G4, AC4] Partial payment survives relogin and expiry with verified money/currency; no replacement or partial entitlement is created; later full payment confirms once.
- [G5, AC5] Pending/authorized/processing and financial exceptions, missing carts, and provider failures have appropriate visible blocked states and retry/review behavior.
- [G6, AC6] Event loss, delay, duplication, and reordering do not lose partial-payment visibility, poison later full-payment approval, duplicate entitlements, or regress confirmed projection state.
- [G7, AC7] Later-page candidates/orders are examined; incomplete scans, inconsistent correlation, multiple matches, and absent identifiers produce unresolved state.
- [G8, AC8] Stale responses after identity changes are ignored; concurrent tab/resume/payment/restart cases preserve ownership and prevent new replacement carts or registration-gate bypass.
- [G9, AC9] Existing eligibility/idempotency/paid-line/recovery tests remain green; GET performs no lifecycle writes; local expiry and missing local payment records never authorize replacement. Applicable build, type, format, SQL, schema-parity, and PostgreSQL checks pass or any unavailable external verification is reported precisely.

## Next action

- Hand off these locked goals to implementation under the approved specification. Record actual delivery and verification evidence in `tasks/pending-shopify-checkout-restoration/spec.md`.
