# Goals Extract
- Task name: accompanist-membership-issues
- Iteration: v0
- State: locked

## Goals

1. Create one master issue that captures the business scenario, shared invariants, phase ordering, privacy/access boundary, and relationship to #97.
2. Create linked sub-issues for: accompanist offering/domain and organization division policy; signed-in $0 acquisition and renewal; admin roster/contact view; later paid Shopify checkout and webhook projection; and later class-registration accompanist selection/eligibility.
3. Make the $0 path explicitly first, free of Shopify checkout/payment collection while still maintaining a matching digital $0 Shopify product; preserve paid/order and scheduling work as later phases.
4. Make every issue independently implementable with explicit scope, non-goals, acceptance criteria, authorization, immutable-history, and focused test requirements.


## Non-goals

- Implementing code, modifying current product issues, moving #97, or creating duplicate public directory work.


## Success criteria

- [G1] GitHub contains one master issue and exactly five linked sub-issues with clear phase/dependency ordering.
- [G2] The free membership flow is specified as authenticated, immediate entitlement issuance, email/customer duplicate protection, 30-day renewal threshold, Organization-timezone dates, non-stacking renewal, and immutable prior grants.
- [G3] The organization-wide division policy and Admin-only contact visibility rules are unambiguous.
- [G4] Paid Shopify acquisition and future class metadata/accompanist selection are stated as later work, without leaking into the $0 MVP.
- [G5] Each issue links its master parent and related #97 work where relevant.

