## Summary

Take the UI scaffold from issue #15 and connect it to real Firebase authentication and the Phase 0 org APIs so onboarding becomes functional instead of mock-only.

## Scope

- Replace placeholder auth actions with Firebase sign-in flows
- Call backend APIs to sync user, create organizations, and accept invites
- Route authenticated users to the correct org landing page when memberships exist
- Surface create-org and invite-accept errors in the UI
- Preserve the route structure and visual foundation already defined in issue #15

## Deliverables

- Functional onboarding flow from `/` to org creation or existing-org landing
- Invite acceptance flow that binds the authenticated user to the invited membership
- Real org landing page data loading for org name and role
- Clear loading/error states for auth and org API calls

## Acceptance Criteria

- A new authenticated user without a membership is routed to org creation
- A user with an existing membership lands on the correct `/o/:shortOrgName` page
- Invite acceptance uses real backend data instead of placeholders
- Frontend calls use the same auth token model as the backend Phase 0 APIs
- The scaffolded routes from issue #15 remain intact

## Notes

- Dedup: issue #15 remains the UI-only scaffold; this issue starts at integration
- Spec sources: `specs/Multi-Tenant-Starter.md`, `specs/Style.md`, `specs/ROADMAP-2026.md`
- Phase: `Phase 0`
- Ownership: `frontend UI`
