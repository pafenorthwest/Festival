# Database Auth Foundation

## Stage 2 readiness status

- Task name: `database-auth-foundation`
- Current stage: `prepare-takeoff`
- Readiness verdict: `READY FOR PLANNING`
- Locked goals source: `goals/database-auth-foundation/goals.v0.md`
- Locked goals iteration: v0
- Locked goals state: locked

## Goal lock assertion

Goals, non-goals, and success criteria are locked by user approval and validated by `goals-validate.sh`.
No reinterpretation, expansion, or relaxation is permitted in downstream stages.

## Ambiguity check

- Blocking ambiguities: none.
- Non-blocking assumptions are recorded in `goals/database-auth-foundation/establish-goals.v0.md`.
- User constraint carried forward: if any database table reference to organizations is required, the organization table name must be `orgs`.

## Locked goals snapshot

1. Add `app_user` Postgres schema support.
2. Add append-only `user_login_event` Postgres schema support.
3. Add required lookup/audit indexes and case-insensitive app-user email uniqueness.
4. Add Firebase Admin bearer-token verification for Hono handlers.
5. Add user repository functions and types for Firebase UID lookup, app-user upsert, and login-event insert.
6. Implement `POST /api/v1/auth/sync`.
7. Implement `POST /api/v1/auth/login-event`.
8. Implement `GET /api/v1/auth/me`.
9. Add focused automated coverage for new behavior and failure paths.
10. Run and record pinned lint, build, and test commands.

## Governing context

- Root contract: `AGENTS.md`
- Stage skills:
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `/Users/eric/.codex/skills/prepare-takeoff/SKILL.md`
- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Project structure authority: `.codex/project-structure.md`
- Bootstrap config: `.codex/codex-config.yaml`

## Environment and tooling notes

- Selected `CODEX_ROOT`: `/Users/eric/.codex/worktrees/4062/Festival/.codex`
- Selected `CODEX_SCRIPTS_DIR`: `/Users/eric/.codex/worktrees/4062/Festival/.codex/scripts`
- Worktree safety prep completed in existing detached-HEAD worktree.
- Stage 2 status summary at safety prep:
  - `M .codex/codex-config.yaml`
  - `M goals/task-manifest.csv`
  - `?? goals/database-auth-foundation/`
  - `?? tasks/database-auth-foundation/`
- Sandbox: workspace-write; writable root is `/Users/eric/.codex/worktrees/4062/Festival`.

## Verification Commands

Pinned by `.codex/project-structure.md` and root `package.json`.

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## IN SCOPE

- `packages/backend/src/**` changes required for Firebase Admin verification, auth middleware, user repository, auth routes, and Hono wiring.
- `packages/backend/tests/**` coverage for backend auth, user repository, migration/schema expectations, and auth endpoints.
- `packages/common/src/**` and `packages/common/tests/**` only if shared auth/user contracts are required by backend route responses or tests.
- Postgres migration/schema files in the repository's existing migration location, once identified during planning.
- Package metadata updates only if required to support locked backend behavior or tests.
- Task artifacts under `tasks/database-auth-foundation/**`.

## OUT OF SCOPE

- Organization creation, organization membership, invite, role, permission, or authorization logic.
- New organization-related database tables.
- Frontend authentication UI, Firebase client setup, landing page, invite flow, or session-routing UX.
- Auth providers beyond Firebase-supported Google SSO and email/password identity.
- Organization-aware session context.
- Unrelated formatting, refactors, dependency churn, or metadata updates.

## Execution posture lock

- Simplicity bias: downstream work must prefer the smallest implementation that satisfies locked goals.
- Surgical-change discipline: touch only approved in-scope files and behavior.
- Fail-fast error handling: impossible states and recoverable external failures must be explicit.
- Traceability: planned phases must map to locked goals, implementation must map to approved phases, and verification must map to implemented changes.

## Change control

- Locked goals, constraints, success criteria, non-goals, stage gate contract, and verification requirements cannot change during downstream stages.
- Any required goal or scope change must stop the active stage and return to the appropriate lifecycle gate for explicit approval.

## Drift hard gate

Drift policy from `AGENTS.md` is active for downstream stages:

- Stop on unauthorized changes to locked goals, constraints, success criteria, non-goals, stage contract, scope, touched surfaces, or verification requirements.
- Stop on completion declarations without satisfying locked criteria and verification, unless blockers are explicitly documented.
- Enforce per-stage progress budget: 45 minutes maximum wall-clock time, 5 maximum plan-attempt-observe-adjust cycles, and 2 maximum consecutive cycles without new evidence.

## Stage 2 verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: multi-surface
- Complexity scoring details: score=12; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/4062/Festival/tasks/database-auth-foundation/complexity-signals.json
- Active phases: 1..5
- No new scope introduced: required
