# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): fix-dev-session-cors

## Request restatement

- After merging PR #41, the frontend served from `http://localhost:5173` fails to fetch `http://localhost:3000/api/session` because the backend does not return CORS headers for the browser preflight. Firebase popup auth also logs a `Cross-Origin-Opener-Policy` warning in the browser console.

## Context considered

- Repo/rules/skills consulted: `AGENTS.md`, `establish-goals` skill, `.codex/codex-config.yaml`
- Relevant files (if any): `packages/backend/src/app.ts`, `packages/backend/src/routes/api-router.ts`, `packages/backend/src/routes/auth-router.ts`, `packages/frontend/src/lib/api.ts`, `packages/frontend/src/lib/firebase-auth.ts`, `packages/backend/tests/auth-routes.test.ts`, `package.json`
- Constraints (sandbox, commands, policy): workspace-write sandbox; source changes must be scoped to the reported auth/session browser errors; lint, build, and test verification are required.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. The reported frontend origin is the local Vite dev server at `http://localhost:5173`.
2. The reported backend origin is the local Bun backend at `http://localhost:3000`.
3. The Firebase popup warning should be addressed only if the existing server headers directly cause it; otherwise it remains outside this fix.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. Local development should allow cross-origin browser requests from `localhost:5173` to the backend API.
2. The fix should not broadly change organization/auth business behavior.
3. Production CORS policy should remain conservative unless existing configuration already defines allowed origins.

## Goals (1-20, verifiable)

1. Restore local browser access from `http://localhost:5173` to backend API routes, including `GET /api/session`, by returning valid CORS preflight and response headers.
2. Keep the CORS policy explicit and scoped so it does not silently allow arbitrary production origins.
3. Cover the `/api/session` preflight behavior with a backend test.
4. Verify the change with the repository's lint, build, and test command classes.

## Non-goals (explicit exclusions)

- Do not redesign Firebase authentication or session semantics.
- Do not change organization, invite, or membership business behavior.
- Do not introduce a proxy or deployment architecture change.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] An `OPTIONS` preflight request for `/api/session` from `http://localhost:5173` with `Authorization` and `Content-Type` request headers receives a successful CORS response including `Access-Control-Allow-Origin: http://localhost:5173`.
- [G1] A normal `/api/session` response to `Origin: http://localhost:5173` includes the matching CORS allow-origin header.
- [G2] A request from an unconfigured origin does not receive a permissive wildcard allow-origin header.
- [G3] Backend tests include the local dev preflight case.
- [G4] Lint, build, and test commands complete successfully or any blocker is documented with exact command output.

## Risks / tradeoffs

- CORS changes can become too broad if implemented as a wildcard. The implementation should use explicit allowed origins and include only local dev origins by default.

## Next action

- Ready to lock
