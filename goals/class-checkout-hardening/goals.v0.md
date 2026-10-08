# Goals Extract
- Task name: class-checkout-hardening
- Iteration: v0
- State: locked

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
