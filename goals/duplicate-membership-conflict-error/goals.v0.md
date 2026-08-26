# Goals Extract
- Task name: duplicate-membership-conflict-error
- Iteration: v0
- State: locked

## Goals

1. Before creating a Shopify membership product, detect whether the tenant Organization already has an active `teacher_membership` offering and reject the request with HTTP 409 and the explicit message `An active Teacher Membership already exists for this organization.`
2. Preserve the existing one-active-offering invariant and existing behavior for non-duplicate Shopify, validation, authorization, and persistence failures.
3. Add automated coverage proving the explicit duplicate response and proving that duplicate requests perform no Shopify mutation or mutation-audit write.


## Non-goals

- Restoring or adding an Admin-selectable membership duration.
- Adding offering edit, replacement, activation, deactivation, or deletion workflows.
- Changing public membership listing or purchase behavior.
- Modifying or deleting the existing `pafe` membership record.


## Success criteria

- [G1] Given an Organization with an active `teacher_membership` offering, the Admin create endpoint returns HTTP 409 with exactly `An active Teacher Membership already exists for this organization.` and Shopify create/update/delete methods are not called.
- [G2] Existing validation, authorization, successful creation, Shopify failure handling, and database uniqueness behavior remain passing under the repository test suite.
- [G3] A focused automated test verifies that rejecting a duplicate does not append a Shopify mutation-audit record.

