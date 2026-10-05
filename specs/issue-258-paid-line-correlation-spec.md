# Issue #258: Exact Paid-Line Correlation for Class Entitlements

## Status, authority, and decision

**Issue:** [#258 — Correlate paid Shopify line identity before historical class-refund allocation](https://github.com/pafenorthwest/Festival/issues/258)

**Baseline:** detached `HEAD` and `origin/main` are both
`dea2aad4bc3717ec688ef68bb2bc19dfcbb9d00b`; the working tree was clean during
this review.

**Current-flow reference:** [Issue #258 current checkout graph](issue-258-current-checkout-graph.md).

This specification is based on the current code, interfaces, tests, and the
documentation under `specs/`. The older Phase 2 plan describes an intentionally
single-line checkout and is historical context, not the implementation contract.

### Decision

For every new class checkout intent line, Festival will require an exact,
one-to-one match with a paid Shopify order line using the opaque UUID in the
line-level custom attribute:

```text
festival_checkout_intent_line_id = checkout_intent_lines.id
```

The mapping is a bijection, is independent of line order, and has **no**
position-, product-, class-, or variant-based fallback. A missing, blank,
malformed, unknown, repeated, or non-bijective value leaves the checkout
non-approved (`needs_review` unless an existing classification requires
`rejected`), creates no class entitlement, and creates no refund record.

Product, variant, quantity, currency, and payment checks happen **after** this
identity match. Each paid-line allocation is persisted on the entitlement, but
discounts may move allocation between valid lines: authorization remains the
currency-matched aggregate amount for the complete basket. No validation may
require a line allocation to equal a later catalog price or an undiscounted
line price.

There is no material product-behavior ambiguity remaining in #258. The
currently wired production app has no line-targeted refund provider and must
not acquire `write_orders` in this issue. The refund policy below therefore
records an immutable, line-specific manual-refund instruction; a future
write-capable provider is a separate authorization change.

## Goals

1. Correlate each paid class line to exactly one persisted checkout intent line
   before the projection can approve an order.
2. Persist the identity and historical paid allocation together on the matching
   `ClassEntitlement`, regardless of paid-order line order or duplicate
   product/variant purchases.
3. Read custom attributes from paid **lines** for both webhook processing and
   reconciliation, without exposing them in browser DTOs.
4. Make the database enforce the one-entitlement-per-intent-line half of the
   mapping and make projection failure atomic and retry-safe.
5. Keep browser return processing-only; only a verified paid-order read can
   create entitlements.
6. Preserve existing single-line compatibility without weakening new checkout
   validation, and preserve the current multi-line selection, eligibility,
   tenancy, CSRF, and idempotency boundaries.
7. Preserve the paid allocation and order-line identity used for a later
   line-specific manual refund or a future explicitly authorized provider.

## Non-goals

- Changing class selection, registration windows, capacity/waitlist policy,
  prerequisite rules, catalog/product synchronization, or child/teacher/
  accompanist eligibility.
- Treating a thank-you return, frontend cart state, or customer account page as
  payment confirmation.
- Adding Shopify `write_orders`, any extra line-attribute permission, a new
  product/variant migration, or a new checkout UI.
- Automatically guessing a correlation for historical or malformed orders.
- Repricing a historical entitlement or allocating a discount equally across
  siblings.

## Existing behavior and defect

The implementation already creates `N` intent lines and writes each full line
UUID into its own Shopify cart-line attribute
(`packages/backend/src/checkout/class-checkout-service.ts:516-552`). The
Storefront cart also carries the existing order-level correlation UUID,
`festival_checkout_intent_id` (`packages/backend/src/checkout/shopify-membership-checkout-client.ts:29-81`).

The Admin paid-order contract currently omits line attributes
(`packages/backend/src/shopify/types.ts:135-147`; `packages/backend/src/shopify/admin-api-client.ts:395-426,1169-1200,1316-1348`). The multi-line
projection then validates and finalizes via `order.lineItems[index]`
(`packages/backend/src/commerce/shopify-order-projection-service.ts:658-692,850-879`). A Shopify ordering change, or two children purchasing the same
variant, can bind a legitimate paid line to the wrong child, metadata, and
class entitlement. The current unique index protects only a Shopify order line,
not the intent-line side of the relationship.

The relevant user-facing API remains unchanged:

```text
POST /api/organizations/:slug/customer/festivals/:festivalShortName/registration/checkout
Headers: X-CSRF-Token, Idempotency-Key (UUID)
Body: { lineItems: ClassCheckoutLineItemInput[] }
Response: { checkoutUrl, correlationId }
```

The client must continue to send this API contract and must receive no Shopify
line attributes or paid allocations.

### Checkout POST error contract

Issue #258 adds **no new browser-visible typed error** to
`POST .../registration/checkout`. Paid-line correlation is impossible to verify
until Shopify reports a paid order, after the POST has returned and the browser
has redirected. Its failure is the existing server-side
`needs_review` decision with reason `correlation_invalid`, not an HTTP error
response or a new `paid_line_*` client code.

Keep the existing typed initiation failures (`checkout_in_progress`,
`checkout_already_completed`, `checkout_expired`,
`checkout_terminal_failure`, and `checkout_retryable_upstream`) and the
existing validation codes. If the pre-cart writer invariant detects missing,
duplicate, or non-UUID durable line IDs, compensate the attempt, return the
existing safe `503` / `checkout_retryable_upstream` response, and return no
checkout URL or identity details. This is an internal persistence/invariant
failure that the customer can only safely retry; it is not the paid-line
correlation decision.

## Required implementation

### 1. Make checkout writer identity total and explicit

**Files:** `packages/backend/src/checkout/class-checkout-service.ts`,
`packages/backend/src/checkout/checkout-line-helpers.ts`, relevant checkout
repository implementations and tests.

1. Define one shared server-only constant for
   `festival_checkout_intent_line_id`; use it in both cart writing and paid-line
   correlation. Keep the existing order-level
   `festival_checkout_intent_id` constant separate.
2. Before `createCart`, require that the durable intent has exactly one line
   for every validated request line, in the same locally constructed mapping,
   and that every line ID is a distinct canonical UUID. A broken local
   persistence result is a checkout failure; never emit `""` as the attribute
   value.
3. Emit one cart line for each validated line with:

   ```ts
   {
     merchandiseId: intentLine.shopifyVariantGid,
     quantity: 1,
     attributes: [{ key: "festival_checkout_intent_line_id", value: intentLine.id }],
   }
   ```

   The value is the complete opaque persisted UUID, not a class ID, product ID,
   variant ID, line index, prefix, or hash.
4. Retain the cart-level correlation attribute and buyer identity exactly as
   today. The correlation resolves an order to one checkout intent; the new
   line UUID resolves each paid line inside that intent.
5. Keep existing compensation: a metadata/cart failure marks the intent failed
   and supersedes its cart. Do not return a checkout URL if any line’s identity
   cannot be persisted and emitted.

### 2. Read paid-line custom attributes in both Admin read paths

**Files:** `packages/backend/src/shopify/types.ts`,
`packages/backend/src/shopify/admin-api-client.ts`,
`packages/backend/tests/shopify-admin-api-client.test.ts`.

1. Extend the server-only `ShopifyPaidOrderLine` contract with:

   ```ts
   readonly customAttributes: readonly ShopifyOrderCustomAttribute[];
   ```

   This is server-only. Do not add it to customer, admin browser, webhook
   payload, or logging DTOs.
2. Add `customAttributes { key value }` below `lineItems.nodes` in both Admin
   GraphQL reads:

   - `readPaidOrderByGid` (webhook projection); and
   - `listPaidOrdersSince` (reconciliation).

   Keep the existing order-level attributes query; it continues to supply the
   checkout correlation ID.
3. Make the paid-order parser require an array of line custom attributes and
   string-shaped key/value fields. Reject an incomplete Admin response instead
   of silently treating malformed data as an empty set. The correlation helper,
   rather than the general mapper, must fail closed for a blank, duplicate, or
   malformed value of the *identity-key* attribute; unrelated Shopify
   properties must not weaken or spuriously block the identity check. Preserve
   the existing bounded-line pagination rejection.
4. Use the same mapper in both paths so reconciliation cannot obtain a weaker
   order shape than webhook processing.

### 3. Correlate before validation or finalization

**Files:** `packages/backend/src/commerce/shopify-order-projection-service.ts`,
`packages/backend/tests/class-order-projection.test.ts`.

Add a small pure helper (for example, `correlateClassPaidLines`) that receives
the persisted intent lines and paid lines and returns either a complete list of
`{ intentLine, paidLine }` matches or a correlation failure. Do not return a
partial result.

For class intents created by the current writer, the helper must enforce all of
the following:

1. The expected intent-line ID set is non-empty, contains canonical UUIDs only,
   and contains no duplicate IDs.
2. The number of paid lines equals the number of expected intent lines.
3. Every paid line has exactly one custom attribute with the line-identity key.
   The value is a non-empty canonical UUID.
4. Each value is in the expected set exactly once. This rejects an unknown
   value, a duplicate paid value, multiple identity attributes on one paid
   line, and an expected line that was not represented.
5. No correlation may use cart/order index, class, product, variant, quantity,
   amount, child, or metadata as a substitute identifier.

Only after this helper succeeds, validate every matched pair:

- paid `productGid` equals the matched line’s stored product GID;
- paid `variantGid` equals the matched line’s stored variant GID;
- paid quantity is exactly one;
- each paid-line currency equals the intent currency and its amount parses into
  exact minor units; and
- order currency equals intent currency and the sum of matched paid allocations
  equals the intent’s stored authorized aggregate amount.

The last check deliberately permits a valid discounted basket such as expected
`$110.00` with allocations `$45.00` and `$65.00`; it rejects a wrong aggregate,
wrong currency, malformed money, partial payment, or an incomplete order. It
must not compare `$45.00` or `$65.00` with catalog price.

For a successful match, use **that match**, rather than an array index, when
creating each `ClassEntitlement`:

```text
checkoutIntentLineId = intentLine.id
shopifyOrderLineGid   = paidLine.id
paidAmountCents       = parsed paidLine.paidAmount
paidCurrencyCode      = paidLine.paidCurrencyCode
```

Registration metadata must then link only through the matching
`checkoutIntentLineId`.

Failure behavior is fail-closed:

- malformed/missing/unknown/duplicate identity values are
  `needs_review` with the existing `correlation_invalid` reason;
- business/payment mismatches retain their existing rejected/review
  classification; and
- no class entitlement, metadata entitlement link, refund event, or approved
  decision is written on either kind of failure.

The webhook and reconciliation paths already converge through
`processDelivery`; retain that convergence so their validation and finalization
semantics cannot drift.

### 4. Single-line and historical compatibility

New single-line class checkouts also create a durable intent line and must
write/read the same exact line attribute. They use the same correlation helper,
not a less strict first-element path.

The repository’s legacy intent-line synthesis remains useful only for an
already persisted historical single-line intent that genuinely predates the
line-aware checkout writer. A narrowly isolated compatibility path may process
it only when all of these facts hold:

- the order contains exactly one paid line;
- it passes the existing single-line customer, product, variant, quantity,
  currency, aggregate-payment, and expiry checks; and
- the intent has no durable line identity that was expected to appear on the
  paid line.

It must never be selected for multi-line checkout, duplicate product/variant
orders, or a current intent that simply has a missing/malformed identity
attribute. Those cases require review, not an inferred mapping. Document this
compatibility path in code and cover it explicitly, then remove it after the
defined historical-intent retention period.

### 5. Enforce durable one-to-one cardinality

**Files:** `packages/backend/src/repo/postgres-schema.ts`,
`database/postgres17-schema.sql`, a new forward migration, schema/migration
tests, and `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`.

1. Add a partial unique index on `class_entitlements(checkout_intent_line_id)`
   where the value is non-null. Intent-line IDs are globally primary-key unique,
   so a scope column is unnecessary. This prevents two entitlements from
   claiming one intent line.
2. Add a unique constraint/index on
   `checkout_intent_lines(checkout_intent_id, line_index)`. This protects the
   durable ordering field used for presentation and legacy reconstruction; it
   is not used as the paid-line identity.
3. Add the indexes idempotently to the runtime schema initializer and include
   them in the canonical PostgreSQL dump/schema. Write one forward production
   migration (for example
   `database/migrations/20261004_issue_258_paid_line_identity.sql`) rather
   than relying only on application startup.
4. The migration must first detect duplicate non-null entitlement line IDs and
   duplicate `(checkout_intent_id, line_index)` values. It must stop with a
   report for operations; it must not choose a winner, delete rows, relink
   metadata, or infer paid-line identity. Create the indexes only after the
   preflight is clean.
5. Retain the existing unique `(organization_id, shopify_order_line_gid)`.
   Make finalization’s conflict handling compatible with both uniqueness
   guarantees: a true replay of the same matched order line is idempotent, but
   any conflicting association rolls back the transaction and leaves the
   delivery retryable/diagnosable.

### 6. Refund allocation and scope-safe policy

**Files:** `packages/backend/src/registration/drop-transfer-service.ts`,
`packages/backend/src/registration/registration-change-repository.ts`,
`packages/common/src/domain.ts`, `packages/common/src/registration.ts`, tests,
and optionally a narrow refund-event migration.

The current drop flow correctly defaults to `entitlement.paidAmountCents`, but
discards `entitlement.shopifyOrderLineGid` before calling its provider. Its
legacy live client also ignores the requested amount and uses an empty
`refundLineItems` list. The app does not wire that client in production.

For #258, implement this policy without adding Shopify write access:

1. A refund request for a class entitlement must carry and audit the immutable
   `(shopifyOrderGid, shopifyOrderLineGid, paidAmountCents, paidCurrencyCode)`
   from that entitlement. Add an explicit order-line field to `RefundEvent`
   persistence so the historical allocation is independently auditable; it is
   not reconstructed from the current catalog.
2. The default full-refund amount is the stored paid allocation. Any future
   partial-refund endpoint must require an explicit authorized amount in the
   stored currency and reject a value above the unrefunded stored allocation.
   It may not use product price, current class price, or a per-order equal
   split.
3. Change `ShopifyRefundProvider`/`RefundRequest` so any injected automatic
   provider declares line-target support and receives the order-line GID,
   amount, and currency. A provider that cannot target the line must not be
   invoked for this path; retain a pending/manual refund event with clear
   operator instructions instead.
4. Do **not** wire or expand the current legacy `ShopifyAdminClient` mutation
   in this issue. This repository’s deployment boundary is `read_orders` only;
   a live `refundCreate` mutation requires order-write authorization. The
   manual record is the order-level policy for the current authorized runtime.
5. If a future, separately authorized provider is introduced, it must send the
   persisted `shopifyOrderLineGid` as a Shopify `refundLineItems[].lineItemId`,
   use the stored currency/allocation, use an idempotency key derived from the
   refund event, and verify the provider response. Shopify’s current Admin
   API documents line-item refunds through `refundCreate` and
   `refundLineItems`; see [Shopify’s refundCreate reference](https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate).

### 7. Do not weaken completion and read paths

Keep the following current interfaces unchanged except for correct correlated
data appearing in their existing responses:

- `FestivalClassRegistrationPage` clears its cart and redirects only after a
  checkout URL; it does not create an entitlement.
- `CustomerAccountService.listClassRegistrations`, billing reads, recovery
  guards, drop/transfer, waitlist promotion, and customer order history must
  operate one `ClassEntitlement` at a time. A sibling line from the same order
  cannot be cancelled, transferred, refunded, or relinked incidentally.
- Customer and admin responses must continue to redact Shopify custom
  attributes and other server-only paid-order data.

## Test plan and acceptance matrix

### Checkout, API, and contract tests

| Scenario | Layer / target | Required assertion |
| --- | --- | --- |
| Two checkout lines emit two complete distinct UUID attributes | `class-checkout-service.test.ts`, checkout storefront fake | Attribute values equal the persisted intent-line IDs exactly; no empty fallback; both lines are quantity 1. |
| Intent line persistence inconsistency | class checkout service/repository | Checkout fails and compensates with the existing `503` / `checkout_retryable_upstream`; it never sends a blank or substituted identity. |
| API security regression | `customer-registration.routes.test.ts` | Existing CSRF, cookie customer, origin, idempotency, tenant/festival, client-currency rejection, and allowed-fields behavior remains intact for `lineItems`. |
| Browser handoff regression | `multiLineCheckoutHandoff.test.ts`, cart-state tests | A successful response redirects/clears cart; an error retains cart; the browser never receives or invents paid-line identity. |

### Shopify Admin-reader tests

| Scenario | Layer / target | Required assertion |
| --- | --- | --- |
| Single-order read | `shopify-admin-api-client.test.ts` | `readPaidOrderByGid` requests and maps line `customAttributes`. |
| Reconciliation list read | same suite | `listPaidOrdersSince` requests and maps the identical line shape. |
| Malformed upstream attribute | same suite | Null/non-string/blank key or value causes a safe Admin-data failure; it is never converted to an empty attribute list. |
| Pagination | same suite | Existing line/order pagination refusal remains in place after adding attributes. |

### Correlation and projection tests

| Scenario | Layer / target | Required assertion |
| --- | --- | --- |
| Reversed different variants | `class-order-projection.test.ts` | Projection approves; each child/class/metadata record receives the GID and allocation of its UUID-matched paid line, not its old array index. |
| Reversed duplicate same variant for two children | same | Projection approves only because two distinct line UUIDs make the mapping unambiguous; children/metadata/GIDs never swap. |
| Missing, blank, invalid, unknown, duplicate, or twice-present identity | same | `needs_review`/`correlation_invalid`; no entitlement, metadata link, refund event, or approved decision. Cover a duplicate key on one paid line and the same valid ID on two paid lines. |
| Cardinality mismatch | same | Non-approved and no partial writes. |
| Product/variant/quantity mismatch after valid UUID match | same | Non-approved. This proves identity matching does not replace offering validation. |
| Shifted valid discounts | same | Example `$50 + $60` authorized and `$45 + $65` paid: approve and persist 4500/6500 cents on their UUID-matched entitlements. |
| Bad aggregate, line currency, order currency, malformed money, partial payment | same | Reject/review according to the existing payment failure policy; no entitlement. |
| Webhook and reconciliation | service/integration fake | Both paths use the same correlated paid-line result and are order-independent. |
| Replay and concurrent delivery | service plus PostgreSQL integration test | Exactly `N` correct entitlements and metadata links exist after retry/race. |
| Failure at line N | PostgreSQL finalization test with injected failure | The transaction leaves zero partial entitlements, metadata links, decision/projection writes, or delivery completion; retry yields exactly `N`. |
| New single-line checkout | projection | Requires its UUID attribute and uses correlation. |
| Historical one-line compatibility | isolated legacy test | Only the documented strictly one-line path remains; malformed current/multi-line orders cannot enter it. |

### Schema, lifecycle, and refund tests

| Scenario | Layer / target | Required assertion |
| --- | --- | --- |
| New uniqueness constraints | schema snapshot and PostgreSQL migration tests | Duplicate `checkout_intent_line_id` or duplicate intent line index cannot commit; clean rows migrate. |
| Preflight duplicates | migration test | Migration stops and reports; it does not mutate/relink historical data. |
| Customer/billing/recovery after multi-line order | account, billing, recovery tests | Each line is independently visible and guarded; projection prevents recovery/invalidation of the entire finalized intent as today. |
| Drop/transfer/promotion of one sibling | `drop-transfer-service.test.ts` | Only the selected entitlement changes. The sibling retains its identity, allocation, and lifecycle state. |
| Price changes after payment | drop/refund test | A later class-price/promotion change does not alter the stored allocation used by the manual refund event. |
| Current unsupported automatic provider | drop/refund test | No external refund call; a pending/manual event records order ID, order-line ID, stored amount, and stored currency. |
| Future line-capable provider contract | provider unit test | It receives exactly the entitlement’s order line, allocation, and currency; no order-wide/equal-split request is permitted. |

## Rollout and operational verification

1. **Preflight data.** Run the migration’s read-only duplicate checks against
   the target database. Record row counts and any conflicts. Stop for manual
   investigation if a conflict exists.
2. **Deploy schema and backend.** Apply the forward migration, then deploy the
   server changes and run the targeted tests plus the full required test suite.
   Do not silently backfill an ambiguous historical line mapping.
3. **Shopify app configuration.** Use the linked external Shopify Dev
   Dashboard/CLI app configuration; this checkout does not contain an
   app-level `shopify.app.toml` (see `packages/shopify-confirmation/README.md`).
   Configure/release the required `read_orders` capability, obtain required
   target-store administrator approval, and confirm the store token’s effective
   scope as described in `SETUP.md`. Do not request `write_orders`.
4. **Diagnostics.** Confirm each target integration shows effective
   `read_orders` permission and a healthy `ORDERS_PAID` subscription before
   accepting real checkout traffic.
5. **Live dev-store proof.** In a development store, complete one paid
   multi-line checkout with two different classes and one with two children
   purchasing the same variant. Inspect the Admin paid-order line attributes
   and prove each line exposes the exact full UUID emitted by Festival. Then
   reverse the returned test fixture order and re-run projection to demonstrate
   order independence.
6. **Refund audit proof.** After changing the current catalog price, drop one
   line from the test order. Verify the queued/manual refund event names the
   original order line and its historical paid allocation, with no effect on
   its sibling.
7. **Cutover handling.** Any order whose required line identity is unavailable
   after rollout stays `needs_review`; operations must not use list position to
   resolve it. Allow uncompleted pre-cutover carts to expire or be safely
   invalidated/restarted. Record the target store, app/config revision,
   permission diagnostic, webhook diagnostic, order IDs, and test outcome in
   the release record.

## Definition of done

- The code and database enforce the exact paid-line UUID bijection before every
  new class checkout can be approved.
- Reordered distinct and duplicate-variant paid lines produce the right
  entitlement, metadata, paid allocation, and Shopify order-line GID.
- All malformed-correlation cases fail closed with no partial business writes.
- Webhook and reconciliation use the same line-attribute read and projection
  behavior.
- Existing single-line behavior remains safely compatible without becoming a
  fallback for invalid current/multi-line orders.
- The customer return remains processing-only; only verified paid-order
  processing creates entitlements.
- Refund records preserve historical, per-line allocation and identity without
  adding Shopify write permission.
- Schema/migration, unit, route, browser-handoff, projection, PostgreSQL
  atomicity, lifecycle, and live-store verification evidence is recorded.
