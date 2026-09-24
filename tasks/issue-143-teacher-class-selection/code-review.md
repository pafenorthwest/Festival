# Code Review
- Task name: issue-143-teacher-class-selection
- Findings status: complete

## Context
- Base branch: origin/main
- Diff command: `git diff origin/main...HEAD`
- Changed files:
  - `packages/backend/src/customer/customer-account-service.ts`
  - `packages/backend/src/repo/in-memory-organization-repository.ts`
  - `packages/backend/src/repo/organization-repository.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/tests/registration-selection.test.ts`
  - `packages/common/src/entitlements.ts`
- Citation candidates (verify before use):
  - _none_

## Findings JSON
```json
[
  {
    "file": "packages/backend/src/repo/in-memory-organization-repository.ts",
    "line_range": "1405-1407",
    "severity": "medium",
    "explanation": "The in-memory implementation omits the teacher_membership class predicate, so an active accompanist_membership snapshot in the same division is returned by the teacher selection endpoint and becomes eligible to select classes. Filter grants by entitlementClass to match the PostgreSQL implementation and add a regression test."
  },
  {
    "file": "packages/backend/tests/registration-selection.test.ts",
    "line_range": "498-507",
    "severity": "medium",
    "explanation": "Despite the test description, it exercises only an absent teacher ID. Issue #143 explicitly requires tests for inactive, expired, cross-tenant, and division-ineligible teacher selections; create each entitlement and assert the same generic rejection."
  }
]
```

## Verdict
- Verdict: patch is incorrect
- Confidence: 0.93
- Justification: The in-memory teacher lookup can authorize and expose active non-teacher entitlements for a division, and the mandated negative teacher-eligibility cases are not covered by tests.
