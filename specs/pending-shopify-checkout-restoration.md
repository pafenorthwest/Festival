# Restore Pending Shopify Class Checkout After Login

**Status:** Implemented; final automated checks and genuine unpaid abandoned-checkout acceptance passed. Live payment completion, partial-to-full payment and refunds remain unverified.
**Approval:** User approved the specification: “approved proceed”.
**Created:** 2026-11-15
**GitHub issue:** [#410](https://github.com/pafenorthwest/Festival/issues/410)

## Problem and intended result

A parent adds one child's Solo Class registration, navigates to Shopify, and leaves
without paying. After another login, Festival shows an empty cart and allows the
parent to rebuild it. Checkout then rejects the new submission because the original
checkout is still outstanding.

After login or reload, Festival must discover that customer's unresolved checkout,
verify its current state with Shopify, show **Cart (1)**, and prevent new class
registrations until the outstanding checkout is completed or safely resolved.
The parent can review the saved registration and continue the same checkout.

Shopify is authoritative for current cart contents and payment state. Festival
remains authoritative for customer ownership, registration details, eligibility,
and confirmed entitlements. A database copy of Shopify state is a locator,
last-known observation, or audit record; it cannot establish the current balance.

## Scope and relationships

- Restore submitted class checkouts across logout/login, reload, and another device.
- Scope discovery and the new-registration gate to the authenticated customer within
  the organization, across children and festivals, matching existing admission locks.
- Reuse existing checkout/cart identifiers and registration snapshots; query Shopify
  live before presenting actionable checkout or payment information.
- Support same-owner resume across renewed sessions without creating another cart.
- Preserve partial, pending, authorized, paid-but-processing, and uncertain payments.
- Keep existing server admission, idempotency, correlation, and entitlement safeguards.

Related work: [#260](https://github.com/pafenorthwest/Festival/issues/260) covers
broader multi-line checkout recovery with replacement; this proposal restores the
existing cart and does not implement that replacement workflow. Coordinate with
the checkout/recovery review in [#357](https://github.com/pafenorthwest/Festival/issues/357).
[#406](https://github.com/pafenorthwest/Festival/issues/406) concerns membership
recovery CSRF; this class-checkout proposal requires current-session CSRF/origin
checks but does not change membership recovery. It does not supersede broader policy.

Non-goals: general persistence of drafts before checkout; editing or merging a
submitted Shopify cart; automatic discard or replacement on expiry; a new cancel
checkout action; deposit/installment policy; new refunds or payment capture;
changes to registration windows, capacity, eligibility, or paid-line allocation.

## Original defect evidence

These references describe the starting revision
`f5ce41811e6f4213a0e7e6f7b116518755133387`, before this implementation.

| Area | Code-derived behavior |
|---|---|
| Handoff | `packages/frontend/src/domains/registration/registrationPageActions.ts:175` calls `cart.completeCheckout` on `pagehide`; `packages/frontend/src/pages/registrationCartState.ts:234` removes submitted lines before payment is established. |
| Local state and navbar | `packages/frontend/src/lib/parent-registration-state.ts:26` keeps carts in application memory; session binding at line 72 can clear them. `packages/frontend/src/components/AppHeader.tsx:64` counts only the local cart. |
| Discovery | `packages/frontend/src/domains/registration/registrationPageEffects.ts:47` discovers restart references only on the cart page. `packages/backend/src/domains/class-checkout/class-checkout-recovery-ops.ts:107` finds restartable carts, not all unresolved checkouts. |
| Existing live reads | `packages/backend/src/checkout/shopify-membership-checkout-client.ts:81` queries `cart(id)` for its checkout URL; line 103 inspects buyer, correlation, quantities, variants, and intent-line attributes. |
| Durable linkage | `packages/backend/src/repo/postgres-schema.ts:307` stores Shopify cart/customer linkage; lines 314, 332, and 357 define intents, execution records, and intent lines. |
| Session restriction | `packages/backend/src/domains/class-checkout/class-checkout-recovery-preflight.ts:279` requires the original session ID and idempotency key before normal ready-state recovery returns a URL. |
| Payment discovery gap | `packages/backend/src/domains/commerce-projection/shopify-webhook-service.ts:33` accepts only `orders/paid`; `shopify-orders-client.ts:251` discovers only `financial_status:paid`. |
| Nonterminal payment gap | `packages/backend/src/domains/commerce-projection/class-order-projection-validator.ts:60` returns `order_not_paid`; `shopify-order-projection-service.ts:100` skips prior terminal decisions. Partial observations must not enter that terminal-rejection path. |
| Admission and restart | `packages/backend/src/domains/class-checkout/checkout-intent-queries.ts:187` takes a customer-scoped lock; `checkout-execution-restart-queries.ts:114` checks locally observed order/payment evidence. Local absence is insufficient evidence for replacement. |

## Required behavior

### 1. Discover and verify the outstanding checkout

Resolve organization and customer from the authenticated session. Find candidate
intents, execution records, and cart references for that owner, including locally
expired records whose remote outcome remains unresolved. Do not require a browser
idempotency key, original login session, current festival, or browser storage.

Query the stored cart ID against its verified Shopify storefront. Extend the
existing cart inspection to read quantities, current estimated costs, and required
presentation fields. Verify customer ownership, cart correlation, and complete
intent-line identity before combining Shopify data with Festival's saved child,
teacher, accompanist, and repertoire details. Preserve existing exact line mapping;
never guess by array position or by a shared class/variant alone.

Discover associated Shopify orders across financial states, using a known order ID
where available and otherwise a verified, bounded order-discovery strategy. Validate
shop, customer, correlation, and lines. Do not assume cart IDs directly resolve to
orders or that arbitrary custom attributes support Shopify search filters. Follow
pagination; incomplete scans, ambiguous matches, missing identifiers, or multiple
orders claiming one checkout produce an unresolved review state. Do not select an
arbitrary first result or interpret a search-limit timeout as absence of payment.

The implementation must demonstrate the supported discovery strategy against the
pinned Shopify API and granted scopes before enabling resolution decisions. If
evidence cannot be obtained completely, keep the checkout blocked with recovery.

### 2. Classify live state without losing payment activity

| Verified state | Cart display and permitted action |
|---|---|
| Existing matching unpaid cart, no conflicting order/payment evidence | Show live registration count and saved details; allow **Continue checkout** for that same cart. |
| Order payment pending or authorized | Show **Payment pending**; preserve registrations and block new registrations. Offer a supported order action only when verified. |
| Order partially paid | Show verified received amount, balance, and currency; preserve the original order and registrations. Continue its balance payment only through a supported verified Shopify path; otherwise provide review/support guidance. |
| Fully paid, registration projection incomplete | Show **Payment received — confirming registration**; retain processing state until existing validated projection finishes. |
| Fully paid and registration confirmed | Remove the pending cart presentation and release its registration gate; confirmed registrations remain in account history. |
| Missing cart, local expiry, unavailable Shopify, incomplete or conflicting evidence | Show **Checkout status needs checking** with retry/recovery; retain unresolved state and block replacement. |
| Cancellation, refund, void, or other financial exception | Retain evidence and use existing reviewed resolution policy; do not equate a status label with permission to discard or charge again. |

A valid cart response alone does not rule out an order or payment activity. A null
cart, no paid webhook, no entitlement, or local expiry does not prove abandonment.
Partial payment never allocates arbitrary classes or creates partial entitlements.
Preserve the current full-payment approval policy and exactly-once finalization.

Live reads provide observations, not an atomic transaction with Shopify. Preserve
existing database locks and execution checks; revalidate local/provider state before
resume and any existing lifecycle transition that could permit another charge.
Existing restart/new-checkout APIs must not bypass an unresolved financial gate.
No new automatic replacement or unsafe-unlock path is introduced by this feature.

### 3. Restore shared UI state and guard registration

Load the account-level checkout state when the customer session becomes available,
and refresh on relevant return navigation, `pageshow`, window focus/visibility,
resume results, and payment/projection updates. Coalesce refreshes and ignore stale
responses after logout, account change, organization change, or a newer request.
Clear private display state immediately on sign-out; retain durable server linkage.

Model an unresolved submitted checkout separately from an editable draft. Handoff
transitions into pending verification instead of treating navigation as payment.
The navbar shows the verified registration count, opens that checkout's review,
and routes to its owning festival even when another festival is active. Never add
the submitted lines twice by combining a restored checkout and a local draft.

During initial verification, disable add/register and checkout-creation actions.
During unresolved checkout, display: **You have an unfinished checkout. View your
cart to continue or resolve it before adding registrations.** Browsing remains
available. Existing drafts may remain visible but cannot be submitted or merged.
On provider failure, show retry and the saved selections as last-known details;
do not present an unknown count or balance as verified zero. Server guards remain
authoritative for stale tabs and direct API calls.

### 4. Add owner-authenticated discovery and resume contracts

Proposed endpoints, following the existing customer-route/security conventions:

```text
GET  /api/organizations/:slug/customer/pending-checkout
POST /api/organizations/:slug/customer/pending-checkout/:reference/resume
```

The GET is read-only, authenticated, and `Cache-Control: no-store`; it does not
create, restart, supersede, or finalize a checkout. It requires no CSRF token.
POST requires the current authenticated owner, valid CSRF/origin checks, and a
fresh verification of the same checkout. It returns a fresh validated HTTPS URL
only for the verified shop and supported continuation. It never creates a new cart
or obtains authority merely from possession of a recovery reference. Preserve the
original intent/execution identity and idempotency; do not rewrite historical
session ownership to pretend this is the original request.

An optional client-owned `Idempotency-Key` on resume requests a boolean
`submissionMatched` association proof. It is never an authorization credential or
a requirement for renewed-session resume. Only a successful matching resume can
register cleanup of that browser's frozen submitted lines; unrelated drafts stay
intact and no stored server key is returned.

Use a shared customer-safe DTO with an explicit state, opaque recovery reference,
owning festival, verified registration count/details when available, verification
time, available actions, and verified money/currency when relevant. Represent
unknown values explicitly. An empty result means no unresolved candidate, not a
swallowed upstream failure. Return safe retry/review information for unresolved
results. Keep raw Shopify IDs, cart keys, access tokens, idempotency keys, and
internal correlation metadata server-side. A resume response may expose only the
validated navigation URL required by the browser.

### 5. Reuse storage and existing payment processing

No new payment-state or payment-history tables are required by the baseline design.
Reuse checkout intents, carts, execution records/events, line snapshots, existing
order references, and confirmed entitlements. Any retained financial observation
is explicitly last-known and cannot override live Shopify verification. Historical
paid evidence must not be erased when a later read fails or reports a refund.

Do not store a navbar counter or duplicate registration selections. Add only proven
missing linkage/indexes needed for reliable discovery and query performance. If
additional order events are used to wake reconciliation or persist order pointers,
widen the `shopify_webhook_deliveries` topic allowlist currently restricted to
`orders/paid` (`packages/backend/src/repo/postgres-schema.ts:652`) with a matching
migration, schema bootstrap update, and tests. Do not grant payment-write scopes.

Keep partial/pending/authorized observations out of the current terminal rejection
path. A later verified full payment must still reach the existing approval flow
exactly once. Duplicate or out-of-order events trigger current provider reads;
they must not regress verified payment/projection state. Existing paid-order
webhooks and reconciliation remain responsible for confirmed registration writes.

## Implementation boundaries

1. Add the customer-level candidate query and bounded live cart/order verifier;
   establish order discovery, completeness, unavailable-state, and exact-line tests.
2. Add shared DTOs and secured read/resume routes; reuse current execution identity
   and admission locks, and close existing restart/admission bypasses for unresolved
   payments. Make only evidenced schema/linkage changes if required.
3. Add shared frontend pending state, navbar/review presentation, session refreshes,
   and registration gates; change handoff semantics without duplicating drafts.
4. Connect payment/projection refresh and verify pending-to-confirmed transitions.
   Document any supported order-balance continuation limitation as review fallback.

## Acceptance criteria and verification

| ID | Required evidence |
|---|---|
| AC1 | Reproduce the reported one-child Solo Class flow: Shopify handoff, no payment, logout/login, **Cart (1)**, saved details, new registration blocked, same-cart resume. Frontend flow plus backend integration tests. |
| AC2 | Reload/new device/new session restores without original browser keys. Multi-item cart count and exact child/class mapping survive reordered lines; active-festival changes still open the owning cart. |
| AC3 | Different customer/organization and tampered recovery references cannot view or resume another checkout. CSRF, origin, configured-shop URL, and storefront binding checks pass. |
| AC4 | Partial payment survives login and local expiry, displays verified received/balance, creates no entitlement or new cart, then reaches full-payment confirmation exactly once. |
| AC5 | Pending/authorized payment, paid-but-processing, refund/cancel/void ambiguity, unavailable/missing cart, and Shopify outage remain visible and appropriately blocked. Retry recovers without charging again. |
| AC6 | Missing/delayed/duplicate/out-of-order webhooks cannot hide partial payment, prevent later full-payment approval, duplicate entitlements, or regress confirmed state. Test direct live reads and existing projection integration. |
| AC7 | Orders/candidates beyond the first page are discovered. Scan limits, inconsistent correlation, multiple matching orders, and missing identifiers produce unresolved review rather than an empty result. |
| AC8 | Logout/account switches, stale async responses, concurrent tabs, repeated resume, and payment racing with resume/restart cannot leak private state, bypass the registration gate, or create replacement carts. |
| AC9 | Existing eligibility, idempotency, paid-line identity, recovery, and confirmed-registration tests remain green. GET has no lifecycle writes; local expiry and absence of payment records cannot authorize replacement. |

Run targeted backend/frontend suites covering these criteria, then applicable
common/backend/frontend builds and `bun run format:check`. If SQL changes are
needed, also run `bun run check:sql`, `bun run check:schema-parity`, and the relevant
PostgreSQL integration suites. Use the repository's pinned toolchain. Verify the
reported flow in a Shopify test environment, including a supported partial-payment
fixture; clearly report any provider capability unavailable for end-to-end testing.

## Shopify references

- [Cart lookup by ID](https://shopify.dev/docs/api/storefront/2026-07/queries/cart)
- [Cart fields](https://shopify.dev/docs/api/storefront/2026-07/objects/Cart)
- [Order and financial fields](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)
- [Webhook ordering and reconciliation](https://shopify.dev/docs/apps/build/webhooks)

The user approved this specification and authorized implementation within these
boundaries. Implementation and verification evidence follows.

## Implementation evidence

- Added authenticated account-level discovery and current-session CSRF-protected
  resume endpoints, with both UUID and PostgreSQL `CCR-…` recovery references.
- Existing database records locate the checkout and its Festival registration
  snapshots. Current contents, estimated cost, and payment amounts come from live
  Shopify reads; no payment-copy tables, schema migration, or payment-write scopes
  were added. Historical receipt timestamps survive incomplete later observations.
- Complete, bounded order discovery covers financial states and pagination. Missing
  identity on overlapping merchandise, conflicting orders, unavailable evidence,
  and scope/history limits retain a blocked review state.
- Shared frontend state restores the navbar and saved details, routes to the owning
  festival, blocks new registrations, and survives account/navigation races without
  duplicating drafts. Same-owner resume can reconnect an expired buyer token to
  the original cart before independently verifying ownership and issuing its URL.
- Original checkout deadlines still apply: expired unpaid carts remain visible
  for review and cannot receive a new payment link or automatic replacement.
  Partial/pending payments use original-order/festival-office guidance; this change
  does not introduce a balance-collection URL, capture, or refund operation.
- Backend and PostgreSQL tests cover live-state classification, ownership, CSRF,
  exact line identity, expired-cart admission, payment retries/history, races, and
  public Nginx routing. Frontend tests cover restoration, handoff, navigation,
  session changes, outages, and registration guards. Final results are recorded in
  `tasks/pending-shopify-checkout-restoration/spec.md`.
- Follow-up live read-only testing found PostgreSQL timestamp text must be
  normalized to UTC before order discovery; this boundary now has a regression.
  Recovery errors force a new verification generation rather than joining an older
  request, and frozen-cart labels describe saved selections rather than promising
  checkout readiness. Same-submission proof protects later browser-cart cleanup.
- Genuine sign-in and Order History returned HTTP 200 in both sessions. The unpaid
  Solo checkout → logout/relogin → Cart 1 flow, reload, registration guard and
  same-cart resume passed against the confirmed development store. See
  [live E2E evidence](../tasks/pending-shopify-checkout-restoration/live-e2e.md).
  No payment was attempted; one synthetic performer and unpaid test checkout remain.
  Live payment completion, partial-to-full payment and refunds were not executed.
  A matching test gateway is known, but no controlled partial-payment fixture was
  exercised. Automated payment-state coverage does not establish live payment acceptance.
