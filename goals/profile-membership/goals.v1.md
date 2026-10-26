# Profile creation membership prerequisite

State: locked

Authorization: User requested requiring membership, branch `ericp/membership-requires-consent`, and subsequently chose a fix-only PR targeting PR 307's branch.

Goals and success criteria:
1. Creating a teacher or accompanist profile requires an active membership of the matching role for the authenticated customer in the same organization. Missing, other-role, scheduled, expired, and revoked membership cannot authorize creation; tests verify rejection and no persisted profile.
2. Existing profile reads and edits remain available, including directory opt-out after membership lapse; tests verify this behavior.
3. Submit only this change against `feat/285-profiles-management`, with passing focused tests, formatting, backend type checks, and common/backend builds.

Non-goals: changing membership acquisition, inferring staff consent from membership, changing admin contact projections, correcting postal-code extraction, or modifying PR 307's other behavior.
