# Goals Extract
- Task name: teacher-membership-mvp-issue-organization
- Iteration: v1
- State: draft

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

