# Code Review
- Task name: customer-login-readiness
- Findings status: none

## Context
- Base branch: f5ce41811e6f4213a0e7e6f7b116518755133387
- Diff command: `git diff f5ce41811e6f4213a0e7e6f7b116518755133387 -- <nine scoped auth files below>`
- Scope: Only the new authentication readiness and order capability isolation delta. These auth files had no pre-existing changes when review began. The prepare script's workspace-wide inventory was narrowed here to the actual reviewed delta.
- Excluded: Previously reviewed pending checkout implementation, dev-cart cleanup scripts, pre-existing user edits in AGENTS.md and bun.lock, and unrelated workspace changes. No source changes, staging, commits, or pushes were performed by this reviewer.
- Changed files:
  - `packages/backend/src/customer/in-memory-customer-account-repository.ts`
  - `packages/backend/src/customer/postgres-customer-account-repository.ts`
  - `packages/backend/src/domains/customer-identity/customer-integration-repository.ts`
  - `packages/backend/src/domains/customer-identity/customer-oauth-flow.ts`
  - `packages/backend/src/domains/customer-identity/types.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
  - `packages/backend/tests/customer-account-repository.test.ts`
  - `packages/backend/tests/postgres-customer-account-repository.integration.test.ts`
  - `packages/backend/tests/domains/customer-identity/customer-identity.test.ts`

## Review evidence
- Read all nine scoped diffs and verified current source. No DDL or Shopify query/permission changes.
- Failed/unknown configured integrations invalidate their matching discovery cache entry and use the existing fully validated discovery path before OAuth state creation. Recovery records readiness only when the persisted integration version still matches; stale rotation observations cannot repair the replacement configuration.
- Order access observations update capability only, preserving authentication readiness, verification timestamp, diagnostic state, credentials and integration version. Both production Postgres and in-memory implementations enforce the version guard. Parsing occurs before recording successful order access.
- Existing return-target, tenant/session, issuer, CSRF, token refresh and browser-bound OAuth behavior remain covered by the service suite.
- Independent validation: `bun test packages/backend/tests/customer-account-service.test.ts packages/backend/tests/customer-account-repository.test.ts packages/backend/tests/domains/customer-identity/customer-identity.test.ts packages/backend/tests/architecture-boundaries.test.ts` passed 65 tests, 347 assertions, 0 failures; 4 Postgres tests skipped without the integration environment.
- Reviewed the new real Postgres regression for both health observation branches, preserving auth fields, and rejecting stale-version observations. Implementation owner separately reports the isolated Postgres repository/token refresh/contract run passed 23 tests with 0 failures, plus backend types and scoped Biome checks.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.93
- Justification: The scoped change removes the order-to-login failure coupling while retaining fresh discovery validation, version-conditional writes, existing authorization boundaries and conservative order errors. Source inspection and independent focused tests found no actionable regression; real Postgres writer coverage was inspected and separately passed by the implementation owner.
