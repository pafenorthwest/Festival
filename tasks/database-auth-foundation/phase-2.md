# Phase 2 — Firebase Bearer Auth and Context Foundation

## Objective
Add explicit Firebase bearer-token verification middleware/context support for authenticated Hono handlers.

## Code areas impacted
- `packages/backend/src/auth/**`
- `packages/backend/src/routes/**`
- `packages/backend/src/app.ts`
- `packages/backend/tests/**`

## Work items
- [ ] Confirm existing Firebase verifier behavior and extend only where required for issue #16 identity fields.
- [ ] Add or extract reusable bearer-token auth middleware for Hono.
- [ ] Attach decoded Firebase identity to Hono context with typed context variables.
- [ ] Ensure missing/malformed/invalid bearer tokens fail explicitly with auth errors.
- [ ] Keep Firebase Admin initialization environment-driven and testable.

## Deliverables
- Auth middleware/context types available to auth routes.
- Tests for bearer header parsing and invalid-token behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [ ] Authenticated route handlers can receive verified Firebase identity from context.
- [ ] Unauthorized requests receive deterministic 401 responses.
- [ ] Firebase Admin secrets remain environment-only.

## Verification steps
List exact commands and expected results.
- [ ] Command: `bun run --cwd packages/backend test`
  - Expected: backend auth middleware/verifier tests pass.
- [ ] Command: `bun run --cwd packages/backend build`
  - Expected: backend TypeScript build passes with Hono context typing.

## Risks and mitigations
- Risk: Firebase Admin verification can be hard to test without live credentials.
- Mitigation: Keep an `AuthVerifier` seam and use deterministic fakes in tests.
- Risk: Existing routes may have local auth helpers.
- Mitigation: Reuse or extract the existing helper rather than creating competing auth paths.
