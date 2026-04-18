## Summary

Create the Phase 3 frontend experience for cart validation, hold visibility, and waitlist outcomes so users understand availability before and after checkout.

## Scope

- Show cart validation outcomes before checkout
- Surface active hold state and hold expiry timing
- Show waitlist placement and promotion messaging
- Explain eligibility and capacity failures without leaking backend internals

## Deliverables

- Cart UI that reflects hold and availability state from backend APIs
- Waitlist-related status and error messaging
- UX for expired holds and failed confirmations

## Acceptance Criteria

- Users can see when a slot is held versus waitlisted
- Hold expiry is visible and understandable
- Capacity and eligibility errors are actionable in the UI
- Waitlist placement and promotion states are surfaced consistently

## Notes

- Spec sources: `specs/ROADMAP-2026.md`
- Phase: `Phase 3`
- Ownership: `frontend UI`
