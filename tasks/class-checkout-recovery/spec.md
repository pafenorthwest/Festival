# Deterministic class checkout recovery

Locked goals: [goals v0](../../goals/class-checkout-recovery/goals.v0.md).
Implementation plan: [plan](implementation-plan.md).

The user approved option 2 and explicitly requested both the plan and runtime
implementation on a new branch. The non-negotiable invariant is committing the
recovery-required outcome, sanitized evidence, and worker lease release together
before returning that recorded result. Unknown provider outcomes must never
authorize an automatic second cart creation.

## Scope and worktree

Work is on `codex/class-checkout-recovery-plan`, based on registration redesign
commit `a0c9906f248d79d0f297a6ba64f370885bef0235`. Preserve the preexisting untracked
`tasks/cart-consistency-review/` report. No deployment, push, production database,
live Shopify mutation, or separate client cart entity is in scope.

Repository Bash-only bootstrap/scaffold/preflight workflows are implemented with
native PowerShell equivalents to honor AGENTS.md. The repository/branch/conflict
preflight passed. Existing Codex configuration is reused; external configuration
is not rewritten. Goals are locked by the user's explicit option and
implementation approval. Shared writes have one owner per backend persistence,
checkout execution/service, frontend/customer route, and integration area.

## Pinned verification

```powershell
bun run verify:toolchain
bun run build:common
bun run check:sql
bun run --cwd packages/backend lint
bun run --cwd packages/frontend lint
bun run --cwd packages/frontend test
bun run build:backend
bun run --cwd packages/frontend build
bun test packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/checkout-repository.test.ts packages/backend/tests/class-checkout-execution.test.ts packages/backend/tests/customer-registration.routes.test.ts packages/backend/tests/shopify-membership-checkout-client.test.ts packages/backend/tests/admin-class-checkout-recovery.test.ts packages/backend/tests/class-order-projection.test.ts packages/backend/tests/shopify-order-projection-service.test.ts packages/backend/tests/membership-checkout-service.test.ts packages/backend/tests/checkout-recovery-service.test.ts packages/backend/tests/postgres-schema.test.ts packages/backend/tests/postgres-schema-snapshot.test.ts
bun --env-file=database.env tasks/class-checkout-recovery/validation/run-postgres.ts
```

Source the explicitly authorized `database.env` configuration for full PostgreSQL
integration verification. Override `DB_SCHEMA` only in the test process to a
uniquely owned disposable current-target schema; do not migrate, reset, or change
the configured application schema. Require shared extensions to exist, run the
catalog preflight and all PostgreSQL-gated suites, then drop only owned schemas.
No integration skips count as concurrency verification. Credentials stay out of
stdout and saved artifacts. Full delivery evidence and remaining limitations are
recorded here after final integration and independent code review.

## Narrow validation prerequisite

The first full PostgreSQL run selected 17 files and found six failures in the
existing admin entitlement report integration suite. Sanitized diagnostics traced
all six to the unchanged `findMembershipCustomerContacts` query: a JavaScript array
was bound directly to `ANY($2::text[])`, which Bun 1.4.2 transmitted as a malformed
array literal. The baseline implementation at the starting commit has the same
binding. The parent authorized the single-expression correction to
`sql.array(uniqueIds, "text")` so full integration validation can complete. No
report behavior, SQL query, or unrelated repository code is refactored; existing
multi-customer route integration cases verify the correction.

## Delivered behavior

The existing Festival submission key is bound to a canonical immutable payload.
The class execution record stores checkpoints, a bounded worker lease/generation,
server-only external cart evidence, and append-only events. Short transactions
commit a recorded recovery-required result, its sanitized evidence, and lease
release together before that result is returned. A failed database recording does
not claim durable success; pre-dispatch evidence and expired-lease recovery retain
a deterministic recovery path.

Unknown creation never triggers a blind second Shopify create. Known carts can be
verified/adopted or resumed without changing their identity. Late results remain
evidence and cannot override a newer fenced decision. Operator resolution is
tenant-Admin authorized, reasoned, audited, and generation checked. Late paid-order
evidence is recorded transactionally, while unadmitted or abandoned carts receive
review instead of automatic class grants.

The original application expiry is preserved across retries and adoption. Expiry
does not cancel Shopify or authorize replacing an unresolved known cart. An expired
unfulfilled operation must record `checkout_expired` recovery and receive explicit
audited abandonment before a different key/session can replace it. This policy is
independent of whether the customer checks status first. Fulfilled operations
remain terminal.

