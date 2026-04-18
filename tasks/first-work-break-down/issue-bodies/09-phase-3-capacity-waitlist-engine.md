## Summary

Build the Phase 3 backend allocation engine for capacity enforcement, cart holds, and ordered waitlists so fairness and concurrency rules live in the local system rather than Shopify.

## Scope

- Model inventory, cart holds, and waitlist state
- Add pre-checkout reservation endpoints
- Confirm or release holds based on webhook outcomes and TTL expiry
- Enforce capacity limits and deterministic waitlist ordering
- Support reconciliation when checkout/payment and local availability diverge

## Deliverables

- Backend tables/contracts for inventory, holds, and waitlists
- APIs for reserve, confirm, release, and waitlist transitions
- Expiry handling for stale holds
- Explicit state model for oversell prevention and recovery

## Acceptance Criteria

- The system does not oversell under concurrent requests
- Holds expire and release inventory cleanly
- Waitlist ordering is deterministic and auditable
- Checkout success/failure can be reconciled against local availability state

## Notes

- Spec sources: `specs/ROADMAP-2026.md`
- Phase: `Phase 3`
- Ownership: `backend API`
