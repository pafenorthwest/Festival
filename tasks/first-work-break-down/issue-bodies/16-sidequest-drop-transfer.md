## Summary

Implement controlled drop and transfer workflows so registration changes remain auditable, capacity-safe, and aligned with refund/payment behavior.

## Scope

- Support drops with and without refunds
- Support class transfers while preserving eligibility and priority rules
- Preserve or explicitly reset queue priority where business rules require it
- Log every registration change and related refund event

## Deliverables

- Registration change log and refund event model
- APIs for drop and transfer operations
- Capacity/waitlist-aware transfer handling
- Operational UI or workflow support for staff-driven repairs

## Acceptance Criteria

- Drops and transfers are fully logged
- Capacity and waitlist rules remain correct after transfers
- Refund behavior stays reconcilable with payment state
- Priority handling is explicit and deterministic

## Notes

- Spec sources: `specs/SIDEQUESTS-2026.md`
- Workstream: `Side Quest`
- Ownership: `combined`
