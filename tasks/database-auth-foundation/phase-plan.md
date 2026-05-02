# Phase Plan
- Task name: database-auth-foundation
- Complexity: multi-surface
- Phase count: 5
- Active phases: 1..5
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=12; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/4062/Festival/tasks/database-auth-foundation/complexity-signals.json
- Ranges: goals=5-8; phases=4-6

## Phase sequence

1. Schema and app-user repository foundation
   - Goals: G1, G2, G3, G5
   - Primary surfaces: backend Postgres repository/migration code and repository tests.
2. Firebase bearer auth and Hono context foundation
   - Goals: G4
   - Primary surfaces: backend auth verifier/types, middleware/context typing, and auth failure tests.
3. Auth API routes and app wiring
   - Goals: G6, G7, G8
   - Primary surfaces: backend auth routes, app/router wiring, and test in-memory auth repository seam.
4. Focused automated coverage and schema assertions
   - Goals: G9
   - Primary surfaces: backend tests and any narrow common contract tests required by response typing.
5. Hardening and full verification
   - Goals: G10 plus final checks for G1-G9
   - Primary surfaces: task final-phase evidence and any minimal fixes required by verification output.

## Drift guard

- Do not add organization, membership, invite, role, permission, frontend, or organization-aware session behavior.
- Do not introduce new organization-related database tables.
- If any incidental organization table reference is unavoidable, it must use `orgs`.
- Do not alter `## IN SCOPE` or `## OUT OF SCOPE` in `spec.md` after `.scope-lock.md`.
