# Tenant Context Role Authorization

## Overview
Implement GitHub issue #21 under the locked ACAC goals for Phase 0 backend tenant context and role authorization middleware.

Stage 2 status: READY FOR PLANNING.

## Goals
Locked goals source: `/Users/eric/pafenorthwest/Festival/goals/tenant-context-role-authorization/goals.v0.md` (`State: locked`).

1. Add shared backend middleware or helper composition that verifies Bearer JWTs, resolves the authenticated application user, resolves org membership for org-scoped routes, and attaches tenant and role context to Hono request variables for handler use.
2. Add role authorization helpers so routes can require Admin membership or any explicitly allowed role list without duplicating role comparison and failure response logic in each handler.
3. Apply tenant context and role authorization to existing org-scoped backend routes so valid members can access their organizations, non-members are rejected, and Admin-only invite creation rejects lower-privilege members.
4. Preserve JWT verification efficiency by keeping Firebase verifier/app setup outside per-request middleware execution and avoiding new per-request Firebase key/client initialization.
5. Add or update backend tests that cover unauthenticated org-scoped requests, malformed/invalid auth, valid member access, wrong-tenant access, Admin-only rejection for non-admin members, and availability of resolved tenant/role context to handlers.
6. Keep public contracts and route behavior stable except for the stricter, explicit authorization failures required by issue #21.

## Non-goals
- Do not add new Phase 1 membership, Shopify, payment, or customer-account behavior.
- Do not redesign frontend routing or UI beyond adjustments strictly required by backend response changes.
- Do not replace Firebase authentication or introduce a separate identity provider.
- Do not introduce broad role-permission matrices beyond the Phase 0 Admin vs lower-privilege gates required by the issue.

## Use cases / user stories
- As an authenticated org member, I can access my org-scoped routes with resolved tenant and role context.
- As a lower-privilege org member, I am rejected from Admin-only routes.
- As a user outside an org, I cannot access that org's data.

## Current behavior
- Notes:
  - Existing routes use auth middleware for JWT verification.
  - Some membership and role checks exist inside `OrganizationService`.
  - Tenant context is not attached centrally to Hono request variables for org-scoped handlers.
- Key files:
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/auth/types.ts`
  - `packages/backend/src/auth/firebase-auth-verifier.ts`
  - `packages/backend/src/services/organization-service.ts`
  - `packages/backend/src/repo/organization-repository.ts`
  - `packages/backend/tests/organization-routes.test.ts`
  - `packages/common/src/organization.ts`

## Proposed behavior
- Behavior changes:
  - To be planned in Stage 3 from locked goals only.
- Edge cases:
  - To be planned in Stage 3 from locked success criteria only.

## Technical design
### Architecture / modules impacted
- To be planned in Stage 3.

### API changes (if any)
- No public contract expansion is currently authorized before Stage 3 planning.

### UI/UX changes (if any)
- None expected.

### Data model / schema changes (PostgreSQL)
- Migrations: none expected.
- Backward compatibility: authorized responses should keep existing shapes.
- Rollback: to be defined if Stage 3 identifies a code rollback need.

## Security & privacy
- Tenant isolation, explicit authentication failures, and role authorization are the core security requirements.

## Observability (logs/metrics)
- No new observability requirement is locked.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: backend middleware/helper tests if introduced as isolated units.
- Integration: backend route tests for org-scoped authentication, tenant isolation, and role gates.
- E2E / UI (if applicable): not in scope unless required by a backend contract change.

## Acceptance criteria checklist
- [ ] [G1] Org-scoped middleware sets typed request context containing authenticated identity, app user, organization, membership, and role before protected handlers run.
- [ ] [G2] Role helper tests or route tests demonstrate that non-admin roles receive a forbidden response from Admin-only routes.
- [ ] [G3] Route tests demonstrate cross-tenant access attempts fail consistently and do not return the requested organization's data.
- [ ] [G4] Firebase verifier/app construction remains outside request handlers/middleware, and tests or code inspection show request handling calls the injected verifier rather than constructing Firebase clients per request.
- [ ] [G5] Backend tests cover unauthenticated, malformed/invalid token, wrong-tenant, lower-privilege, and allowed-member cases for org-scoped authorization.
- [ ] [G6] Existing API response shapes remain compatible where access is authorized.
- [ ] `bun run format:check`, `bun run build`, and `bun run test` pass, or blockers are documented with exact command output.

## IN SCOPE
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/auth/**`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/tests/**`
- `packages/common/src/organization.ts` only if shared types need a narrow update for typed tenant context.
- Task artifacts under `tasks/tenant-context-role-authorization/`.

## OUT OF SCOPE
- Frontend UI redesign.
- Shopify, Stripe, Phase 1 membership, payment, customer-account, or registration behavior.
- Database schema migrations unless Stage 3 proves they are necessary for the locked goals.
- Replacement of Firebase authentication.
- Broad role permission matrix or policy engine beyond Phase 0 Admin vs allowed-role checks.
- Unrelated `.codex/scripts/gh-wrap.sh` modifications already present in the dirty worktree.

## Stage 2 readiness notes

- Bootstrap: `.codex/scripts/prepare-takeoff-bootstrap.sh` selected `CODEX_ROOT=/Users/eric/pafenorthwest/Festival/.codex` and `CODEX_SCRIPTS_DIR=/Users/eric/pafenorthwest/Festival/.codex/scripts`.
- Worktree safety: `.codex/scripts/prepare-takeoff-worktree.sh tenant-context-role-authorization` completed; branch is `main` and protected-branch warning was reported.
- Dirty-worktree decision: continue. Stage-created/updated files are `.codex/codex-config.yaml`, `goals/task-manifest.csv`, `goals/tenant-context-role-authorization/**`, and `tasks/tenant-context-role-authorization/**`; pre-existing unrelated `.codex/scripts/gh-wrap.sh` modification must be preserved and excluded from this task scope.
- Governing context: `AGENTS.md`, `.codex/rules/expand-task-spec.rules`, `.codex/rules/git-safe.rules`, and lifecycle skills under `/Users/eric/.codex/skills/`.
- Ambiguity check: no blocking ambiguity remains after user approved locked goals.
- Execution posture: downstream stages must use simplicity bias, surgical-change discipline, and fail-fast error handling.
- Change control: locked goals, constraints, success criteria, non-goals, scope, and verification commands cannot be changed without stopping for explicit user relock/approval.
- Drift hard gate: any unauthorized goal, scope, verification, touched-surface, or completion-integrity drift must stop the active stage as `BLOCKED`.

## Stage 2 verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: multi-surface
- Complexity scoring details: score=12; recommended-goals=6; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/tenant-context-role-authorization/complexity-signals.json
- Active phases: 1..5
- No new scope introduced: required
