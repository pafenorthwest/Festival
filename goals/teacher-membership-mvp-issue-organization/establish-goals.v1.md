# Establish Goals

## Status

- Task name: teacher-membership-mvp-issue-organization
- Iteration: v1
- State: draft

## Request

- Clarify and lock the minimum viable Teacher Membership purchase flow.
- Reorganize GitHub work so a new parent issue, `Teacher Membership MVP`, describes the scenario, exit criteria, phased dependencies, and child issues.
- Split issue #79 while preserving completed work and security work that properly belongs in #77 or #78; move operator implementation and later-stage security work into distinct issues labeled `Security`.
- Prioritize completing existing issues #77 and #78, then complete the customer, public membership listing, digital entitlement, and account-verification experience required by the locked MVP.

## Blocking ambiguity

- Whether each Shopify variant maps to one Festival entitlement definition and carries the configurable duration in days.
- Whether `purchase date` means Shopify's authoritative paid timestamp or another order timestamp.
- Whether duration uses exact elapsed 24-hour periods or calendar dates in the tenant timezone.
- Whether a division rename should change the division displayed on an existing entitlement or preserve its purchase-time name.

## Assumptions

- The Shopify customer purchases a Teacher Membership only for themselves; the tenant-scoped Shopify customer GID, not email, is the external identity key.
- Anonymous visitors may view membership details and initiate Shopify authentication, but no cart or purchase mutation occurs until a Festival customer session is authenticated.
- The MVP has one Teacher Membership at quantity one, a direct purchase flow, secure cart APIs, and no general-purpose cart page.
- Accompanist memberships and other purchasable products are excluded.
- Festival collects a required division immediately before redirecting to Shopify; Shopify checkout collects name, email, mailing address, and phone.
- Divisions are tenant-specific Festival records administered through a new Division card in the organization Admin experience.
- Shopify is authoritative for customer authentication, Shopify customer identity, checkout, payment, and Shopify order state.
- Festival is authoritative for eligibility, checkout intent, purchase validation, and entitlement state.
- A paid order creates no entitlement until Festival validation approves it.
- After approval, Account shows an active entitlement with start date, exclusive end date, and music division; processing, rejected, or review-required purchases remain visibly non-active.
- A customer with an active or processing Teacher Membership cannot start another Teacher Membership purchase.
- Issue #79 will retain its completed-work record; applicable remaining work moves to #77/#78, operator and later-stage work moves to distinct `Security` issues, and #79 is then closed as a superseded/completed foundation.
- The `Teacher Membership MVP` parent will use actual GitHub sub-issue relationships and an explicit dependency checklist.
- No GitHub issue will be created, edited, closed, or relabeled until the goals are explicitly approved and locked.
- Existing completed work in #79 will remain documented rather than being recreated in new issues.

## Goals

1. Lock an unambiguous, internally consistent Teacher Membership MVP flow and authority model.
2. Create a `Teacher Membership MVP` parent issue with high-level scenario, exit criteria, phased dependency map, and explicit non-goals.
3. Create or update child issues so all work required for the locked MVP is owned exactly once, prioritizing #77 and #78.
4. Split #79 without losing completed work, retaining applicable cart/order security work in #77/#78 and moving operator or later-stage security work to distinct `Security`-labeled issues.
5. Make dependencies and closure order explicit across customer identity, public catalog, authenticated purchase, Shopify commerce ingestion, Festival entitlement, and account verification.
6. Model tenant-administered music divisions and a self-purchased Teacher Membership whose Shopify variant maps deterministically to a Festival entitlement definition with a positive duration in days.
7. Ensure the customer Account experience distinguishes processing and non-active purchase states from an approved active entitlement and displays its division, start date, and exclusive end date.

## Non-goals

- Implementing application code as part of this issue-organization task.
- Expanding the MVP to accompanist memberships, class registration, refunds, cancellations, renewal automation, or unrelated operator hardening unless explicitly selected during clarification.
- Treating a browser checkout return as proof of payment or entitlement.
- A general-purpose customer cart UI or quantities other than one.
- Purchasing an entitlement for another person.

## Success criteria

- [G1] The approved goals define actor identity, interaction boundary, data ownership, entitlement authority, lifecycle dates, and visible states without contradictions.
- [G2] A parent issue named `Teacher Membership MVP` exists with a verifiable end-to-end exit criterion and dependency map.
- [G3] Each required workstream has one clear issue owner and #77/#78 retain their intended phase priority.
- [G4] #79 retains completed history, no completed work is duplicated, and extracted security issues carry the exact `Security` label.
- [G5] GitHub issue relationships and descriptions make the implementation and closure order unambiguous.
- [G6] The issue set defines a stable Shopify variant-to-Festival entitlement mapping, positive duration-days validation, purchase correlation, and precise activation/date semantics.
- [G7] The issue set requires tenant-administered divisions, authenticated-only purchase mutations, duplicate-purchase prevention, and customer-visible processing/active/non-active states.

## Next action

- Ask blocking questions and check the answers for consistency before requesting goal approval.
