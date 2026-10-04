# Establish Goals

## Status

- Task name: class-checkout-hardening
- Iteration: v0
- State: locked

## Request

- Preserve the verified class checkout persistence fix, improve classification
  and reporting of database failures, retain actionable privacy-safe class
  checkout stages, and remove temporary secret-canary debugging rather than
  introduce a feature flag.

## Blocking ambiguity

- The proposed public contract below is an approval point: database failures
  return HTTP 500 with `checkout_database_failure` and a nontechnical message;
  SQLSTATE and stage remain operator-only diagnostics. Shopify/upstream failures
  retain their current retryable 503 contract.

## Assumptions

- Reapply only the proven scalar repertoire snapshot write change in
  `packages/backend/src/checkout/postgres-checkout-helpers.ts`; do not broaden
  the persistence refactor.
- A database failure is identified from Bun/PostgreSQL error metadata, including
  a five-character SQLSTATE when supplied by the driver.
- Structured production diagnostics are acceptable now, provided they contain
  only opaque checkout IDs, bounded stage/error identifiers, and no request
  body, customer data, tokens, raw database messages, query text, stack, hint,
  or error detail.
- Temporary secret-canary literals and debug-only instrumentation should be
  deleted. No feature flag will be added for this work.

## Goals

1. Preserve the class repertoire snapshot fix by replacing the two
   `jsonb_to_recordset` batch writes with scalar parameterized inserts inside
   the existing transaction.
2. Classify database failures separately from Shopify/upstream failures, using
   the five-character SQLSTATE when present, and return a stable HTTP 500
   `checkout_database_failure` response without internal diagnostic fields.
3. Retain an explicit, comprehensive `ClassCheckoutFailureStage` for metadata,
   cart, checkout, verification, and resume operations; write privacy-safe
   structured diagnostics before compensation marks an intent failed.
4. Remove the secret-canary/debug-only code path without adding a flag, while
   retaining a regression assertion that raw error text cannot enter logs or
   public error responses.
5. Add focused service, route, and persistence tests for the retained fix,
   database-error contract, Shopify 503 behavior, stage diagnostics, and
   redaction.

## Non-goals

- Do not change Shopify configuration, the customer checkout request shape,
  database schema, or product/class catalogue behavior.
- Do not publish SQLSTATE, constraint/table/column names, raw database text,
  request data, customer data, tokens, or stack traces in API responses.
- Do not add a diagnostics feature flag or a broad logging framework.

## Success criteria

- [G1] A metadata transaction with multiple repertoire items/contributors uses
  scalar parameterized writes and no `jsonb_to_recordset` query.
- [G2] A simulated database failure with SQLSTATE `22023` logs the SQLSTATE and
  exact failure stage internally, returns HTTP 500 with
  `checkout_database_failure`, and marks the intent failed.
- [G3] A Shopify checkout failure continues to return HTTP 503 with
  `checkout_retryable_upstream`.
- [G4] Diagnostics and public error payloads omit raw error text and all
  sensitive/request/customer fields; no secret-canary/debug-only code remains.
- [G5] Focused backend lint, build, and affected checkout/route tests pass.

## Proposed plan

1. Port the verified scalar snapshot-write fix and unit-test its multi-item,
   multi-contributor parameter shape.
2. Add a narrow database-error classifier that extracts only safe Bun/Postgres
   identifiers (including SQLSTATE) and maps it to a stable application error.
3. Reintroduce the complete checkout/resume stage tracker and production logger;
   maintain the existing intent-failure compensation without logging raw errors.
4. Update service and route tests to prove database 500 versus Shopify 503,
   stage coverage, and the no-raw-error-text boundary.
5. Run backend lint/build and focused tests, then present the implementation
   diff for final review.

## Next action

- Request user approval of the proposed public database-error contract and goal
  set before implementation.
