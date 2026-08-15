# Establish Goals

## Status

- Task name: teacher-membership-mvp-issue-organization
- Iteration: v0
- State: draft

## Request

- Clarify and lock the minimum viable Teacher Membership purchase flow.
- Reorganize GitHub work so a new parent issue, `Teacher Membership MVP`, describes the scenario, exit criteria, phased dependencies, and child issues.
- Split issue #79 while preserving completed work and security work that properly belongs in #77 or #78; move operator implementation and later-stage security work into distinct issues labeled `Security`.
- Prioritize completing existing issues #77 and #78, then complete the customer, public membership listing, digital entitlement, and account-verification experience required by the locked MVP.

## Blocking ambiguity

- Whether the purchaser and entitled teacher are always the same customer in the MVP.
- What anonymous users may do beyond viewing the public membership listing.
- Whether the MVP needs a visible multi-step cart or may use a direct single-product checkout handoff while retaining secure cart APIs.
- Where required customer/contact and music-division data is collected and which system owns each field.
- Which system is authoritative for Festival entitlement state.
- The entitlement activation event, exact duration, end-date semantics, and renewal/duplicate-purchase behavior.
- Which pending, confirmed, active, expired, rejected, and review states must be visible to customers.
- Whether quantity is fixed at one and whether only the Teacher Membership product is in MVP scope.

## Assumptions

- Shopify is authoritative for customer authentication, Shopify customer identity, checkout, payment, and Shopify order state.
- Festival remains authoritative for tenant product association, eligibility, checkout intent, validation, and access rights unless the user explicitly chooses otherwise.
- No GitHub issue will be created, edited, closed, or relabeled until the goals are explicitly approved and locked.
- Existing completed work in #79 will remain documented rather than being recreated in new issues.

## Goals

1. Lock an unambiguous, internally consistent Teacher Membership MVP flow and authority model.
2. Create a `Teacher Membership MVP` parent issue with high-level scenario, exit criteria, phased dependency map, and explicit non-goals.
3. Create or update child issues so all work required for the locked MVP is owned exactly once, prioritizing #77 and #78.
4. Split #79 without losing completed work, retaining applicable cart/order security work in #77/#78 and moving operator or later-stage security work to distinct `Security`-labeled issues.
5. Make dependencies and closure order explicit across customer identity, public catalog, authenticated purchase, Shopify commerce ingestion, Festival entitlement, and account verification.

## Non-goals

- Implementing application code as part of this issue-organization task.
- Expanding the MVP to accompanist memberships, class registration, refunds, cancellations, renewal automation, or unrelated operator hardening unless explicitly selected during clarification.
- Treating a browser checkout return as proof of payment or entitlement.

## Success criteria

- [G1] The approved goals define actor identity, interaction boundary, data ownership, entitlement authority, lifecycle dates, and visible states without contradictions.
- [G2] A parent issue named `Teacher Membership MVP` exists with a verifiable end-to-end exit criterion and dependency map.
- [G3] Each required workstream has one clear issue owner and #77/#78 retain their intended phase priority.
- [G4] #79 retains completed history, no completed work is duplicated, and extracted security issues carry the exact `Security` label.
- [G5] GitHub issue relationships and descriptions make the implementation and closure order unambiguous.

## Next action

- Ask blocking questions and check the answers for consistency before requesting goal approval.
