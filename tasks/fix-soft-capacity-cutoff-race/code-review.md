# Code Review
- Task name: fix-soft-capacity-cutoff-race
- Findings status: none

## Context
- Base branch: main (5c8dd582)
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Scope: checkout admission and durable attachment; capacity/confirmed entitlement mutation serialization; in-memory equivalents; migration and regression tests.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.91
- Justification: Final PostgreSQL capacity and confirmed-count reads occur after the shared transaction advisory lock and before durable attachment in the same transaction. Statement triggers cover configuration and entitlement writes, including direct SQL and status/move mutations; fulfillment acquires the gate before its existing row locks. Open carts do not reserve capacity, and paid placement remains allowed above capacity. In-memory writer and attachment gates preserve the same ordering. Multi-class failure rolls back the entire attachment, sold-out errors retain failure handling, and existing attached-cart resume bypasses new admission unchanged. Migration and runtime definitions agree. Reviewed regression coverage includes both cutoff writers winning and losing the attachment race, mixed-cart rollback, persistence rollback/retry, soft over-capacity placement, and an idempotent populated-schema migration upgrade. The upgrade test removes only the new objects in its disposable schema, reapplies deployment SQL twice, checks preserved rows and exactly two triggers, then observes an actual blocked admission and sold-out rejection. No actionable correctness, security, or project-structure regressions found. Parent owns full-suite validation; this review does not claim an independently rerun suite.

## Validation
- Equivalent PowerShell review validation used because project instructions require native PowerShell and forbid direct .sh execution.
- Inspected global code-review-validate.sh requirements; verified findings JSON, status/verdict consistency, confidence range, and nonempty justification.
- git diff --check: passed.
- Shared gate serializes schema-wide short database operations; Shopify network work remains outside the critical section.
- Final test-only cleanup review: fixture setup drops its disposable schema if initialization/seeding fails; reverse-barrier promises receive immediate rejection handlers while original awaited promises still surface failures. No production changes or actionable regressions.
