## Summary

Create the frontend/admin Phase 1 interfaces for division configuration and membership profile management, plus the teacher/accompanist-facing flows needed to complete early registration.

## Scope

- Build admin screens for division setup and enablement
- Build flows for teacher/accompanist profile capture and editing
- Support division selection for teachers and core operational fields for accompanists
- Reflect membership status supplied by Phase 1 backend APIs
- Follow the Skeleton-based style direction in `specs/Style.md`

## Deliverables

- Admin UI for configuring divisions before registration opens
- Teacher/accompanist profile forms connected to backend APIs
- Clear UI treatment for teacher colors and multi-division membership
- Validation and empty-state patterns consistent with the design system

## Acceptance Criteria

- Admins can configure enabled divisions from the UI
- Teachers can select one or more divisions
- Accompanists can complete their required public/operational profile fields
- The UI reflects membership state from backend responses
- The experience stays aligned with the Skeleton styling guidance

## Notes

- Spec sources: `specs/Phase1-Account-Memberships.md`, `specs/Style.md`
- Phase: `Phase 1`
- Ownership: `frontend UI`
