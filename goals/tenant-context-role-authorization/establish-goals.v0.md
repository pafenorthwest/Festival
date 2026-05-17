# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): tenant-context-role-authorization

## Request restatement

- Implement GitHub issue #21, "Phase 0 Backend: Tenant Context and Role Authorization Middleware", by adding backend tenant-aware request context, shared authorization middleware/helpers, role enforcement, and verification coverage for org-scoped APIs.

## Context considered

- Repo/rules/skills consulted: `AGENTS.md`, `/Users/eric/.codex/skills/acac/SKILL.md`, `/Users/eric/.codex/skills/establish-goals/SKILL.md`, `.codex/codex-config.yaml`, `.codex/project-structure.md`, GitHub issue #21.
- Relevant files (if any): `specs/ROADMAP-2026.md`, `specs/Multi-Tenant-Starter.md`, `packages/backend/src/routes/api-router.ts`, `packages/backend/src/auth/types.ts`, `packages/backend/src/auth/firebase-auth-verifier.ts`, `packages/backend/src/services/organization-service.ts`, `packages/backend/src/repo/organization-repository.ts`, `packages/backend/tests/organization-routes.test.ts`, `packages/common/src/organization.ts`.
- Constraints (sandbox, commands, policy): ACAC lifecycle order is mandatory; no implementation or planning before goal approval and lock; canonical verification commands are `bun run format:check`, `bun run build`, and `bun run test`; source changes must remain scoped to backend/common surfaces required for issue #21.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. GitHub issue #21 says it depends on issue #16 and the organization/membership foundation issue. Existing code already contains organization, membership, invite, and auth foundations sufficient to implement middleware without blocking on additional upstream work.
2. The issue asks to "cache Firebase verification keys and avoid remote key fetch on every request"; because Firebase Admin SDK owns key retrieval internally, the implementable target is to ensure the app does not create a new Firebase app/auth verifier per request and to preserve or test a stable verifier path that avoids per-request verifier/key setup.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. Org-scoped routes are identified by an organization route parameter, currently `:slug`, and route handlers should receive resolved organization, membership, user, and role context from middleware.
2. The Admin role is the only Phase 0 admin-only role; all other roles are lower privilege unless explicitly allowed by a route policy.
3. Wrong-tenant requests should fail consistently with an authorization failure status and error body, without exposing data from the requested organization.

## Goals (1-20, verifiable)

1. Add shared backend middleware or helper composition that verifies Bearer JWTs, resolves the authenticated application user, resolves org membership for org-scoped routes, and attaches tenant and role context to Hono request variables for handler use.
2. Add role authorization helpers so routes can require Admin membership or any explicitly allowed role list without duplicating role comparison and failure response logic in each handler.
3. Apply tenant context and role authorization to existing org-scoped backend routes so valid members can access their organizations, non-members are rejected, and Admin-only invite creation rejects lower-privilege members.
4. Preserve JWT verification efficiency by keeping Firebase verifier/app setup outside per-request middleware execution and avoiding new per-request Firebase key/client initialization.
5. Add or update backend tests that cover unauthenticated org-scoped requests, malformed/invalid auth, valid member access, wrong-tenant access, Admin-only rejection for non-admin members, and availability of resolved tenant/role context to handlers.
6. Keep public contracts and route behavior stable except for the stricter, explicit authorization failures required by issue #21.

## Non-goals (explicit exclusions)

- Do not add new Phase 1 membership, Shopify, payment, or customer-account behavior.
- Do not redesign frontend routing or UI beyond adjustments strictly required by backend response changes.
- Do not replace Firebase authentication or introduce a separate identity provider.
- Do not introduce broad role-permission matrices beyond the Phase 0 Admin vs lower-privilege gates required by the issue.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] Org-scoped middleware sets typed request context containing authenticated identity, app user, organization, membership, and role before protected handlers run.
- [G2] Role helper tests or route tests demonstrate that non-admin roles receive a forbidden response from Admin-only routes.
- [G3] Route tests demonstrate cross-tenant access attempts fail consistently and do not return the requested organization's data.
- [G4] Firebase verifier/app construction remains outside request handlers/middleware, and tests or code inspection show request handling calls the injected verifier rather than constructing Firebase clients per request.
- [G5] Backend tests cover unauthenticated, malformed/invalid token, wrong-tenant, lower-privilege, and allowed-member cases for org-scoped authorization.
- [G6] Existing API response shapes remain compatible where access is authorized.
- [Verification] `bun run format:check`, `bun run build`, and `bun run test` pass, or any blocker is documented with exact command output.

## Risks / tradeoffs

- Existing service methods currently perform some membership checks internally; moving checks into middleware must avoid duplicate user upserts where practical while keeping the change scoped.
- Some routes are authenticated but not org-scoped, such as organization creation and membership listing; those should keep auth-only behavior rather than requiring a current org.
- Tightening status codes for wrong-tenant access may require updating existing tests that expected a service-level not-found response.

## Next action

- GOALS LOCKED. Handoff: prepare-takeoff owns task scaffolding and `spec.md` readiness content.
