# Code Review
- Task name: auth-customer-identity
- Findings status: none

## Context
- Base branch: 82f229a85cb92634133f763c12f32a8568ec1bd2
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `packages/backend/src/customer/customer-account-transport.ts`
  - `packages/backend/src/customer/in-memory-customer-account-repository.ts`
  - `packages/backend/src/customer/postgres-customer-account-repository.ts`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts`
  - `packages/backend/src/domains/customer-identity/customer-token-refresh.ts`
  - `packages/backend/src/domains/customer-identity/oauth-discovery.ts`
  - `packages/backend/src/domains/customer-identity/oauth-tokens.ts`
  - `packages/backend/src/domains/customer-identity/types.ts`
  - `packages/backend/src/infra/s10-infra.ts`
  - `packages/backend/tests/customer-token-refresh.integration.test.ts`
- Citation candidates (verify before use):
  - `packages/backend/src/customer/customer-account-transport.ts:12-63`
  - `packages/backend/src/customer/customer-account-transport.ts:384-384`
  - `packages/backend/src/customer/customer-account-transport.ts:4-4`
  - `packages/backend/src/customer/customer-account-transport.ts:404-404`
  - `packages/backend/src/customer/in-memory-customer-account-repository.ts:336-340`
  - `packages/backend/src/customer/in-memory-customer-account-repository.ts:342-347`
  - `packages/backend/src/customer/postgres-customer-account-repository.ts:7-7`
  - `packages/backend/src/customer/postgres-customer-account-repository.ts:94-101`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts:132-132`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts:16-16`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts:2-5`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts:44-44`
  - `packages/backend/src/domains/customer-identity/customer-session-guard.ts:7-10`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:184-184`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:2-2`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:225-225`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:244-247`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:249-285`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:68-85`
  - `packages/backend/src/domains/customer-identity/customer-session-repository.ts:92-95`
  - `packages/backend/src/domains/customer-identity/oauth-discovery.ts:142-147`
  - `packages/backend/src/domains/customer-identity/oauth-discovery.ts:7-11`
  - `packages/backend/src/domains/customer-identity/oauth-tokens.ts:5-5`
  - `packages/backend/src/domains/customer-identity/oauth-tokens.ts:66-76`
  - `packages/backend/src/domains/customer-identity/oauth-tokens.ts:7-7`
  - `packages/backend/src/domains/customer-identity/oauth-tokens.ts:99-99`
  - `packages/backend/src/domains/customer-identity/types.ts:178-186`
  - `packages/backend/src/infra/s10-infra.ts:12-12`
  - `packages/backend/src/infra/s10-infra.ts:9-9`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.96
- Justification: Unit #401 serializes refresh across PostgreSQL repository instances, rechecks live session state, and conditionally replaces or revokes only the token bundle it observed. Transient transport failures preserve session and CSRF availability, explicit invalid credentials fail closed, and a CAS loser can consume the peer result. Advisory lock cleanup handles uncertain acquisition and discards connections after failed unlock. Bounded error parsing retains only allowlisted OAuth codes. No actionable regression remains after the early cleanup concern was corrected.


## Unit #399 validation evidence

- Independent targeted run passed 108 tests across customer-auth.routes, customer-account-service, customer-account-routes, customer-logout-csrf, and csrf-guard suites.
- Independent architecture-boundaries and route-security run passed 11 tests.
- Backend and test TypeScript check passed with `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`.
- Biome check passed for all five changed TypeScript files.
- `git diff --check` passed.
- Tests exercise wrong or absent browser binding before exchange, initiating-browser success, replay rejection, OAuth denial, concurrent sign-in completion in reverse order, secure cookie attributes, state expiry, and existing nonce/issuer/audience validation.
- No schema or session persistence contract changes are part of this unit.
- Independently reviewed unit committed and pushed as `82f229a85cb92634133f763c12f32a8568ec1bd2`. The coordinating agent also reported successful full production build, full test run using isolated PostgreSQL 17, format/lint, frontend/backend type checks, and SQL validation before that push.


## Unit #401 validation evidence

- Independent run passed 100 tests across customer-account-service, customer-account-transport, architecture-boundaries, customer-auth.routes, customer-account-routes, and customer-logout-csrf suites.
- Independent PostgreSQL 17 run passed 21 tests across customer-token-refresh.integration, customer-account-repository, and postgres-customer-account-repository.integration suites, including 15 new refresh cases.
- New integration coverage includes transient 503/429/403/unknown-400/network failures and peer retry, invalid credentials and malformed successful responses, single-use refresh serialization across service/repository instances, logout/integration rotation, CAS loss, operation failure, uncertain lock acquisition, and failed unlock connection discard.
- Backend/test TypeScript, Biome across all 11 changed TypeScript files, SQL checks across 503 backend files, and `git diff --check` passed independently.
- The coordinating agent reported the frozen-head full CI-equivalent run passed format/lint, full build, frontend/backend type checks, SQL checks, 365 common tests, 1,652 backend tests using isolated PostgreSQL 17, 497 frontend tests, and 20 extension tests. Log `/private/tmp/festival-auth-a2-validation.log`.
- The coordinating agent also reported successful PostgreSQL 17 schema parity using the CI procedure and `/private/tmp/festival-auth-migrated-schema.sql`.
- Independent review found no actionable issues after the early advisory-unlock cleanup concern was corrected and tested. Commit and push are authorized after these checks.
