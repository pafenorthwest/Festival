# Deterministic class checkout recovery

## Approved direction and core invariant

Implement option 2: one Festival idempotency key identifies an immutable checkout submission and remains stable across recoverable failures. All Festival idempotency keys stay inside Festival. Shopify receives only the existing independently generated correlation and intent-line IDs for later order matching.

**Before a request returns `recovery_required`, Festival must commit the recovery result and supporting evidence and clear the worker lease in the same transaction.** Repeated requests replay that recorded result. Unknown does not mean failed, safe to recreate, or still owned by a live worker.

If the database is unavailable when recording a result, the response must not claim durable recording. A pre-dispatch checkpoint survives the outage; lease expiry is deterministically converted to recovery-required before another worker can execute. No unknown external creation is automatically repeated.

## Scope

Extend existing class checkout intents with immutable payload binding, durable execution/evidence records, leased and fenced execution, customer-safe recovery status, audited operator resolutions, and actual-hook frontend tests. Keep the current memory-only frontend cart. Preserve existing membership behavior, registration rules, payment projection identity, and capacity admission policy. Do not introduce a new frontend cart identity or promise a distributed transaction with Shopify.

## State and evidence

Persist the canonical submission fingerprint and festival/owner scope before external work. Reject the same key with different contents. Store execution phase, lease owner/generation/expiry, dispatched timestamp, sanitized failure category, known Shopify cart identity in server-only storage, recovery reference, recorded customer result, and append-only resolution/evidence history. Never put buyer access tokens, secrets, raw request bodies, or idempotency keys in public recovery DTOs or routine logs.

Use deterministic outcomes for local preparation, external creation dispatched, known external cart, local attachment complete, resumable URL lookup, recovery required, completed, and audited terminal resolution. Existing historical failures without phase evidence are conservatively recovery-required when their safety cannot be established.

## Failure and resolution policy

| Evidence | Request behavior | Resolution |
| --- | --- | --- |
| External request definitely not dispatched | Retry the same submission after idempotent local preparation | Claim a new execution generation under the same identity |
| Creation dispatched, no trustworthy result | Commit recovery-required and release lease; do not create another Shopify cart | Await late evidence or audited operator disposition |
| Shopify cart ID known, local attachment incomplete | Persist the known ID and recovery evidence | Verify ownership/correlation/lines, then attach the same cart under existing capacity policy |
| Cart attached, URL query fails | Preserve the attached cart and stable identity | Retry the read for that exact cart; do not supersede or recreate it |
| Explicit business rejection or completed order | Replay the authoritative result | Do not reopen completed work |

A customer status request only observes state or resumes an existing known cart; it never blindly repeats `cartCreate`. Recovery references are scoped to the authenticated owner and organization and are not authorization credentials.

Late external results are retained as evidence even after their worker lease is lost; they cannot mutate operation state without a new valid claim. Resolution can adopt a verified known Shopify cart, confirm completion from a validated paid order, or record explicit operator abandonment with a reason and evidence. Abandonment retains the original submission and all correlation/line IDs, records the uncertainty and duplicate/orphan risk, and controls whether replacement is authorized. It must never state that a local expiry or local supersession cancelled Shopify.

An unknown result with no discoverable external cart remains a recorded recovery-required case until an audited decision. Existing APIs do not provide magic cart discovery by Festival idempotency key. This is an acceptable deterministic result, rather than an endless processing flag.

Application expiry preserves the original deadline. It records `checkout_expired`
recovery for an unfulfilled known cart and clears its worker lease; it never extends
the window or asserts that Shopify cancelled the cart. Replacement under another
key/session remains blocked until explicit audited abandonment. The outcome is
independent of whether a status lookup happened before the replacement request.
Successfully fulfilled operations remain terminal.

## Concurrency controls

