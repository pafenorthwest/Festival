# Phase 3 — Auth API Routes and App Wiring

## Objective
Implement the three required `/api/v1/auth/*` endpoints and wire them into the Hono app using the auth and repository foundations.

## Code areas impacted
- `packages/backend/src/routes/**`
- `packages/backend/src/app.ts`
- `packages/backend/src/repo/**`
- `packages/backend/tests/**`
- `packages/common/src/**` only if shared response/input contracts are needed.

## Work items
- [ ] Add `POST /api/v1/auth/sync` to verify Firebase identity, create/update `app_user`, and return the canonical user payload.
- [ ] Add `POST /api/v1/auth/login-event` to verify identity, require an existing synced app user, validate provider, capture IP/user-agent, insert one login event, and return `{ "status": "ok" }`.
- [ ] Add `GET /api/v1/auth/me` to verify identity, require an existing synced app user, and return the canonical user payload.
- [ ] Wire auth routes under `/api/v1/auth` while preserving existing route behavior.
- [ ] Add app construction injection points only where required for deterministic route tests.

## Deliverables
- Auth route module or equivalent router entries.
- App/router wiring for `/api/v1/auth/sync`, `/api/v1/auth/login-event`, and `/api/v1/auth/me`.
- Route tests for create, update, login-event, me, and failure paths.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [ ] All three endpoints return the response envelopes required by issue #16.
- [ ] Login-event and me fail when the app user has not been synced.
- [ ] Existing organization/session routes still compile and tests remain valid.

## Verification steps
List exact commands and expected results.
- [ ] Command: `bun run --cwd packages/backend test`
  - Expected: backend route tests pass, including existing route tests.
- [ ] Command: `bun run --cwd packages/backend build`
  - Expected: backend TypeScript build passes after app/router wiring.

## Risks and mitigations
- Risk: New `/api/v1` route prefix could conflict with existing `/api` routes.
- Mitigation: Add the required versioned auth route without removing existing route mounts.
- Risk: Provider may be inconsistent between Firebase token and request body.
- Mitigation: Validate the login-event request provider against the allowed issue values and keep token verification authoritative for identity.
