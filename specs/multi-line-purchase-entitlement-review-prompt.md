Act as a skeptical senior engineer reviewing the multi-line class-purchase update. Review both the change set and the complete production flow for festival-scoped class purchases and class-entitlement management. Do not implement fixes.

First, establish the review baseline: compare the current branch and working tree to its merge-base with `origin/main` (or state the fallback baseline if unavailable). Treat existing Phase 2 planning documents as historical context, not authoritative behavior; reconcile them against the current code.

## Required first deliverable: code graph

Before writing findings, create `specs/multi-line-purchase-entitlement-graph.md`.

Use Mermaid diagrams plus a concise node/edge index with source-file and symbol references. Every graph edge must be verified in code; flag uncertain edges instead of assuming them.

Include these views:

1. Request and control flow

   `FestivalClassRegistrationPage` / cart state / reactive eligibility
   → frontend API client
   → customer registration eligibility and checkout routes
   → `ClassCheckoutService`
   → checkout intent and intent lines
   → Shopify cart and checkout redirect
   → verified Shopify webhook or reconciliation
   → `ShopifyOrderProjectionService`
   → per-line class-entitlement creation
   → customer registration/account, billing, recovery, and drop/transfer flows.

2. Persistence and identity graph

   Show the relationships and constraints among:

   - organization / tenant
   - festival
   - class configuration
   - customer, child, teacher, and accompanist
   - checkout intent, checkout-intent line, cart, registration metadata, and repertoire data
   - Shopify order and Shopify order line
   - class entitlement
   - webhook delivery and order-projection decision

   Make idempotency keys, unique constraints, foreign keys, and the expected cardinality explicit:

   `1 checkout intent → N intent lines → N Shopify cart/order lines → N class entitlements`.

3. Lifecycle and trust-boundary graph

   Show checkout-intent states and class-entitlement states, including webhook retry/reconciliation, expiry, approval/rejection/review, cancellation, revocation, waitlisting, drop, transfer, and promotion where applicable.

   Clearly distinguish browser/client data from server-authoritative validation and Shopify-verified payment data.

Also graph the distinct teacher/accompanist membership-entitlement dependency: those grants gate each class line, but are not themselves class entitlements.

## Review scope

Trace every multi-line class purchase end to end, then trace backward from every read or mutation of `ClassEntitlement`. Include at least:

- `packages/frontend/src/pages/FestivalClassRegistrationPage.tsx`
- cart state, cart eligibility, cart view, and `packages/frontend/src/lib/api.ts`
- `packages/backend/src/routes/customer/customer-registration.routes.ts`
- `packages/backend/src/checkout/class-checkout-service.ts`
- checkout repositories and recovery code
- `packages/common/src/purchase-eligibility.ts`
- `packages/common/src/entitlements.ts`
- Shopify cart/admin clients and `packages/backend/src/commerce/shopify-order-projection-service.ts`
- membership-commerce and class-entitlement repositories, including PostgreSQL implementation
- registration metadata, customer account, billing, and drop/transfer flows
- relevant schema and migrations
- all directly relevant backend, common, and frontend tests.

## Mandatory review lenses

Evaluate these invariants and failure modes:

- Every cart line is bound to the authenticated customer, organization, and requested festival. A line cannot reference a class from another festival or tenant.
- All server-side eligibility checks run per line immediately before external checkout creation: child ownership, fresh age snapshot, active class, division, repertoire, teacher/accompanist eligibility, registration window, capacity policy, and duplicate registration.
- Cross-line behavior is correct: duplicate child/class entries are rejected; prerequisites can be satisfied only by an eligible line for the same child and festival or by a confirmed existing entitlement.
- The implementation preserves intentional legacy single-line compatibility without creating a weaker validation or projection path.
- The checkout intent, metadata, cart, Shopify order, and class-entitlement records have an unambiguous one-to-one line mapping. Do not assume cart/order position is stable; assess explicit correlation attributes and duplicate product/variant cases.
- Product, variant, quantity, currency, and payment validation are correct per line—not merely correct in aggregate. Consider discounts, partial payment, line-price shifting, and order-line reordering.
- A browser return never creates or grants an entitlement. Only authenticated, verified paid-order handling or reconciliation may do so.
- Webhook replay, concurrent delivery, reconciliation, retry after partial failure, and duplicate Shopify order lines cannot create duplicate or incorrectly linked entitlements.
- Multi-line projection has sound atomicity or safe recovery semantics: a failure while processing line N cannot silently leave an inconsistent subset of entitlement and metadata records.
- Each entitlement has the correct festival, class, child, parent, intent-line, Shopify order-line, amount, currency, and lifecycle status.
- Recovery, invalidation, billing reconciliation, customer-account views, cancellation/revocation, and drop/transfer operate correctly when one order contains multiple classes.
- Tenant isolation, authorization, CSRF, idempotency, DTO redaction, and the handling of Shopify identifiers remain intact.

## Test review

Assess existing coverage and identify precise missing tests. At minimum inspect the multi-line checkout, intent-line, order-projection, eligibility, route, cart-state, and handoff tests.

For every missing test, name the scenario, affected layer, and the invariant it protects. Prioritize cases involving:

- two or more classes in one festival;
- same child/class duplicated in one cart;
- prerequisites fulfilled by another cart line;
- mixed children, teachers, divisions, and accompanists;
- cross-festival or cross-tenant injection;
- reordered or duplicated Shopify order lines;
- mismatched per-line and total payment;
- retries and concurrent webhooks;
- partial persistence failure during multi-line projection;
- cancellation, drop, transfer, and recovery after a multi-line purchase.

## Local database inspection and mutation

You may inspect and, when useful to validate a concrete review concern, mutate the local Festival database with:

`~/.local/bin/festival_psql.sh "<SQL>"`

For example:

`~/.local/bin/festival_psql.sh "select count(*) from orgs.volunteer_roles"`

The database may be stale or structurally behind the checked-out code. Before relying on it, record its migration/schema state and compare it with repository migrations. Treat missing tables, columns, constraints, or data as an out-of-date database—not an application defect—unless code and migration history prove otherwise.

Destructive local-database commands are authorized when narrowly scoped and useful to reproduce or validate a finding. Prefer transactions or targeted test records where practical. Current code, schema, and migrations remain the source of truth.

For every SQL mutation, include in the review output:

- The exact SQL command, with secrets redacted.
- Why the change was necessary.
- Affected tables, rows, or schema objects.
- A verification query and outcome.
- Whether stale schema or seed data could invalidate the result.

Do not make speculative cleanup changes. If the database cannot be confidently aligned with current migrations, continue the code review and label database-derived results as unverified.

## Review output

Return:

1. A short architecture summary linked to the graph.
2. Findings first, ordered by severity: P0, P1, P2, P3.
3. For each finding: title, impact, concrete exploit/failure scenario, graph nodes traversed, exact file/line evidence, and the smallest safe remediation direction.
4. A list of missing or insufficient tests.
5. A concise verdict: approve, approve with follow-ups, or request changes.
6. Commands run and their results.

Do not report speculative findings. If a concern cannot be proven, label it as a question and state the missing evidence.