1. Bind owner/festival/key to one immutable fingerprint transactionally. Preserve the existing customer admission lock and make unresolved class operations block a different key from bypassing recovery, including another browser session.
2. Use short database transactions to claim a bounded worker lease and increment its fencing generation. Never hold a database transaction or capacity lock during Shopify I/O.
3. Commit the external-dispatch checkpoint before sending creation. After a crash, a checkpointed dispatched call is unknown unless later durable evidence proves otherwise.
4. Require lease owner and generation for every state transition. Lease expiry grants no permission to recreate an unknown Shopify cart. Expired pre-dispatch work may resume; expired dispatched work becomes recovery-required.
5. Atomically append evidence, store the customer result, and clear the lease. A response is sent only after this commit succeeds. Concurrent requests replay the same result or report processing without acquiring a second worker.
6. Preserve valid late evidence with deduplication, but fence stale writes. Operator resolution uses compare-and-set revision checks and an audit entry so simultaneous decisions cannot both win.
7. Preserve atomic cart attachment and existing authoritative capacity checks. Existing attached-cart resume must not be blocked by fresh advisory frontend eligibility.

## Frontend and API behavior

Keep successful checkout responses compatible. Add a safe recovery result containing status, recovery reference, reason code, and `retryAllowed:false`; expose an authenticated status check. Preserve cart contents and key on recovery and network uncertainty. Show a status-check action and reference without automatically resubmitting creation. The server owns cross-session guards.

Authenticate status and recorded-result replay locally before any OAuth token refresh, so a Shopify outage does not prevent observing committed recovery evidence. Bind status-triggered known-cart resume to the frozen Festival request key; a reference from another submission must not redirect to an unrelated cart or clear the currently displayed registrations.

After the server records an audited abandonment (`resolved` with `abandoned_unknown` or `checkout_abandoned`), expose an explicit customer action to prepare a new submission. That action preserves the registrations, releases the old frozen snapshot, and resets its cached key; it makes no automatic checkout request. Completed, under-review, or other rejected results do not authorize this transition.

Keep the cart locked through external navigation rather than unlocking after `location.assign` returns. Cleanup removes only the submitted snapshot. The actual hook must be tested with a pending browser navigation.

## Implementation sequence and file ownership

1. Add shared recovery types and schema/repository persistence, migration, canonical SQL snapshot, claim/fencing/evidence APIs, and in-memory parity.
2. Replace blanket class-checkout failure handling with phase-aware deterministic outcomes, idempotent preparation, safe resume, and recovery-required recording.
3. Add owner-scoped customer status and authorized audited operator resolution operations; wire application services without changing unrelated membership lifecycle.
4. Integrate stable frontend submission state, recovery presentation/status refresh, and locked snapshot handoff.
5. Exercise failure injection, crash windows, concurrent workers, stale generations, late results, operator races, and boundary privacy. Review all modified paths against these invariants.

## Verification matrix

- Same key/same payload replay; same key/changed payload conflict; owner/festival/session isolation.
- Safe pre-dispatch failure retries without duplicate metadata; ambiguous cart creation never issues a second create.
- Recovery result/evidence/lease release commit atomically; recording failure does not produce a false durable-success response.
- Crash before dispatch, after dispatch, after cart response, during attachment, and before response publication; deterministic lease-expiry conversion.
- Known-cart URL failure and browser response loss resume the exact cart; attached resume survives advisory capacity changes.
- Concurrent identical requests execute once; alternate key/session cannot bypass an unresolved operation; stale workers cannot change state.
- Late result evidence remains available; evidence deduplication and concurrent operator decisions preserve one winning resolution and a full audit trail.
- Customer status and admin resolution authorization; no raw keys, Shopify cart IDs, access tokens, or unsanitized upstream messages leak to customer DTOs/logs.
- Actual frontend hook preserves key/cart/reference on recovery, status refresh does not create blindly, handoff stays locked, and cleanup preserves unsent lines.
- Migration/snapshot parity and real PostgreSQL concurrency/rollback tests. Skipped integration tests are reported as unverified, never as passing concurrency evidence.