Customer status and recorded-result replay authenticate locally before Shopify
OAuth refresh. Only safe recovery fields cross the customer boundary; Festival
keys remain in Festival request headers and persistence. The frontend retains its
frozen payload/key, cart lines, and recovery reference; status refresh can resume
the matching known cart. A new submission can be explicitly prepared only after
recorded abandonment, retaining cart contents and resetting the old key without
automatically sending checkout. External handoff stays locked through departure
and clears only the submitted snapshot.

## Delivery evidence

- Common suite: 353 passed, 0 failed; 1,248 assertions across 22 files.
- Frontend suite: 414 passed, 0 failed; 2,335 assertions across 49 files. Actual-hook
  subprocess tests cover pending navigation, response loss, recovery status, and
  explicit abandonment restart without leaking module mocks into other suites.
- Final backend suite: 1,459 passed, 50 skipped, 0 failed; 7,139 assertions across
  128 files. PostgreSQL-gated cases are separately exercised with no skips below.
- Backend/frontend typechecks and builds passed; SQL safety check passed across
  276 source files. Biome passed across all 35 changed package TypeScript files.
  Verified toolchain: Bun 1.4.2 and TypeScript 5.9.3.
- Final expiry-aware full PostgreSQL run: all 17 gated files completed,
  61 passed, 0 failed, 0 skipped; eight fixture schema initializations and ten
  verified application transaction rollbacks. The disposable target was dropped
  and verified absent; the configured application schema was unchanged.
- Sanitized final PostgreSQL artifacts are `validation/postgres-full.log` and
  `validation/postgres-full-summary.json`; the first diagnosed baseline failure is
  preserved in `postgres-full-initial.*`. The portable task runner owns its target,
  requires shared extensions to exist, runs the catalog preflight first, bounds
  each suite process, redacts credentials, and removes its owned target in `finally`.
- Independent scoped reviews found no remaining actionable findings, including
  final expiry/admission behavior. The [code review](code-review.md) records the
  correct verdict, confidence, and native PowerShell validation of the review gate.

## Operational limitations

No configured application schema was migrated, reset, or changed during testing.
The new migration must be applied through deployment procedures before enabling
the new lifecycle against an existing application database. At validation handoff, no live Shopify mutation, production deployment, commit,
push, or pull request had been performed. The user subsequently authorized a local
implementation-and-plan commit on the existing branch; push remains outside scope.

The implementation provides `bun run reap:class-checkout`, an authorized
organization-scoped Admin reaper endpoint, and lazy request-triggered recovery.
A recurring production maintenance schedule has not been provisioned; operators
must schedule the command and run it following database/process outages.

Unknown Shopify outcomes can remain recorded recovery cases until verified late
evidence or an explicit audited disposition is available. No distributed atomicity,
automatic orphan cancellation, or exactly-once Shopify creation guarantee is made.

## Goal verification map

| Goal | Delivered behavior and evidence |
| --- | --- |
| G1 Immutable stable identity | Canonical server fingerprint, frozen frontend submission, same-key replay, changed-payload conflict, and owner/festival checks in service/customer route tests. |
| G2 Recorded recovery before response | Execution repository tests and real PostgreSQL fault injection demonstrate outcome/evidence/lease release commit together, recording failure is explicit, and expired dispatched work cannot recreate automatically. |
| G3 Deterministic unknown resolution | Service/adapter tests cover unknown creation, verified cart adoption, late evidence, and audited generation-checked abandonment; paid-order integration retains evidence without granting unadmitted work. |
| G4 Concurrent workers and decisions | In-memory/real PostgreSQL tests cover one winning lease, stale generations, alternate keys/sessions, operator/payment serialization, and original-expiry guards independent of status lookup. |
| G5 Known-cart resume | Service tests reuse the same remote cart after URL failures and preserve the original expiry/capacity admission policy; expired unfulfilled work requires recorded recovery and audited abandonment before replacement. |
| G6 Frontend preservation and handoff | Actual-hook subprocess tests cover frozen network retry, recovery status without blind create, explicit abandonment restart retaining lines, pending-navigation lock, and submitted-only cleanup. |
| G7 Festival/provider boundary | Adapter tests keep Festival keys out of Shopify requests; customer routes project only safe fields, use local authentication for recorded replay, and enforce owner/submission binding; Admin/nginx authorization tests pass. |
| G8 Schema and proportional verification | Canonical schema/snapshot checks, SQL safety, typechecks/builds, unit/route/frontend suites, and all PostgreSQL-gated suites pass; initial baseline array-binding failure and its one-expression prerequisite correction remain documented. |
