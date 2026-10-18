# Code Review
- Task name: fix-class-capacity-audit-atomic
- Findings status: none

## Context
- Base commit: 5c8dd582d18861926956f46bc376b0345fc4855e
- Diff command: git diff HEAD; inspect packages/backend/tests/postgres-class-capacity-atomic.integration.test.ts
- Earlier review: The original be77c73189fddcbce1eb00ef94cfcd383ba138cf-to-HEAD assessment remains preserved in tasks/review-be77c731-to-head/code-review.md; this follow-up reviews the current uncommitted fixes and resolves both original P2 findings.
- Scope: Seven modified backend production/test files and the new PostgreSQL regression test; task documentation excluded from behavioral review.
- Review: Independently inspected repository contract, both repository implementations, admin and fallback service paths, failure injection tests, and PostgreSQL trigger/concurrency integration test.
- Validation: git diff --check passed. Full PostgreSQL suite is independently owned by the validation agent; its results are reported separately.
- Validator adaptation: Inspected /Users/eric/.codex/scripts/code-review-validate.sh; project instructions prohibit direct .sh execution. Equivalent native PowerShell prepare/validation checks record the current diff scope, parse findings JSON, and enforce status/verdict/confidence consistency.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: Class creation and capacity mutation now commit together with their audit record. PostgreSQL uses the same transaction runner for every mutation and audit write and locks the prior capacity row before comparison. Memory staging publishes the record and staged audits only after success and rejects conflicting concurrent publication. Both service paths call these atomic operations. No actionable correctness or project structure regressions found.

## Evidence and limits
- The PostgreSQL audit trigger rejects real database INSERTs, proving creation rollback and rollback of every changed class field, rather than merely mocking a transaction helper.
- Successful retry retains previous capacity 25, commits new capacity 10 and its audit, while a repeated same-capacity update adds no audit. Concurrent updates verify a contiguous previous/new capacity chain and matching final state.
- Admin service tests assert failed creation leaves no class and compensates the newly created Shopify product; an append-then-throw audit test also verifies staged audit rollback.
- Fallback OrganizationService tests cover failed creation, failed update, actor attribution, and successful retry.
- Placed-count SQL preserves the existing confirmed-entitlement predicate and executes inside the capacity transaction.
- External Shopify writes retain their existing compensation boundaries; this change atomically persists the requested local class and audit records.
