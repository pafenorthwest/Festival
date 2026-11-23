# Establish Goals

## Status

- Task name: customer-expired-checkout-restart
- Iteration: v0
- State: locked
- Approval: The user explicitly approved this draft with "Approve and implement" on 2026-11-15; approval was relayed by the parent agent before implementation bootstrap.

## Request

- Let customers restart an expired, unpaid class checkout and recover their saved registrations without staff intervention. Preserve the original checkout history, handle late payment on the original checkout safely, and explain the resulting customer experience.

## Blocking ambiguity

- None. The user explicitly approved the proposed scope with "Approve and implement".

## Assumptions

- An expired application checkout with a known, attached Shopify cart can be eligible when the authenticated owner and festival match and no stored payment, order projection, entitlement, or review evidence makes replacement unsafe.
- Restart requires an explicit customer action. Discovering an expired checkout or reloading a page does not create a replacement checkout.
- Saved registrations are restored for review and current validation; prices, registration eligibility, and capacity are checked under the existing checkout rules when a new checkout is submitted.
- Existing verified payment processing remains authoritative. A browser return, restart request, or absence of stored payment evidence does not prove that Shopify can no longer accept payment on the old cart.
- A late payment on a superseded checkout requires staff review, with no automatic refund or duplicate registration allocation.

## Goals

1. Provide an explicit customer restart action for an eligible expired, unpaid class checkout with a known attached cart, scoped to the authenticated customer, organization, and festival, and restore its saved registrations for review before a new checkout submission without silently discarding current edits or unrelated cart items.
2. Make replacement durable, atomic, and idempotent: repeated requests, concurrent requests, navigation, and reload resolve to one replacement identity for the same source checkout, with current registration validation applied before a new Shopify checkout handoff.
3. Preserve the original checkout's creation, expiration, recovery-recording, and existing execution-event timestamps and history; append restart audit evidence and a durable source-to-replacement link, and give the replacement its own identity and lifecycle timestamps.
4. Reject restart when ownership or festival scope is wrong, payment or entitlement evidence exists, review is required, the Shopify create outcome is unknown, or another execution state makes replacement unsafe; preserve the existing recovery path for those cases.
5. Record late verified payment on a superseded source checkout for review and reconciliation without duplicate entitlement grants or capacity allocation, whether that payment is observed before or after payment on its replacement, and preserve idempotence under replay and races.
6. Explain expiry and the next action clearly in the cart: show that saved registrations can be reviewed and restarted, preserve access to that recovery after navigation or reload, and distinguish a restartable expiry from a checkout requiring staff review.

## Non-goals

- Automatically refunding, cancelling, or modifying Shopify orders or payments.
- Extending or rewriting the original checkout's expiration window or historical timestamps.
- Building general cart persistence for registrations unrelated to checkout recovery.
- Changing pricing, eligibility, capacity policy, registration allocation rules, or unrelated checkout flows.
- Deploying changes, altering live checkout records, or performing other live business-data mutations as part of this work.

## Success criteria

- [G1] An authenticated owner can explicitly restart an expired, unpaid attached checkout and review all saved registrations without silently losing current edits or unrelated cart items; discovery and page load alone create no replacement, and submitting the restored cart uses current checkout validation before Shopify redirection.
- [G2] Concurrent and repeated restart requests produce one durable replacement identity; a reload, navigation round trip, and retried checkout submission do not create duplicate replacement intents or Shopify carts, including when persistence or upstream calls fail and are retried.
- [G3] Before/after assertions show the source creation, expiration, recovery-recording, and every pre-existing event timestamp remain identical; a new append-only audit event and durable source-to-replacement link identify the new lifecycle without rewriting history.
- [G4] Targeted tests reject a different customer, organization, or festival; stored payment/order/entitlement evidence; needs-review state; unknown Shopify creation; and other unsafe running or recovery states while retaining eligible unpaid-expiry recovery.
- [G5] Payment and reconciliation tests cover late source payment before and after replacement payment, duplicate delivery, replay, concurrent restart/payment processing, edited or merged replacement carts, and repeated restart chains. Late source evidence remains visible for review, and no duplicate entitlement grants or capacity allocation occur across the linked checkouts even when cart contents or replacement request keys change.
- [G6] UI tests cover the expired message, saved-item review/restart action, successful next checkout handoff, navigation/reload recovery, and the staff-review message for ineligible recovery; the handoff explains those customer-visible steps and limitations.

## Next action

- Hand the approved, locked goals to implementation; preserve the approved scope and validation criteria.
