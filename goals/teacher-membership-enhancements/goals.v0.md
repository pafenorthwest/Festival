# Goals Extract
- Task name: teacher-membership-enhancements
- Iteration: v0
- State: locked

## Goals

1. Create a Teacher Membership renewal issue that permits a paid renewal only at 30 or fewer calendar days remaining, creates a new immutable grant, preserves history, and uses verified Shopify `fullyPaidAt` in the Organization timezone.
2. Create a separate shared Admin membership-roster issue for Teacher and Accompanist memberships.
3. Extend #97 with the opt-in public active Teacher list, extend #109 to every new membership product, and generalize #72/#73 to every active membership offering while retaining their safety constraints.
4. Preserve #126 as the owner of failure diagnostics and paid-order reconciliation correction; do not duplicate that implementation scope.


## Non-goals

- Implementing code, altering existing grants, exposing contact/payment details publicly, or making refunds/cancellations part of renewal.


## Success criteria

- [G1] The new Teacher renewal issue formally depends on #126 and explicitly excludes #126's diagnostics scope.
- [G2] The renewal issue specifies authoritative paid-time semantics, 30-day eligibility, one-current-right behavior, immutable prior grant history, idempotency, and tenant/customer isolation.
- [G3] The roster issue limits contact visibility to authorized Organization staff and separates public profile discovery.
- [G4] Updated issues #97, #109, #72, and #73 make their multi-membership applicability and immutable-history constraints explicit.

