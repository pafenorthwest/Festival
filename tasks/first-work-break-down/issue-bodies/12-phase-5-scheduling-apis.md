## Summary

Implement the backend scheduling domain for rooms, time slots, and schedule assignments so festival registrations can be translated into a real-world schedule.

## Scope

- Model rooms, time slots, adjudicators, and schedule assignments
- Support manual assignment flows before any automated solver work
- Track audit history for schedule changes
- Provide export-ready schedule data

## Deliverables

- Backend tables/contracts for scheduling entities
- APIs to define rooms/slots and assign performers manually
- Audit trail support for scheduling changes
- Export-oriented read models for downstream PDF/CSV generation

## Acceptance Criteria

- Admins can define rooms and time slots through backend APIs
- Performers can be assigned manually to slots
- Schedule changes are auditable
- Schedule data can be exported in a structured form

## Notes

- Spec sources: `specs/ROADMAP-2026.md`
- Phase: `Phase 5`
- Ownership: `backend API`
