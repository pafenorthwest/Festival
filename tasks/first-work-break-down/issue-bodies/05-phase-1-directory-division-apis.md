## Summary

Build the backend operational model for teacher/accompanist profiles and configurable festival divisions so the system can support Phase 1 registration and later student discovery.

## Scope

- Add teacher and accompanist profile models with required operational fields
- Support configurable divisions as data, not hard-coded enums
- Support teacher multi-division membership through a join table
- Assign stable teacher colors for public disambiguation
- Expose admin APIs for division configuration and profile management

## Deliverables

- Tables and contracts for teacher profiles, accompanist profiles, divisions, and teacher-division links
- APIs to manage enabled divisions per organization/festival
- APIs to read and update teacher/accompanist operational profiles
- Stable color assignment logic for teacher records

## Acceptance Criteria

- Organizations can add default and custom divisions
- Teachers can belong to multiple divisions without schema shortcuts
- Teachers receive stable assigned colors
- Accompanist profiles store operational and discovery fields separately from billing state
- API contracts support later public/student discovery flows

## Notes

- Spec sources: `specs/Phase1-Account-Memberships.md`
- Phase: `Phase 1`
- Ownership: `backend API`
