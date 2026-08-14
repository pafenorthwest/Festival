# Code Review
- Task name: harden-customer-account-ssrf-throughput
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
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
  - `README.md:142-160`
  - `README.md:171-171`
  - `SETUP.md:281-288`
  - `SETUP.md:297-329`
  - `goals/task-manifest.csv:9-9`
  - `package.json:33-33`
  - `packages/backend/src/app.ts:112-131`
  - `packages/backend/src/config/env.ts:130-161`
  - `packages/backend/src/config/env.ts:15-22`
  - `packages/backend/src/config/env.ts:61-67`
  - `packages/backend/src/customer/customer-account-service.ts:119-119`
  - `packages/backend/src/customer/customer-account-service.ts:121-129`
  - `packages/backend/src/customer/customer-account-service.ts:132-132`
  - `packages/backend/src/customer/customer-account-service.ts:138-145`
  - `packages/backend/src/customer/customer-account-service.ts:167-167`
  - `packages/backend/src/customer/customer-account-service.ts:169-188`
  - `packages/backend/src/customer/customer-account-service.ts:243-243`
  - `packages/backend/src/customer/customer-account-service.ts:249-251`
  - `packages/backend/src/customer/customer-account-service.ts:25-25`
  - `packages/backend/src/customer/customer-account-service.ts:253-253`
  - `packages/backend/src/customer/customer-account-service.ts:274-274`
  - `packages/backend/src/customer/customer-account-service.ts:279-279`
  - `packages/backend/src/customer/customer-account-service.ts:281-287`
  - `packages/backend/src/customer/customer-account-service.ts:292-292`
  - `packages/backend/src/customer/customer-account-service.ts:31-34`
  - `packages/backend/src/customer/customer-account-service.ts:322-325`
  - `packages/backend/src/customer/customer-account-service.ts:332-332`
  - `packages/backend/src/customer/customer-account-service.ts:335-341`
  - `packages/backend/src/customer/customer-account-service.ts:346-360`
  - `packages/backend/src/customer/customer-account-service.ts:37-40`
  - `packages/backend/src/customer/customer-account-service.ts:380-380`
  - `packages/backend/src/customer/customer-account-service.ts:462-467`
  - `packages/backend/src/customer/customer-account-service.ts:470-480`
  - `packages/backend/src/customer/customer-account-service.ts:492-534`
  - `packages/backend/src/customer/customer-account-service.ts:592-592`
  - `packages/backend/src/customer/customer-account-service.ts:68-68`
  - `packages/backend/src/customer/customer-account-service.ts:7-7`
  - `packages/backend/src/customer/customer-account-service.ts:708-708`
  - `packages/backend/src/customer/customer-account-service.ts:790-790`
  - `packages/backend/src/customer/customer-account-service.ts:86-86`
  - `packages/backend/src/customer/customer-account-service.ts:889-889`
  - `packages/backend/src/customer/customer-account-service.ts:99-105`
  - `packages/backend/tests/customer-account-service.test.ts:100-102`
  - `packages/backend/tests/customer-account-service.test.ts:104-104`
  - `packages/backend/tests/customer-account-service.test.ts:106-106`
  - `packages/backend/tests/customer-account-service.test.ts:114-114`
  - `packages/backend/tests/customer-account-service.test.ts:15-22`
  - `packages/backend/tests/customer-account-service.test.ts:176-176`
  - `packages/backend/tests/customer-account-service.test.ts:212-215`
  - `packages/backend/tests/customer-account-service.test.ts:219-221`
  - `packages/backend/tests/customer-account-service.test.ts:223-224`
  - `packages/backend/tests/customer-account-service.test.ts:320-320`
  - `packages/backend/tests/customer-account-service.test.ts:360-381`
  - `packages/backend/tests/customer-account-service.test.ts:390-396`
  - `packages/backend/tests/customer-account-service.test.ts:4-4`
  - `packages/backend/tests/customer-account-service.test.ts:42-59`
  - `packages/backend/tests/customer-account-service.test.ts:75-78`
  - `packages/backend/tests/customer-account-service.test.ts:80-80`
  - `packages/backend/tests/customer-account-service.test.ts:84-85`
  - `packages/backend/tests/customer-account-service.test.ts:88-88`
  - `packages/backend/tests/customer-account-service.test.ts:93-95`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: The Customer Account-only transport pins TLS connections to fully validated DNS answers, scopes connection reuse to the DNS lease, rejects unsafe endpoints and redirects, and bounds/coalesces all approved caches. Discovery/JWKS invalidation and key rotation remain fail-closed, response/request resources are bounded and released on failure, the mocked relative benchmark passes, and repository-wide validation passes.
