## Summary

Build the Phase 5 admin interface for manual scheduling so staff can assign performers, adjust schedules quickly, and export the resulting plan.

## Scope

- Create views for rooms, time slots, and assignments
- Support manual assignment and reassignment workflows
- Expose export actions for PDF/CSV schedule outputs
- Keep the experience override-friendly rather than over-automated

## Deliverables

- Scheduling workspace UI for defining and editing assignments
- Operator-friendly affordances for reassignments and overrides
- Export triggers aligned with scheduling backend outputs

## Acceptance Criteria

- Admins can assign performers to slots from the UI
- Manual changes are easy to make without rebuilding schedules
- Export actions are available from the scheduling workspace
- The workflow does not depend on an automated solver

## Notes

- Spec sources: `specs/ROADMAP-2026.md`, `specs/Style.md`
- Phase: `Phase 5`
- Ownership: `frontend UI`
