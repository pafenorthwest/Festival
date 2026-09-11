# Establish Goals

## Status

- Task name: teacher-membership-enhancements
- Iteration: v0
- State: locked

## Request

- Create a Teacher Membership paid-renewal issue, a shared Teacher/Accompanist staff roster issue, and update #97, #109, #72, and #73 to apply the approved cross-membership enhancements without duplicating #126 or existing profile-directory scope.

## Blocking ambiguity

- None. The user specified paid Teacher renewal, public Teacher listing via #97, a shared roster, digital configuration for all membership products, and common offering edit/retire principles.

## Assumptions

- PR #125 contains navigation work only; it completed none of #126's paid-order/reconciliation scope. The new renewal issue will reference #126 for the shared delayed-reconciliation fix and carry only paid-time semantics relevant to renewal.

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

## Next action

- Create the issues and apply scoped GitHub issue updates.
