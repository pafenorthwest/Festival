## Summary

Build the Phase 0 backend surfaces that start after identity is established in issue #16: organizations, organization membership records, invitation primitives, and the first org-aware API endpoints.

## Scope

- Add application tables for `organization`, `organization_membership`, and `organization_invite`
- Support organization creation after authenticated user sync
- Support invite creation, invite lookup, and invite acceptance primitives
- Enforce unique organization names and short slugs
- Keep Firebase identity and base user sync out of scope because issue #16 already owns that layer

## Deliverables

- Hono endpoints for create organization, list current memberships, create invite, and load invite context
- Durable database model for organizations, memberships, and invitations
- Role assignment stored at the membership/invite layer
- Clear request/response contracts for the frontend integration work that follows

## Acceptance Criteria

- An authenticated user can create an organization and become its initial admin
- Admins can issue an invite with a role and email target
- Invite lookup returns enough data to drive invite acceptance UI
- Organization slug uniqueness is enforced
- Membership uniqueness prevents duplicate membership rows for the same user/org pair

## Notes

- Spec sources: `specs/Multi-Tenant-Starter.md`, `specs/ROADMAP-2026.md`
- Phase: `Phase 0`
- Ownership: `backend API`
