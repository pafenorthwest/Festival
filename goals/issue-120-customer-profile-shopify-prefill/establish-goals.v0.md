# Establish Goals

## Status

- Task name: issue-120-customer-profile-shopify-prefill
- Iteration: v0
- State: locked

## Request

- Address GitHub issue #120: reliably prefill a customer’s Festival account
  profile from a confirmed paid Shopify purchase, without asking the customer
  to enter the same available contact data twice.

## Blocking ambiguity

- Confirm the address policy: when the paid order’s checkout/shipping address
  differs from, or is unavailable as, Shopify’s customer default address, use
  the paid order address for the initial Festival profile projection.

## Assumptions

- Customer-facing profile prefill is independent of the consent that gates
  staff search and view access; that staff-access protection remains intact.
- Shopify supplies initial purchase data. Festival remains authoritative per
  field after a customer edits that field in Festival.
- Shopify fields absent from the paid-order data can remain blank, but the UI
  must distinguish missing data from an import still processing or failed.

## Goals

1. Project eligible paid-order contact data into the matching Festival customer
   profile after Shopify confirms payment.
2. Retry or reconcile transient Shopify-read and Festival-persistence failures
   until projection succeeds or reaches a visible, actionable recovery state;
   never discard such failures silently.
3. Populate available contact fields from the paid purchase, including the
   approved checkout/shipping-address source.
4. Show an in-progress profile-import state on the account return page and
   refresh the profile when projection finishes.
5. Preserve Festival-edited fields from later Shopify projections while
   allowing Shopify to fill blank or Shopify-sourced fields.

## Non-goals

- Write Festival profile changes back to Shopify.
- Change payment, entitlement, order-validation, cancellation, or refund
  behavior.
- Require Shopify to provide fields it did not capture.
- Expand staff customer-profile access beyond existing consent and
  authorization rules.

## Success criteria

- [G1] A paid, correlated purchase with complete Shopify checkout contact data
  populates the Festival profile without a second customer entry.
- [G2] A transient upstream or persistence failure is retried/reconciled or is
  exposed as an actionable operational state; it cannot be terminally marked
  complete and lost.
- [G3] The approved address-source policy is enforced and covered when the
  purchase address differs from or the customer default address is missing.
- [G4] A returning customer sees a processing state and refreshed profile
  values after the import completes.
- [G5] Festival-edited fields are never overwritten by later Shopify data;
  blank and Shopify-sourced fields remain eligible for safe fill.
- [G1-G5] Automated tests cover successful projection, incomplete data,
  failure/retry, account-return timing, address selection, consent separation,
  and local-edit precedence.

## Next action

- Request goal approval after the address policy is confirmed.
