I recommend implementing these issues in **five phases**, starting with the registration domain and state machine, followed by the customer and administrative workflows, and finally reporting and performance validation.

The most important architectural decision is to establish a single authoritative registration lifecycle before implementing any new UI. Otherwise, we risk introducing inconsistent state handling across registration, waitlist management, checkout and scheduling.

## **Implementation roadmap**

1

**Registration domain foundation**

\#479 (Backend), #246

State machine, persistence, transitions and capacity accounting

2

**Checkout and payment integration**

\#481 (Backend), #260, #410, #357

Purchase permissions, payment projection and recovery

3

**Parent and administrator experiences**

\#479 (Frontend), #480, #481 (Frontend), #340, #328

Waitlist submission, promotion, completion and withdrawal

4

**Registration reports and scheduling**

\#478, #477, #38

My Registrations, CSV exports and schedule integration

5

**Performance and defense in depth**

\#30, #451, #247

Concurrency, scalability and additional checkout safeguards

## **Phase 1 — Registration domain foundation**

**Issues:** [#479](https://github.com/pafenorthwest/Festival/issues/479?utm_source=chatgpt.com) (backend), [#246](https://github.com/pafenorthwest/Festival/issues/246?utm_source=chatgpt.com)

Implement the authoritative registration domain independently of the frontend.

- Database schema and migration of existing registrations and waitlist entries.
- Four-state registration lifecycle and permitted transitions.
- Registration metadata persistence.
- Customer and administrator authorization.
- State-aware capacity accounting.
- Withdrawal service and transition audit history.
- Idempotency and transactional concurrency controls.

**Exit criteria:** Every permitted and prohibited state transition is covered by automated tests. Registration counts remain accurate after any sequence of transitions, including concurrent requests.

I would establish #246 as the authoritative backend foundation issue and expand its scope beyond waitlist entitlements.

## **Phase 2 — Checkout and payment integration**

**Issues:** [#481](https://github.com/pafenorthwest/Festival/issues/481?utm_source=chatgpt.com) (backend), [#260](https://github.com/pafenorthwest/Festival/issues/260?utm_source=chatgpt.com), [#410](https://github.com/pafenorthwest/Festival/issues/410?utm_source=chatgpt.com), [#357](https://github.com/pafenorthwest/Festival/issues/357?utm_source=chatgpt.com)

| Order | Work                                                            |
| ----- | --------------------------------------------------------------- |
| 1     | Implement purchase authorization for Available for registration |
| 2     | Integrate capacity and registration deadline overrides          |
| 3     | Enforce class prerequisites                                     |
| 4     | Integrate verified payment with registration state transitions  |
| 5     | Protect against withdrawal during valid checkout                |
| 6     | Integrate checkout recovery and restoration                     |
| 7     | Validate payment reconciliation and replay behavior             |

**Exit criteria:** The entire registration lifecycle can be exercised through backend APIs, including Shopify payment, without relying on the new frontend.

This is the highest-risk phase because it crosses the transactional boundary between Festival and Shopify.

## **Phase 3 — Parent and administrator experiences**

These issues can be developed substantially in parallel once the backend contracts are stable.

| Issue                                                                               | Deliverable                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [#479](https://github.com/pafenorthwest/Festival/issues/479?utm_source=chatgpt.com) | Unified paid and waitlist registration experience        |
| [#480](https://github.com/pafenorthwest/Festival/issues/480?utm_source=chatgpt.com) | Admin waitlist management, promotion and withdrawal      |
| [#481](https://github.com/pafenorthwest/Festival/issues/481?utm_source=chatgpt.com) | Parent completion of available registrations             |
| [#340](https://github.com/pafenorthwest/Festival/issues/340?utm_source=chatgpt.com) | Actionable registration and checkout validation messages |
| [#328](https://github.com/pafenorthwest/Festival/issues/328?utm_source=chatgpt.com) | Repertoire consistency and state-aware editing           |

**Exit criteria:** A parent can join a waitlist, an administrator can promote the registration, the parent can complete payment, and either authorized party can subsequently withdraw the registration.

At this point, the waitlist management feature is operationally complete.

## **Phase 4 — Registration reports and scheduling**

**Issues:** [#478](https://github.com/pafenorthwest/Festival/issues/478?utm_source=chatgpt.com), [#477](https://github.com/pafenorthwest/Festival/issues/477?utm_source=chatgpt.com), [#38](https://github.com/pafenorthwest/Festival/issues/38?utm_source=chatgpt.com)

I would begin the UI design work for #478 and #477 during Phase 1, but implement the final views after the registration lifecycle is stable.

| Order | Deliverable                                                          |
| ----- | -------------------------------------------------------------------- |
| 1     | Agree on a shared My Registrations target layout                     |
| 2     | Build the shared registration query and table components             |
| 3     | Implement parent view with all four states and permitted actions     |
| 4     | Implement teacher and accompanist views                              |
| 5     | Implement shared CSV export                                          |
| 6     | Integrate published schedule information                             |
| 7     | Validate removal of withdrawn registrations from effective schedules |

**Exit criteria:** Every authorized audience has an accurate view of its registrations, and withdrawn registrations never appear in active schedules.

The registration reports should be released without waiting for #38 or the scheduling domain to be completed.

## **Phase 5 — Performance and defense in depth**

**Issues:** [#30](https://github.com/pafenorthwest/Festival/issues/30?utm_source=chatgpt.com), [#451](https://github.com/pafenorthwest/Festival/issues/451?utm_source=chatgpt.com), [#247](https://github.com/pafenorthwest/Festival/issues/247?utm_source=chatgpt.com)

Validate the completed registration lifecycle against the existing 500-concurrent-user performance target.

Performance testing should include simultaneous waitlist submissions, administrative promotions, withdrawals, mixed-class checkouts, payment reconciliation and capacity cache invalidation.

Concurrency correctness tests belong in Phases 1 and 2; this final phase focuses on load testing, optimization and additional safeguards.

## **Recommended release boundaries**

Rather than waiting for all 15 issues to be completed, I would organize delivery into three incremental releases.

| Release                                | Customer or operational value                                                |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| **Release 1 — Registration Lifecycle** | Authoritative states, withdrawal, accurate capacity and payment integration  |
| **Release 2 — Waitlist Management**    | Complete waitlist submission, promotion and parent purchase workflow         |
| **Release 3 — My Registrations**       | Parent, teacher and accompanist tables, CSV exports and schedule integration |

Each release should pass its applicable performance and regression gates before production deployment.

## **Recommended GitHub restructuring**

I would make one structural change to the current issue set: repurpose **#246 as the authoritative registration domain and lifecycle issue**.

Proposed title:

`Back End: Class Registration Domain, State Machine and Capacity Accounting`

This issue would own the database schema, domain objects, state transitions, service interfaces, authorization, capacity accounting and audit history.

All other registration issues would reference #246 as the authoritative contract rather than independently specifying the state machine.

This reduces the risk of specification drift and gives developers a clear implementation dependency.

**Critical path:** #246 → #481 backend → #479 / #480 / #481 frontend → #478 / #477.

This recommendation is based on the issue specifications reviewed, not a fresh source-code or database-schema audit. I have not changed any GitHub issues or established formal dependencies yet.
