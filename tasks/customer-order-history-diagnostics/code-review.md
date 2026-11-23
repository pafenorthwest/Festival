# Code Review
- Task name: customer-order-history-diagnostics
- Findings status: none

## Context
- Base branch: f5ce41811e6f4213a0e7e6f7b116518755133387
- Diff command: `git diff -- packages/backend/src/domains/customer-identity/customer-oauth-flow.ts packages/backend/tests/customer-account-service.test.ts`; inspect the two new untracked helper/test files explicitly.
- Scope: Only the new diagnostic helper, its fixed operation call sites, diagnostic fixture input and two classification service regressions. The separately completed customer-login-readiness changes in the same tracked files were excluded. The prepare script's workspace-wide inventory was narrowed to the reviewed delta here.
- Excluded: Prior pending checkout work, prior authentication readiness recovery, dev cleanup scripts, pre-existing user AGENTS.md/bun.lock edits, and unrelated workspace changes. No product/source edits, Git staging, commits, or pushes by this reviewer.
- Changed files:
  - `packages/backend/src/domains/customer-identity/customer-graphql-errors.ts` (new)
  - `packages/backend/src/domains/customer-identity/customer-oauth-flow.ts` (helper import, fixed identity/orders operation arguments, helper invocation only)
  - `packages/backend/tests/customer-graphql-errors.test.ts` (new)
  - `packages/backend/tests/customer-account-service.test.ts` (diagnostic input plus two classifications only)

## Review evidence
- Inspected both complete new files and the scoped tracked call-site/test delta against the immediately preceding reviewed auth implementation; no Shopify query, scope, endpoint, token, retry, configuration, readiness or session policy change.
- All diagnostic text is fixed or selected from exact finite code/query-field allowlists. Error arrays, code arrays, paths and path fields are capped; numbers must be finite, nonnegative and at most 1e9. No raw message, customer response data, arbitrary extension, variable, header, identifier or credential reaches the event or AppError details. Successful responses do not log.
- Access denial preserves 403 with a fixed machine code; known throttle/internal/schema categories return 503 with fixed codes; unrecognized/absent codes preserve the existing generic 403 contract. Both call sites supply fixed operation literals. No retry was introduced.
- Independently ran `bun test packages/backend/tests/customer-graphql-errors.test.ts packages/backend/tests/customer-account-service.test.ts packages/backend/tests/customer-account-transport.test.ts packages/backend/tests/customer-auth.routes.test.ts packages/backend/tests/architecture-boundaries.test.ts`: 104 passed, 494 assertions, 0 failed across 5 files.
- Malicious metadata tests cover embedded access/refresh strings, customer identifiers/email, arbitrary paths/codes/messages/headers/variables, invalid numeric costs and oversized error/path input. Service regressions exercise actual order call wiring, static operation, error classification, unchanged authentication and one request without retry.
- Implementation owner separately reports backend types/build and scoped Biome checks passed. This diagnostic improvement does not establish or fix the historical provider error's unknown underlying cause.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: The bounded diagnostic delta preserves unknown-error compatibility while safely exposing fixed classifications and bounded metadata, without logging raw provider/customer data. Source inspection and independently rerun helper/service/transport/auth-route/architecture checks found no actionable regression.
