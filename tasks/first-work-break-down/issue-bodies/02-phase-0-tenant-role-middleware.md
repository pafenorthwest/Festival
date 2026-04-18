## Summary

Implement tenant-aware request context and role enforcement for Phase 0 so org-scoped APIs can safely resolve the current organization and reject cross-tenant access.

## Scope

- Resolve current org and membership from authenticated requests
- Attach org context and role data to Hono middleware
- Enforce role gates for admin vs lower-privilege roles
- Cache Firebase verification keys and avoid remote key fetch on every request
- Reject requests that target organizations the caller does not belong to

## Deliverables

- Shared middleware for JWT verification + org membership resolution
- Authorization helpers for role-based endpoint protection
- Explicit tenant-isolation checks for org-scoped routes
- Failure responses for unauthenticated, unauthorized, and wrong-tenant requests

## Acceptance Criteria

- All org-scoped endpoints require a valid JWT and active membership
- Admin-only routes reject non-admin members
- Cross-tenant access attempts fail consistently
- Role and tenant context are available to handlers without duplicating lookup logic
- JWT verification avoids an external key fetch on every request

## Notes

- Depends on issue #16 and the organization/membership foundation issue
- Spec sources: `specs/ROADMAP-2026.md`
- Phase: `Phase 0`
- Ownership: `backend API`
