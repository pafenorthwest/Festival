# Issue #166 completion work breakdown

## Scope boundary

Complete the remaining canonical-entitlement work in #166. Teacher multi-division
policy configuration, multi-select checkout, and frozen multi-division snapshots
remain deferred to #172. Teacher checkout continues to require exactly one
division.

A Shopify-identified customer may independently hold both a Teacher Membership
entitlement and an Accompanist Membership entitlement in the same Organization.
Renewal, duplicate-purchase, cohort, and lifecycle rules apply within each
entitlement class only; they must never make the two classes mutually exclusive.

## Workstreams

1. **Canonical contracts and repositories**
   - Replace legacy grant-oriented repository contracts and the divergent
     in-memory Teacher/Accompanist stores with one entitlement-oriented model.
   - Keep source-specific fields in their detail records; derive lifecycle from
     dates and revocation in every implementation.
   - Add explicit invariant checks for entitlement class, source, organization,
     offering, and division ownership.

2. **PostgreSQL integrity and lifecycle**
   - Close missing schema/repository invariants for source-detail and offering
     class compatibility without adding the intentionally excluded exact-one
     detail-row database rule.
   - Preserve cohort compare-and-swap, exclusion constraints, audited idempotent
     revocation, and organization-timezone lifecycle calculations.

3. **Service and authorization adoption**
   - Route customer status, Teacher checkout eligibility, paid-order duplicate
     handling, Accompanist roster, and available registration authorization
     paths through the common lifecycle policy.
   - Remove stale predicates and persisted status decisions from callers.

4. **Verification**
   - Add focused unit tests for lifecycle, source/offering invariants, identity
     binding, scheduled renewal, revocation, and checkout eligibility.
   - Add PostgreSQL integration coverage for constraints and representative
     transactional behavior where the existing integration harness permits.
   - Run format, build, and full tests; document any environment-only blocker.

## Initial milestone

Establish one shared in-memory entitlement representation and lifecycle-derived
read path. This removes the largest production/test-model divergence before
changing callers or tightening PostgreSQL contracts.
