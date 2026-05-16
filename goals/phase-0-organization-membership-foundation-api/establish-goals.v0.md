# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): phase-0-organization-membership-foundation-api

## Request restatement

- Implement GitHub issue #20 by building the Phase 0 backend organization and membership foundation API: durable organization, membership, and invite persistence; authenticated organization creation; invite creation, lookup, and acceptance primitives; uniqueness enforcement; and clear contracts for later frontend integration.

## Context considered

- Repo/rules/skills consulted: AGENTS.md ACAC lifecycle contract; /Users/eric/.codex/skills/acac/SKILL.md; /Users/eric/.codex/skills/establish-goals/SKILL.md.
- Relevant external context: GitHub issue #20, "Phase 0 Backend: Organization and Membership Foundation API"; issue has no comments.
- Dependency context considered: issue #16 owns Firebase identity and base app-user sync; issue #21 owns tenant context and role authorization middleware; issue #22 owns later frontend integration.
- Relevant specs: specs/Multi-Tenant-Starter.md and specs/ROADMAP-2026.md.
- Relevant files inspected read-only: packages/common/src/organization.ts, packages/backend/src/app.ts, packages/backend/src/routes/api-router.ts, packages/backend/src/routes/auth-router.ts, packages/backend/src/services/organization-service.ts, packages/backend/src/repo/organization-repository.ts, packages/backend/src/repo/in-memory-organization-repository.ts, packages/backend/src/repo/postgres-organization-repository.ts, packages/backend/tests/organization-routes.test.ts.
- Constraints (sandbox, commands, policy): workspace-write sandbox; no downstream planning or implementation until goals are approved and locked; downstream verification must include pinned lint, build, and test command classes.

## Ambiguities

### Blocking (must resolve)

1. None. Issue #20 and the referenced specs define enough backend behavior to lock goals.

### Non-blocking (can proceed with explicit assumptions)

1. The repository may use its current API route prefix and naming conventions unless downstream planning discovers a pinned command/spec record requiring exact `/api/v1/...` route names.
2. The durable database model should align with the repository's existing app-user/auth sync surfaces while adding or correcting org, membership, and invite persistence needed for issue #20.
3. Issue #21-level shared tenant middleware and comprehensive role gate abstraction are not required here, but issue #20 can enforce the minimal admin check needed for invite creation.
4. Issue #22 frontend behavior is a consumer of this work, not part of this implementation scope.

## Questions for user

1. None before goal approval.

## Assumptions (explicit; remove when confirmed)

1. Authenticated backend calls should continue to use Firebase ID token bearer verification through existing auth verifier interfaces.
2. Organization uniqueness must be enforced for route-facing short slug/name values in both service validation and durable persistence where practical.
3. Membership uniqueness must prevent duplicate rows for the same user/organization pair, while preserving future room for users to belong to multiple organizations if the schema supports it.
4. Invite lookup must return enough organization, email, role, status/acceptance context for the later issue #22 invite UI to render.

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

## Risks / tradeoffs

- Existing code already implements partial org/invite behavior; downstream implementation should preserve working behavior while closing gaps rather than rewriting the subsystem wholesale.
- The current repository model may differ from the spec's illustrative names such as `organization_membership` or `/api/v1/...`; compatibility with repo conventions should be weighed against spec alignment during planning.
- Full tenant isolation belongs to issue #21, so this task should avoid absorbing that scope while still preventing obvious unauthorized invite creation.

## Next action

- GOALS LOCKED. Handoff: prepare-takeoff owns task scaffolding and spec.md readiness content.
