# Goals Extract
- Task name: teacher-membership-offering-entitlement-domain-model
- Iteration: v0
- State: ready-for-confirmation

## Goals

1. Define shared Festival domain/API contracts for the stable, price-free and duration-free `teacher_membership` entitlement class, an Organization-scoped Teacher Membership offering, and an immutable tenant/customer-scoped entitlement grant snapshot.
2. Replace the durable fixed entitlement-period enum rule with validated positive integer `durationDays`, including an explicit supported upper bound, an initial Teacher Membership value of 365 days, and safe deterministic schema/repository migration or reset behavior for the repository's current development state.
3. Persist Organization-scoped Teacher Membership offerings that map exactly one Shopify product variant to `teacher_membership`, retain Festival-owned display/policy configuration, and enforce tenant isolation, Shopify variant uniqueness, and at most one active purchasable Teacher Membership offering per Organization.
4. Keep commercial and authority boundaries server-owned: resolve Organization, entitlement class, duration, Shopify product/variant identity, current checkout price/currency, and current Shopify commercial availability from trusted tenant configuration and live Shopify data rather than untrusted checkout or issuance browser fields.
5. Define and persist immutable entitlement-grant snapshots containing Organization and customer scope; entitlement class and offering ID; purchase-time `durationDays`; stable division ID and division-name snapshot; actual paid Shopify order-line price/currency; correlated checkout-intent, Shopify order, and Shopify order-line IDs; `startsOn`; exclusive `endsOn`; and status.
6. Provide deterministic date helpers that validate the Organization IANA timezone and duration, derive `startsOn` from Shopify's authoritative fully-paid timestamp in that timezone, and compute exclusive `endsOn` by adding `durationDays` calendar days across timezone and daylight-saving boundaries.
7. Expose repository/domain/API contracts that checkout issue #77 and validated grant-issuance issue #78 can consume without implementing checkout return handling, Shopify event handling, paid-order validation orchestration, or grant issuance in this task.
8. Add automated coverage for domain validation, uniqueness and active-offering invariants, tenant isolation, trusted authority boundaries, immutable snapshots, invalid timezones/durations, timezone conversion, calendar-day arithmetic, daylight-saving boundaries, and exclusive end-date semantics; pass the repository-pinned format, build, and test commands.


## Non-goals

- Creating a grant from a checkout return or Shopify event; issue #78 owns validated grant issuance.
- Implementing the customer purchase-selection and checkout flow tracked by issue #77.
- Admin offering-edit UX beyond changes required to maintain the existing Teacher Membership product configuration.
- Renewals, extensions, overlap policy, transfers, gifting, accompanist memberships, or additional entitlement classes.
- Making Festival or browser input authoritative for Shopify's current variant, checkout price, currency, commercial availability, or actual paid order-line facts.


## Success criteria

- [G1] Shared contracts distinguish the stable `teacher_membership` right from its Organization offering and from purchased grants; the entitlement class itself contains no price or duration, and contract tests reject malformed values.
- [G2] Offering persistence and contracts use bounded positive integer `durationDays` instead of the fixed period enum; a newly initialized Teacher Membership offering uses 365 days; zero, negative, non-integer, and above-bound values fail explicitly; repository initialization safely handles the current development schema state.
- [G3] Repository tests prove one variant maps deterministically to one Organization offering, cross-Organization variant reuse is rejected, tenant reads/writes cannot cross scope, and no Organization can have more than one active purchasable Teacher Membership offering.
- [G4] Checkout/grant-facing validation rejects or ignores attempted browser authority over Organization, entitlement class, duration, Shopify IDs, price, or currency; the accepted offering and current commercial facts come from tenant-scoped persistence and current Shopify reads.
- [G5] A persisted grant contains every required snapshot and correlation field; changing an offering display name/duration, a division name, or current Shopify commercial data does not rewrite the existing grant; tenant/customer scoping and stable identifiers remain intact.
- [G6] Given an authoritative fully-paid instant and valid Organization timezone, date helpers produce the local calendar `startsOn` and exclusive `endsOn`; specifically, a 365-day grant starting 2026-08-14 ends 2027-08-14 and is active through 2027-08-13, including deterministic daylight-saving boundary cases; missing/invalid timezones and invalid durations fail explicitly.
- [G7] The resulting contracts are callable by later checkout and issuance work, while no route/service in this task creates a grant from checkout return data or Shopify events.
- [G8] Automated tests cover every listed invariant and boundary, and `bun run format:check`, `bun run build`, and `bun run test` all pass.
