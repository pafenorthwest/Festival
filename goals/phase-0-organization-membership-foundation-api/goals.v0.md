# Goals Extract
- Task name: phase-0-organization-membership-foundation-api
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Define or update shared organization, membership, invite, request, and response contracts needed by the Phase 0 backend organization API.
2. Provide durable Postgres persistence for organizations, organization memberships, and organization invites, including migrations/initialization compatible with the repository's current runtime setup.
3. Enforce organization name/slug uniqueness in the backend so duplicate organization creation fails consistently.
4. Enforce membership uniqueness for the same user and organization so duplicate membership rows cannot be created for one user/org pair.
5. Support authenticated organization creation after user sync/hydration, creating the organization and making the authenticated user its initial Admin membership.
6. Support listing the authenticated user's current organization memberships through a backend API contract suitable for later routing/session use.
7. Support Admin invite creation with email target and role assignment stored at the invite layer.
8. Support invite lookup by token that returns enough organization, invited email, role, and invite status data to drive the invite acceptance UI.
9. Support invite acceptance primitives that bind an authenticated user to the invited organization membership with the invite's role and mark the invite accepted.
10. Add or update focused backend/common tests for organization creation, uniqueness failures, membership uniqueness, membership listing, invite creation, invite lookup, invite acceptance, and authenticated/unauthenticated error cases.


## Non-goals (explicit exclusions)

- Do not implement Firebase identity setup or base app-user sync beyond using the existing issue #16-owned auth/user surfaces.
- Do not implement issue #21's full tenant context middleware, reusable role authorization abstraction, cross-tenant middleware policy, or Firebase key caching.
- Do not implement issue #22 frontend integration or UI behavior.
- Do not implement Shopify, Stripe, commerce memberships, family/parent identity, or Phase 1 features.
- Do not redesign unrelated API surfaces outside the minimum needed for issue #20's backend contracts.


## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] Shared TypeScript contracts describe the backend request/response payloads used for organizations, memberships, and invites, and compile across backend/common packages.
- [G2] Runtime repository initialization creates or verifies durable org, membership, and invite tables/constraints without requiring manual SQL outside the app's existing setup path.
- [G3] Creating an organization with an already-used name or slug returns a conflict/error instead of creating a duplicate.
- [G4] Attempting to create a duplicate membership for the same user/org is prevented by service logic, persistence constraints, or both.
- [G5] An authenticated user can create an organization and receives an Admin membership in the response.
- [G6] An authenticated user can list their current organization memberships through an API response that includes organization identity and role.
- [G7] An Admin member can create an invite containing target email and role; a non-member or unauthenticated caller cannot create one.
- [G8] Invite lookup by token returns organization name/slug, invited email, role, and acceptance/status data; unknown tokens return a clear not-found response.
- [G9] Invite acceptance creates or reuses the authenticated user's membership for the invited organization, applies the invite role, marks the invite accepted, and prevents invalid duplicate/cross-org acceptance behavior.
- [G10] Relevant backend/common tests pass, and the pinned lint, build, and test command classes are run or explicitly blocked with evidence.

