# Establish Goals

## Status

- Task name: issue-258-paid-line-correlation
- Iteration: v0
- State: locked

## Request

- Implement the user-approved `specs/issue-258-paid-line-correlation-spec.md`
  so every class checkout intent line is matched to exactly one paid Shopify
  order line by `festival_checkout_intent_line_id` before an entitlement is
  approved. Preserve the approved checkout HTTP contract and scope boundaries.

## Blocking ambiguity

- None. The user explicitly approved the implementation specification.

## Assumptions

- Existing `read_orders` access can expose paid-order line custom attributes
  after app/store rollout; source code and automated tests cover the contract,
  while live-store verification remains a release requirement.
- The current production refund path remains manual/pending because this issue
  must not add `write_orders`; it must retain immutable order-line allocation
  facts for an operator or future separately authorized provider.

## Goals

1. Write and read the complete, unique persisted checkout-intent-line UUID on
   every newly created class Shopify cart line, and include paid-line custom
   attributes in both webhook and reconciliation Admin reads.
2. Correlate multi-line and newly created single-line class purchases by an
   exact, order-independent UUID bijection before product/variant/quantity and
   aggregate-payment validation or entitlement finalization. Missing, blank,
   malformed, unknown, duplicate, or non-bijective values must fail closed as
   `needs_review` / `correlation_invalid`, with no partial business writes.
3. Persist the UUID-matched Shopify order-line GID, historical paid allocation,
   and currency on each entitlement; preserve aggregate discount behavior and
   prohibit positional, product, or variant fallback. Retain only the approved,
   narrowly isolated historical single-line compatibility path.
4. Enforce one entitlement per durable intent line and one line index per intent
   in PostgreSQL, including an idempotent schema initializer, canonical schema,
   forward migration with duplicate-data preflight, and transactional replay/
   rollback safety.
5. Preserve the public `registration/checkout` success and error contract. Do
   not add a paid-line correlation HTTP error; writer invariant failures use
   the existing safe retryable checkout failure, while paid-line failures are
   post-payment decisions.
6. Retain auditable, per-line historical refund allocation and order-line
   identity without adding Shopify `write_orders` or automatically issuing an
   order-wide refund. Cover this policy and all changed behavior with focused
   unit, route, projection, schema, migration, and PostgreSQL integration tests.

## Non-goals

- No change to class selection, capacity/waitlist policy, registration windows,
  prerequisites, catalog/product lifecycle, or browser checkout UI.
- No browser exposure of paid-line custom attributes or allocations.
- No positional correlation fallback for invalid current or multi-line orders.
- No Shopify `write_orders`, live automated refund mutation, product/variant
  migration, or new external checkout API shape.

## Success criteria

- [G1] Checkout-created paid orders expose exactly one non-empty full UUID line
  attribute per persisted intent line in both Admin read paths.
- [G2] Reordered distinct and duplicate-variant paid lines associate the correct
  child/class/metadata/order-line GID/allocation; malformed mapping scenarios
  produce no entitlement or partial link.
- [G3] Valid discounted allocations pass only when the currency-matched basket
  total equals the authorized intent total; offering and quantity checks remain
  per correlated line.
- [G4] Database constraints and migration preflight prevent duplicate line
  claims without mutating ambiguous existing data; replay and line-N failure
  tests prove transactional safety.
- [G5] Checkout POST response and existing typed errors remain stable; tests
  prove an internal writer-invariant failure returns the existing retryable
  failure and no URL.
- [G6] A changed catalog price cannot alter a queued/manual refund event's
  stored entitlement amount, currency, or Shopify order-line identity, and no
  unsupported provider call is made.

## Next action

- Hand off to implement.