## Pinned validation

Run native PowerShell commands from the repository root:

```powershell
bun run verify:toolchain
bun run build:common
bun run --cwd packages/backend lint
bun run --cwd packages/frontend lint
bun test packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/customer-registration.routes.test.ts packages/backend/tests/checkout-repository.test.ts packages/backend/tests/postgres-checkout-repository.test.ts
bun run --cwd packages/frontend test
bun run check:sql
bun run --cwd packages/backend build
bun run --cwd packages/frontend build
```

Run newly added recovery unit and integration suites explicitly, with `POSTGRES_INTEGRATION_URL` configured for a disposable test database. Pin the final concrete filenames in the delivery record. Do not access live Shopify or production data for verification.

## Completion criteria

The core invariant is demonstrated by repository and service tests; unknown creation is deterministic and cannot be bypassed; known carts resume without replacement; all claims/resolutions are fenced and audited; frontend behavior preserves work; privacy boundary tests pass. Document any remaining unavailable PostgreSQL runtime verification or operator recovery limitation explicitly.

## Recovery operations and evidence

An Admin can list recorded class recoveries through
`GET /api/organizations/:slug/admin/class-checkout-recoveries`, optionally filtering
by `customerId`. This returns scoped references, generations, checkpoints and
sanitized event summaries. It never returns Festival idempotency keys or Shopify
cart access secrets. The existing membership recovery token flow remains separate.

Resolve through
`POST /api/organizations/:slug/admin/class-checkout-recoveries/:reference/resolve`
with Admin authentication, the existing origin/CSRF boundary, a short human reason,
and `expectedGeneration` from the listing. Stale decisions return a conflict.

- `adopt_cart`: supply `evidenceEventId` from a late result, a securely obtained
  `shopifyCartId`, or use a single already-known candidate. The server independently
  verifies the pinned integration, buyer, correlation, complete line IDs, variants,
  and quantities. Ambiguous/mismatched evidence remains unresolved. A cart never
  admitted locally must undergo the current atomic capacity admission checks.
- `retry_pre_dispatch`: available only when the durable checkpoint proves creation
  was never entered; it cannot reset a dispatched creation back to a fresh create.
- `abandon_unknown`: requires `acknowledgeUnknown: true` and an audited reason.
  This closes the local operation and permits an explicitly initiated replacement,
  while retaining every old identifier/event. It does not cancel Shopify. The
  frontend offers an explicit new-checkout action only after this recorded closure;
  it preserves the entered cart and generates a new operation key at that point.

Late paid-order evidence flows through the existing verified webhook/reconciliation
pipeline. Unadmitted or abandoned operations cannot gain grandfathered capacity
rights; payment is recorded for review without automatic registration grants.
Payment finalization fences old workers and records its evidence in the same
database transaction. Evidence requiring payment review remains an operational
review case; cart adoption or abandonment cannot override an existing paid decision.

Customer status is checked at
`POST /api/organizations/:slug/customer/festivals/:festivalShortName/registration/checkout/status`
using the authenticated local session, CSRF header, and recovery reference. An
existing recorded result can be read without refreshing Shopify OAuth access.
The submitted Festival key remains in the Festival request header, and a different
key/session cannot receive another submission's checkout URL.

Expired leases are recovered lazily on relevant requests and by a bounded
maintenance pass: `bun run reap:class-checkout`, using the deployed database
configuration, or `bun --env-file=database.env run reap:class-checkout` for an
explicit environment file. An Admin can run an organization-scoped pass through
`POST /api/organizations/:slug/admin/class-checkout-recoveries/reap`. Run the
maintenance command periodically and after database/process outages. Provisioning
a production schedule and applying the deployment migration are deployment work;
this implementation does not change the configured application database.

The lock order is capacity admission (when applicable), then customer admission,
then checkout execution, then execution rows. Short state-only operations can
omit locks they do not need but never acquire an earlier lock afterward.
