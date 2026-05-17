# Goals Extract
- Task name: fix-dev-session-cors
- Iteration: v0
- State: locked

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

