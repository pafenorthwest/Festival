# Shopify paid-order callback error

## Goal reference

- `goals/shopify-paid-order-callback-error/goals.v0.md` (locked)

## Scope

### In scope

- Webhook mutation uri type, webhook error classification, and backend regression tests.

### Out of scope

- Production deployment, credential changes, unrelated Shopify behavior.

## Approach

- Use String! for the uri variable. Classify top-level GraphQL failures separately from mutation callback validation errors.

## Verification commands

- Lint: `bun run lint:backend`
- Build: `bun run build:common && bun run build:backend`
- Tests: `bun run test:backend`
- Focused regression: `bun test packages/backend/tests/shopify-admin-api-client.test.ts packages/backend/tests/shopify-webhook-subscription-service.test.ts`

## Delivery

- Delivered: Registration now declares uri as String! (G1). Top-level GraphQL errors no longer enter callback classification; mutation userErrors retain callback classification and request IDs (G2). Regression checks failed before implementation and pass afterward. No scope drift.
- Exceptions: None
- Deferred work: Live diagnostic retry after deployment (outside this implementation scope).
- Dirty-worktree decision: continue on new branch codex/shopify-paid-order-callback-error. Goal artifacts belong to this task. Pre-existing untracked token file is excluded and untouched.

## Quality gate results

- Lint: landing rerun passed; output: Checked 84 files. No fixes applied.
- Build: landing rerun passed; common and backend tsc -p tsconfig.json both exited 0.
- Tests: landing rerun passed; output: 249 pass, 0 fail, 984 expect() calls across 30 files.
- Code review: patch is correct; no findings; confidence 0.96. Review validator passed.
- Clean merge: checked against fetched origin/main after commit; result recorded in the PR.

- Implementation status: READY TO LAND. Validation and code review passed. Commit, push, and clean-merge proof proceed before PR creation. Production deployment remains outside scope.
