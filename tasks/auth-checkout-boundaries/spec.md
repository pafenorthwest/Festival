# Checkout auth boundary repairs

## Authorized scope

The user authorized implementation of nine open auth issues across two managed worktrees and two draft pull requests. This branch owns #400, #404, #398, #402, #406, #405, and the local Storefront credential failure subitem of #357. The companion branch owns #399 and #401.

Both branches start from fetched `origin/main` at `c867cb027d04c19852561f9c5a664461002bbc8a`. This worktree uses `codex/auth-checkout-boundaries` and targets `main`. Create its draft PR on the first push after the first reviewed, validated unit. Keep #400 in its own independently reviewed commit within this PR. Commit and push only after the coordinating agent gives the go-ahead. Follow the requested merge pipeline after final checks and mergeability verification. No auto-merge has been requested.

The original checkout contains local changes to `AGENTS.md` and `bun.lock`. Exclude those changes from this work and both PRs.

## Ownership

This worktree owns frontend checkout actions and clients, checkout/customer mutation routes, shared origin helpers/configuration, and their associated tests. Serialize edits to `lib/api/registration.ts` across #400/#404. Coordinate #402/#406 edits to `lib/api/commerce.ts` and `checkout-recovery-ui.test.ts`, retaining separate endpoint tests and independently reviewable changes.

The companion worktree owns customer OAuth, sessions/repositories, token transport, and any required shared customer DTO or persistence contract. Consume its public interfaces and coordinate before requesting a shared contract change. The coordinating agent owns dependency setup. Run every terminal command with this worktree as its explicit working directory, using `/opt/homebrew/bin/bash` on macOS.

## Logical units and acceptance

| Unit | Progress | Required evidence |
|---|---|---|
| #400 drop and transfer CSRF | Committed and pushed in 222e3ce | Both mutations reject missing, empty, wrong, and other-session tokens and incorrect origins. Denials leave registration, audit, promotion, and refund effects untouched. Valid callers supply the current token and retain ownership checks. |
| #404 explicit checkout arguments | Committed and pushed in e2e5282 | Supported overloads preserve positional token/key precedence and stable retry keys. Cover the current object-only caller. |
| #398 pre-dispatch auth rejection | Committed and pushed in ee9275a | Confirmed pre-dispatch auth/CSRF denial releases the same-session cart lock and preserves its lines. Session changes cannot submit an earlier customer's draft. Uncertain dispatch retains its recovery behavior. |
| #402 admin CSRF header | Committed and pushed in 23eca3a | Realistic Firebase ID tokens remain in Authorization and authorized reconciliation/approve/decline requests succeed with the intended separate CSRF value. Retain missing-CSRF, non-admin, and cross-tenant denials and shared helper consumer coverage. |
| #406 membership recovery CSRF | Committed and pushed in 23eca3a | Every resume POST validates session-bound CSRF and origin. Missing/empty/wrong tokens and incorrect origins leave the source and recovery request untouched and make no Storefront call. Valid same-origin resume succeeds for the matching pending link. |
| #405 canonical admin origin | Committed and pushed in 4fbb68d | Both reap and resolve accept equivalent canonical origins. Absent, malformed, opaque, and cross-origin inputs fail closed. |
| #357 local credential subitem | Independently reviewed and validated, authorized for commit | Missing or undecryptable local Storefront credentials fail before external dispatch and remain retryable after repair. Preserve uncertain remote-dispatch recovery and avoid duplicate carts on retry. |

The #357 umbrella also contains separate payment/replacement and UI recovery work. The authorized scope here covers only its local Storefront credential failure subitem. Completion of this unit must identify that subitem without closing the full umbrella automatically.

## Validation commands

Run from this worktree with Bun 1.4.2 and TypeScript 5.9.3. Dependency setup and the local PostgreSQL 17 endpoint are supplied by the coordinating agent. For PostgreSQL tests, `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` must refer to the supplied local test database. Reuse randomized-schema or rollback fixtures. Record the actual command and result when executed.

```bash
bun run verify:toolchain
bun run build:common
bun test packages/backend/tests/drop-transfer-routes.test.ts packages/frontend/tests/drop-transfer.test.ts
bun test packages/frontend/tests/api/api-clients.test.ts packages/frontend/tests/multiLineCheckoutHandoff.test.ts packages/frontend/tests/class-checkout-hook.test.ts
bun test packages/backend/tests/admin-entitlements-ops.test.ts packages/frontend/tests/admin-entitlement-ops-panel.test.ts
bun test packages/backend/tests/customer-checkout-recovery.test.ts packages/frontend/tests/checkout-recovery-ui.test.ts
bun test packages/backend/tests/admin-class-checkout-recovery.test.ts packages/backend/tests/csrf-guard.test.ts
bun test packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/shopify-membership-checkout-client.test.ts
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

Each logical unit requires an independent exact-diff review before its commit. Store the scoped review in `tasks/auth-checkout-boundaries/code-review.md` using the code-review skill helper with an explicit base. Record findings, verdict, confidence, targeted check results, commit SHA, and later CI status when available. Re-review changes made after approval. The final PR must show green checks for its current head and clean mergeability against the current base before the authorized merge pipeline.

Units #400, #404, #398, #402, and #406 passed independent review and validation and were committed/pushed as `222e3ce`, `e2e5282`, `ee9275a`, and `23eca3a`. Unit #405 passed independent review and validation and was committed/pushed as `4fbb68d`. The local credential subitem of #357 passed independent review, targeted tests, and the final full branch gates and is authorized for commit. Evidence is recorded in `code-review.md`. This completes the nine authorized issue scopes across the two branches; #357 remains open for its other subitems.
