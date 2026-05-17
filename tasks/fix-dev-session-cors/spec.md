# Fix Dev Session CORS

## Overview
Restore local frontend-to-backend API access after PR #41 by adding explicit CORS handling for the backend API surface used by the Vite dev server.

## Goals
- G1: Restore local browser access from `http://localhost:5173` to backend API routes, including `GET /api/session`, by returning valid CORS preflight and response headers.
- G2: Keep the CORS policy explicit and scoped so it does not silently allow arbitrary production origins.
- G3: Cover the `/api/session` preflight behavior with a backend test.
- G4: Verify the change with the repository's lint, build, and test command classes.

## Non-goals
- Do not redesign Firebase authentication or session semantics.
- Do not change organization, invite, or membership business behavior.
- Do not introduce a proxy or deployment architecture change.

## Use cases / user stories
- As a local developer using the Vite frontend at `http://localhost:5173`, I can load session state from the Bun backend at `http://localhost:3000` without browser CORS failures.

## Current behavior
- Notes: `GET /api/session` may be called with JSON content headers and an optional Firebase bearer token. Browser preflight requests from the frontend dev origin fail because the backend does not return CORS headers.
- Key files:
  - `packages/backend/src/app.ts`
  - `packages/backend/tests/auth-routes.test.ts`

## Proposed behavior
- Behavior changes: Add explicit Hono CORS middleware for API routes with a default local-development allowlist.
- Edge cases: Unconfigured origins must not receive wildcard CORS access.

## Technical design
### Architecture / modules impacted
- `packages/backend/src/app.ts`: central backend app middleware setup.
- `packages/backend/tests/auth-routes.test.ts`: auth/API route behavior coverage.

### API changes (if any)
- No route contract changes.

### UI/UX changes (if any)
- No UI changes.

### Data model / schema changes (PostgreSQL)
- Migrations: none.
- Backward compatibility: existing API responses remain unchanged except for CORS headers.
- Rollback: remove the CORS middleware and tests.

## Security & privacy
- CORS allowlist remains explicit. Default local origins are intended for development only and do not use `*`.

## Observability (logs/metrics)
- No new logs or metrics.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run lint`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: backend route tests for CORS preflight and allowed/disallowed origins.
- Integration: full repository test command.
- E2E / UI (if applicable): not required for this backend header fix.

## Acceptance criteria checklist
- [ ] `OPTIONS /api/session` from `http://localhost:5173` succeeds with matching CORS allow-origin header.
- [ ] `GET /api/session` from `http://localhost:5173` includes matching CORS allow-origin header.
- [ ] Unknown origins do not receive wildcard CORS allow-origin.
- [ ] `bun run lint`, `bun run build`, and `bun run test` pass or blockers are documented.

## IN SCOPE
- `packages/backend/src/app.ts`
- `packages/backend/tests/auth-routes.test.ts`
- Lifecycle artifacts under `goals/fix-dev-session-cors/` and `tasks/fix-dev-session-cors/`

## OUT OF SCOPE
- Frontend auth flow redesign.
- Firebase provider configuration changes.
- Database schema changes.
- Deployment or reverse proxy changes.

## Takeoff State
- Goals source: `goals/fix-dev-session-cors/goals.v0.md`
- Goal lock verdict: `GOALS LOCKED`
- Stage 2 verdict: `READY FOR PLANNING`
- Worktree: existing detached HEAD worktree.
- Dirty-worktree decision: continue. Current dirty entries are lifecycle artifacts created for this task and `.codex/codex-config.yaml` bootstrap override.
- Governing context: `AGENTS.md`, `.codex/rules/expand-task-spec.rules`, `.codex/rules/git-safe.rules`.
- Execution posture: simplicity bias, surgical changes, and fail-fast error handling are locked for downstream stages.
- Change control: goal, constraint, success criteria, and scope changes require relock before implementation.

## Implementation phase strategy
- Complexity: surgical
- Complexity scoring details: score=4; recommended-goals=2; guardrails-all-true=true; signals=/Users/eric/.codex/worktrees/d201/Festival/tasks/fix-dev-session-cors/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
