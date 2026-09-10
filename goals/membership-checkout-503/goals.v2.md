# Goals Extract
- Task name: membership-checkout-503
- Iteration: v2
- State: ready-for-confirmation

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
- [G3] The selected purchase view presents the three steps in order, the selected membership and price, explicit sharing scope, and Purchase and Cancel controls. Purchase requires a selected division and affirmative consent, enforced by the UI and checkout API. The view has no competing product Purchase or separate Continue to Shopify action. Cancel clears the purchase selection and exits without starting checkout. Tests cover prerequisites, submission, cancellation, and recoverable errors.
- [G3] The agreement text is exactly "Agree to sharing Shopify-provided contact details to support my membership". Keep the helper text "Required to purchase this membership". Place Cancel on the left and Purchase on the right in the action row beneath step 3.
- [G4] Verify the supported Shopify completion mechanism and test that successful purchase returns to the correct organization's Festival customer account with authentication preserved or safely resumed. The account reflects confirmed membership, or a clear pending state while server-side confirmation is processing; a redirect alone must not confer membership. Document any external configuration required or blocker preventing verification of the automatic return.

