# Phase 0 Organization Membership Foundation API

## Overview
Implement GitHub issue #20: Phase 0 backend organization and membership foundation API.

Stage 2 goal lock assertion: goals are locked in `goals/phase-0-organization-membership-foundation-api/goals.v0.md` with state `locked`. No reinterpretation, expansion, or relaxation is permitted downstream without returning to the goal stage.

Ambiguity check: no blocking ambiguity remains. Issue #20 and the referenced specs define enough backend behavior to proceed.

Existing-worktree safety prep: completed by `prepare-takeoff-worktree.sh` for this task. Dirty-worktree decision: `continue`, because uncommitted entries are ACAC bootstrap/config, goal artifacts, and this task scaffold created for the active lifecycle.

Governing context:
- Rules: `AGENTS.md`, `.codex/rules/expand-task-spec.rules`, `.codex/rules/git-safe.rules`.
- Skills: `acac`, `establish-goals`, `prepare-takeoff`, then downstream `prepare-phased-impl`, `implement`, and `land-the-plan`.
- Sandbox: workspace-write; network restricted.

## Goals
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

## Non-goals
- Do not implement Firebase identity setup or base app-user sync beyond using the existing issue #16-owned auth/user surfaces.
- Do not implement issue #21's full tenant context middleware, reusable role authorization abstraction, cross-tenant middleware policy, or Firebase key caching.
- Do not implement issue #22 frontend integration or UI behavior.
- Do not implement Shopify, Stripe, commerce memberships, family/parent identity, or Phase 1 features.
- Do not redesign unrelated API surfaces outside the minimum needed for issue #20's backend contracts.

## Use cases / user stories
- An authenticated user creates an organization and becomes its initial Admin member.
- An Admin member creates an invite for a target email and role.
- A caller can load invite context by token for later invite acceptance UI.
- An authenticated invitee accepts an invite and receives the invited role.
- An authenticated user can list current organization memberships for later routing/session decisions.

## Current behavior
- Notes: repository already contains partial org/invite backend surfaces, in-memory and Postgres repositories, and route tests. Downstream stages must inspect them before deciding what changes are necessary.
- Key files:
  - `packages/common/src/organization.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/services/organization-service.ts`
  - `packages/backend/src/repo/organization-repository.ts`
  - `packages/backend/src/repo/in-memory-organization-repository.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/tests/organization-routes.test.ts`

## Proposed behavior
- Stage 2 does not define implementation design. Downstream planning must map changes to the locked goals.
- Edge cases to account for downstream: duplicate organization name/slug, duplicate membership for same user/org, unauthenticated organization or invite creation, non-member invite creation, unknown invite token, already accepted/duplicate invite acceptance, and invalid cross-org acceptance behavior.

## Technical design
### Architecture / modules impacted
- To be planned in Stage 3 only.

### API changes (if any)
- To be planned in Stage 3 only.

### UI/UX changes (if any)
- None expected; frontend integration is out of scope.

### Data model / schema changes (PostgreSQL)
- Migrations: to be planned in Stage 3 only.
- Backward compatibility: to be planned in Stage 3 only.
- Rollback: to be planned in Stage 3 only.

## Security & privacy
- Use existing Firebase bearer token verification interfaces for authenticated backend calls.
- Keep secrets in environment variables only.
- Do not absorb issue #21's full tenant middleware scope, but do prevent unauthorized invite creation within issue #20 behavior.

## Observability (logs/metrics)
- No new observability requirements identified for Stage 2. Downstream stages may add narrowly scoped logs only if needed for fail-fast diagnosis.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: common contract/validation tests where shared contract changes are made.
- Integration: backend route/service/repository tests for organization creation, uniqueness, membership listing, invite creation, invite lookup, invite acceptance, and auth error cases.
- E2E / UI (if applicable): not applicable; issue #22 owns frontend integration.

## Acceptance criteria checklist
- [ ] Shared TypeScript contracts describe backend request/response payloads and compile across backend/common packages.
- [ ] Runtime repository initialization creates or verifies durable org, membership, and invite tables/constraints without manual SQL outside the app setup path.
- [ ] Duplicate organization name or slug returns a conflict/error instead of creating a duplicate.
- [ ] Duplicate membership for the same user/org is prevented.
- [ ] Authenticated organization creation returns an Admin membership.
- [ ] Authenticated membership listing returns organization identity and role.
- [ ] Admin invite creation works; non-member or unauthenticated callers cannot create invites.
- [ ] Invite lookup returns organization name/slug, invited email, role, and acceptance/status data; unknown tokens return not found.
- [ ] Invite acceptance creates or reuses the invited organization membership, applies the invite role, marks the invite accepted, and prevents invalid duplicate/cross-org acceptance behavior.
- [ ] `bun run format:check`, `bun run build`, and `bun run test` pass or blockers are documented with evidence.

## IN SCOPE
- `packages/common/src/**`
- `packages/common/tests/**`
- `packages/backend/src/routes/**`
- `packages/backend/src/services/**`
- `packages/backend/src/repo/**`
- `packages/backend/tests/**`
- Task artifacts under `tasks/phase-0-organization-membership-foundation-api/**`
- Goal artifacts under `goals/phase-0-organization-membership-foundation-api/**`

## OUT OF SCOPE
- Frontend UI and Firebase client integration.
- Issue #21 tenant middleware/role abstraction/key caching beyond minimal issue #20 authorization behavior.
- Issue #16 Firebase identity setup and base app-user sync.
- Shopify, Stripe, commerce memberships, family/parent identity, and Phase 1 features.
- Unrelated route, styling, or product changes.

## Execution Posture Lock
- Simplicity bias: locked.
- Surgical-change rule: locked.
- Fail-fast error handling: locked.
- Traceability: downstream planned phase work must map to these locked goals; implemented changes must map to approved phase work; verification evidence must map to implemented changes.

## Change Control
- Locked goals, constraints, non-goals, and success criteria cannot change in downstream stages.
- Any required change must stop the active stage and return to `establish-goals` for explicit user approval and relock.
- Drift hard gate applies with the ACAC progress budget: 45 minutes per stage, 5 maximum plan/attempt/observe/adjust cycles, and 2 maximum consecutive cycles without new evidence.

## Stage 2 Verdict
READY FOR PLANNING

## Implementation phase strategy
- Complexity: multi-surface
- Complexity scoring details: score=10; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/b904/Festival/tasks/phase-0-organization-membership-foundation-api/complexity-signals.json
- Active phases: 1..5
- No new scope introduced: required
