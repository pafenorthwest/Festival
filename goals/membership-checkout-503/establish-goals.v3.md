# Establish Goals

## Status

- Task name: membership-checkout-503
- Iteration: v3
- State: locked

## Request

- Membership checkout for organization pafe returns HTTP 503 with code checkout_retryable_upstream. Investigate and resolve the reported failure.
- Clarify https://festival.passmore.xyz/org/pafe/membership?purchase=1d5d1ac9-0762-4a44-9e15-763ebcd86f52 around Select Division, Agree to sharing data, and Purchase or Cancel. Return the user to their Festival account page after successful purchase.

## Blocking ambiguity

- None. User approved with final clarification that Purchase is disabled until both division selection and agreement are complete.

## Assumptions

- The intended scope is diagnosis and a minimal checkout fix, with regression verification.
- The supplied response alone does not identify the underlying exception. Local source may differ from the deployed revision.
- Interpret agreement as required before Purchase, following the requested step 2; the current implementation describes consent as optional. Use the user-requested agreement copy specified in G3.
- Purchase initiates Shopify's hosted payment flow; explanatory text must make clear that payment is completed there. There is no separate Continue to Shopify action in addition to Purchase.
- Cancel exits the pre-checkout purchase flow back to the membership listing without initiating checkout.
- The successful-purchase destination is the signed-in customer's Festival account at /org/pafe/account (or the corresponding organization route). Any Shopify configuration or capability needed for an automatic return must be verified and documented; do not silently substitute a manual link for the requested return.

## Goals

1. Identify the failure responsible for membership checkout returning checkout_retryable_upstream, using reproducible evidence or available runtime diagnostics.
2. Correct the confirmed cause with minimal changes and verify successful checkout plus relevant failure behavior.
3. Align the selected-membership page with the ordered flow: Select Division, Agree to sharing data, then Purchase or Cancel, with one unambiguous purchase action and clear Shopify payment explanation.
4. Return the customer to their Festival application account page after a successful Shopify purchase and accurately display the membership's confirmation state.

## Non-goals

- Broader membership redesign beyond this purchase flow, unrelated refactors, production deployment, real purchases, or changes to unrelated working-tree files.

## Success criteria

- [G1] Document the failing stage and supporting evidence; explicitly report any unavailable production evidence rather than guessing the cause.
- [G2] A regression test reproduces the confirmed failure and passes with the correction; relevant checkout tests and required checks pass. Preserve authentication, checkout destination validation, and idempotency safeguards.
- [G3] The selected purchase view presents the three steps in order, the selected membership and price, explicit sharing scope, and Purchase and Cancel controls. Purchase remains disabled until both a division is selected and the checkbox is checked; enforce both prerequisites in the UI and checkout API. The view has no competing product Purchase or separate Continue to Shopify action. Cancel clears the purchase selection and exits without starting checkout. Tests cover prerequisites, submission, cancellation, and recoverable errors.
- [G3] The agreement text is exactly "Agree to sharing Shopify-provided contact details to support my membership". Keep the helper text "Required to purchase this membership". Place Cancel on the left and Purchase on the right in the action row beneath step 3.
- [G4] Verify the supported Shopify completion mechanism and test that successful purchase returns to the correct organization's Festival customer account with authentication preserved or safely resumed. The account reflects confirmed membership, or a clear pending state while server-side confirmation is processing; a redirect alone must not confer membership. Document any external configuration required or blocker preventing verification of the automatic return.

## Next action

- Hand off to implement.
