# Goals Extract
- Task name: consolidate-admin-memberships
- Iteration: v0
- State: locked

## Goals
1. Replace the standalone directory moderation panel with a wider Entitlements table that shows membership type above its date range and aligns pencils in a dedicated Edit column.
2. Enable row-level teacher division, directory visibility, and revocation actions using the existing admin APIs and each row's correct profile or grant identity.


## Non-goals
- Change membership products, accompanist division policy, roster, reconciliation, or revocation eligibility.
- Create profiles as a side effect of editing an entitlement, or change directory opt-in on a member's behalf.


## Success criteria
- [G1] The report has six columns, dedicated status badges and pencils, and horizontal scrolling confined to the report on narrow viewports.
- [G2] Teacher division changes update the display and filters. Accompanist divisions remain read-only. Directory controls respect role, active membership, profile existence, and opt-in. Revoke still requires a reason and confirmation.
