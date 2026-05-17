# Phase Plan
- Task name: tenant-context-role-authorization
- Complexity: multi-surface
- Phase count: 5
- Active phases: 1..5
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=12; recommended-goals=6; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/tenant-context-role-authorization/complexity-signals.json
- Ranges: goals=5-8; phases=4-6

## Phase sequence

1. Repository/context support: expose the repository/service primitives needed for middleware to resolve app users and memberships without duplicating route logic.
2. Auth and tenant middleware: centralize Bearer parsing, verifier invocation, user upsert, org membership lookup, typed Hono variables, and role helpers.
3. Route integration: apply auth-only, tenant-context, and Admin-only gates to existing routes while keeping authorized response shapes stable.
4. Authorization tests: expand backend route coverage for unauthenticated, malformed/invalid token, member, wrong-tenant, non-admin, and context-driven handler behavior.
5. Final verification and closeout: run pinned lint/build/test, update task artifacts, and document any blockers.

## Drift guard

- Locked goals, success criteria, non-goals, scope, and verification commands must remain unchanged.
- Any need for schema migration, frontend redesign, new external dependency, or broader role matrix is scope drift and must stop implementation as `BLOCKED`.
