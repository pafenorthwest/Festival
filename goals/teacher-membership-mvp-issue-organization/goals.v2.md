# Goals Extract
- Task name: teacher-membership-mvp-issue-organization
- Iteration: v2
- State: locked

## Goals

1. Create a `Teacher Membership MVP` parent issue describing the self-purchase scenario, authority boundaries, phased dependency graph, explicit non-goals, and verifiable end-to-end exit criteria.
2. Create or update actual GitHub sub-issues so every required workstream is owned exactly once, with a dependency checklist in the parent and existing issues #77 and #78 prioritized as the cart/checkout and order-validation phases.
3. Split #79 without losing completed history: move applicable remaining customer/cart/order security requirements into #77/#78, move operator implementation and later-stage security work into distinct issues labeled exactly `Security`, then close #79 as a superseded/completed security foundation.
4. Track a tenant-scoped Festival customer concept keyed externally by the Shopify customer GID, with Shopify authoritative for authentication/customer identity and Festival authoritative for the local customer record, tenant association, application state, and Account experience.
5. Track a publicly readable organization membership listing where anonymous visitors can view Teacher Membership details and initiate Shopify authentication, but only an authenticated customer can create a cart or begin purchase; preserve the selection across authentication.
6. Track a direct, quantity-one Teacher Membership purchase flow using secure tenant/customer-scoped cart APIs and Shopify-hosted checkout, without requiring a general-purpose cart page; Shopify remains authoritative for checkout, payment, and order state.
7. Track tenant-administered Organization divisions through a new Division card in the organization Admin experience and require an authenticated customer to select one valid active division before Shopify checkout.
8. Track the three-part entitlement model: stable `teacher_membership` class; organization-specific membership offering mapping one Shopify variant to its display/commercial configuration and positive `duration_days`; and a customer entitlement grant produced only after Festival validates a fully paid correlated Shopify order.
9. Track deterministic entitlement history: initial offering duration 365 days; grant snapshots for duration, stable Organization division ID, division name, paid order-line price/currency, and source identifiers; `starts_on` derives from the fully-paid timestamp's date in the organization timezone and exclusive `ends_on` is `starts_on + duration_days` calendar days.
10. Track an Account experience that shows a checkout return as `Processing`, shows rejected/review-required purchases as non-active, and shows approved entitlement name/class, division, paid price, start date, exclusive end date, duration, and active/expired status; block another Teacher Membership purchase while an active or processing one exists.


## Non-goals

- Implementing application code as part of this issue-organization task.
- Accompanist memberships, other purchasable products, class registration, refunds, cancellations, renewal/extension automation, entitlement transfer, gifting, or purchase for another person.
- Treating a browser checkout return as proof of payment or entitlement.
- A general-purpose customer cart UI or quantities other than one.
- Purchasing an entitlement for another person.
- Making Shopify order history authoritative for Festival entitlement state.
- Rewriting historical entitlement snapshots after a division rename, offering price change, or duration change.


## Success criteria

- [G1] The new parent issue states the complete scenario, Shopify/Festival authority boundary, non-goals, phased dependency order, and an exit test covering anonymous browsing through Account entitlement verification.
- [G2] The parent has actual GitHub sub-issue relationships and a matching dependency checklist; every required MVP behavior has one clear issue owner and no behavior is silently duplicated.
- [G3] #77 owns the authenticated direct-purchase cart/checkout boundary and relevant security controls; #78 owns order projection, Festival validation, entitlement creation/gating, and relevant security controls.
- [G4] #79 preserves its completed checklist/history, all unfinished items are accounted for in #77, #78, or new `Security` issues, and #79 is closed with explicit successor links.
- [G5] The issue set specifies customer identity by tenant plus Shopify customer GID, never email, and distinguishes Shopify identity/commerce authority from Festival application/entitlement authority.
- [G6] The issue set requires anonymous read-only catalog access, authenticated-only purchase mutations, authentication return/resume, one Teacher Membership at quantity one, required division selection, and duplicate active/processing purchase prevention.
- [G7] The issue set specifies the entitlement class/offering/grant model, one-active-offering-per-variant mapping, positive duration validation, initial 365-day duration, checkout-intent/order-line correlation, and immutable purchase snapshots.
- [G8] Date examples and tests prove organization-timezone conversion, calendar-day addition, and exclusive end-date behavior, including that a grant starting 2026-08-14 with 365 days ends exclusively on 2027-08-14.
- [G9] Account acceptance criteria prove that checkout return alone is only `Processing`, non-approved states grant no rights, and an approved entitlement displays its name/class, division, paid price, duration, start, end, and active/expired state.

