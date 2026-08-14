# Code Review
- Task name: harden-customer-account-ssrf-throughput
- Findings status: complete

## Context
- Base branch: eric/basic-customer-auth
- Diff command: `git diff eric/basic-customer-auth...HEAD`
- Changed files:
  - `README.md`
  - `SETUP.md`
  - `goals/harden-customer-account-ssrf-throughput/establish-goals.v0.md`
  - `goals/harden-customer-account-ssrf-throughput/establish-goals.v1.md`
  - `goals/harden-customer-account-ssrf-throughput/goals.v0.md`
  - `goals/harden-customer-account-ssrf-throughput/goals.v1.md`
  - `goals/task-manifest.csv`
  - `package.json`
  - `packages/backend/scripts/benchmark-customer-account-cache.ts`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/config/env.ts`
  - `packages/backend/src/customer/bounded-async-cache.ts`
  - `packages/backend/src/customer/customer-account-service.ts`
  - `packages/backend/src/customer/customer-account-transport.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
  - `packages/backend/tests/customer-account-transport.test.ts`
  - `tasks/harden-customer-account-ssrf-throughput/code-review.md`
  - `tasks/harden-customer-account-ssrf-throughput/spec.md`
- Citation candidates (verify before use):
  - _none_

## Findings JSON
```json
[
  {
    "file": "packages/backend/src/customer/customer-account-transport.ts",
    "line_range": "188",
    "severity": "medium",
    "explanation": "Expiring or evicting a DNS lease calls Agent.destroy(), which destroys sockets in both the free and active pools. If a response is still streaming when another request (or cacheMetrics()) observes the TTL expiry, that unrelated request is aborted. Retire the lease from new use at expiry but defer destruction until its in-flight requests have released it, and add an overlapping-request TTL test."
  }
]
```

## Verdict
- Verdict: patch is incorrect
- Confidence: 0.98
- Justification: DNS lease expiry can abort an unrelated in-flight Customer Account request because cache removal immediately destroys the lease's active Agent sockets.
