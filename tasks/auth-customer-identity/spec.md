# Customer identity auth repairs

## Authorized scope

The user authorized implementation of nine open auth issues across two managed worktrees and two draft pull requests. This branch owns #399 and #401. The companion branch owns #398, #400, #402, #404, #405, #406, and only the local Storefront credential failure subitem of #357.

Both branches start from fetched `origin/main` at `c867cb027d04c19852561f9c5a664461002bbc8a`. This worktree uses `codex/auth-customer-identity` and targets `main`. Create its draft PR on the first push after the first reviewed, validated unit. Keep #399 in its own independently reviewed commit within this PR. Commit and push only after the coordinating agent gives the go-ahead. Follow the requested merge pipeline after final checks and mergeability verification. No auto-merge has been requested.

The original checkout contains local changes to `AGENTS.md` and `bun.lock`. Exclude those changes from this work and both PRs.

## Ownership

This worktree owns the `customer-identity` OAuth flow, session guard, session repositories, OAuth token transport, related customer account tests, and any required shared customer DTO or persistence contract. Coordinate any shared DTO or transport change before the companion worktree consumes it. Reuse the existing bounded context public interfaces.

The companion worktree owns frontend checkout actions and clients, checkout mutation routes, and shared origin helper/configuration changes. The coordinating agent owns dependency setup. Run every terminal command with this worktree as its explicit working directory, using `/opt/homebrew/bin/bash` on macOS.

## Logical units and acceptance

| Unit | Progress | Required evidence |
|---|---|---|
| #399 browser-bound OAuth callback | Committed and pushed in 82f229a | A valid transaction presented by a browser without the initiating binding fails before session creation. Original-browser success, OAuth denial, nonce mismatch, state replay, and supported concurrent sign-in attempts remain covered. |
| #401 transient and concurrent token refresh | Reviewed and validated, awaiting commit | Token endpoint transient failures preserve the valid Festival session and subsequent CSRF availability. Across two service instances, a losing refresh cannot revoke the winner. Invalid or revoked credentials fail closed. Verify repository token replacement concurrency on PostgreSQL. |

OAuth browser binding must preserve the configured secure cookie behavior and supported authentication return paths. Refresh changes must distinguish retryable transport failures from genuinely invalid credentials and resolve concurrent updates from current persisted state.

## Validation commands

Run from this worktree with Bun 1.4.2 and TypeScript 5.9.3. Dependency setup and the local PostgreSQL 17 endpoint are supplied by the coordinating agent. For PostgreSQL tests, `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` must refer to the supplied local test database. Reuse randomized-schema or rollback fixtures. Record the actual command and result when executed.

```bash
bun run verify:toolchain
bun run build:common
bun test packages/backend/tests/customer-account-service.test.ts packages/backend/tests/customer-account-routes.test.ts packages/backend/tests/customer-logout-csrf.test.ts packages/backend/tests/domains/customer-identity/customer-identity.test.ts
bun test packages/backend/tests/postgres-customer-account-repository.integration.test.ts
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run --cwd packages/common lint
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run check:sql
bun run test
```

Run targeted checks for each unit. Full branch validation follows the repository PR workflow, including PostgreSQL 17 tests and schema parity. Serialize local schema-parity checks that create/drop the fixed `festival_parity` database across both worktrees. Build common and backend declarations before frontend checks when generated artifacts are absent. The repository workflow is `.github/workflows/pr-checks.yml`.

## Review and delivery evidence

Each logical unit requires an independent exact-diff review before its commit. Store the scoped review in `tasks/auth-customer-identity/code-review.md` using the code-review skill helper with an explicit base. Record findings, verdict, confidence, targeted check results, commit SHA, and later CI status when available. Re-review changes made after approval. The final PR must show green checks for its current head and clean mergeability against the current base before the authorized merge pipeline.

Unit #399 passed independent review and validation and was committed/pushed as `82f229a85cb92634133f763c12f32a8568ec1bd2`. Unit #401 passed independent review and PostgreSQL-backed validation and is awaiting its authorized commit. Evidence is recorded in `code-review.md`. Final remote checks and merge pipeline remain pending.
