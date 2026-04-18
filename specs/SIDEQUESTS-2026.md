Add these as **parallel workstreams (“Side Quests”)**—independent, additive, and safe to develop alongside core phases.
# Side Quests (Parallel Workstreams)


## 1. Communications Automation (Email & SMS)

**Goal:** Reliable, event-driven communication for confirmations, updates, and failures.

**Scope:**

* Email + SMS delivery (transactional only)
* Template system (versioned, parameterized)
* Trigger events:

  * registration success
  * waitlist placement
  * payment failure
  * schedule assignment
  * reminders (time-based)

**Deliverables:**

* Tables:

  * `message_template`
  * `message_event`
  * `message_log`
* Services:

  * event → template render → send pipeline
* Providers:

  * Email (e.g., SendGrid/Postmark)
  * SMS (e.g., Twilio)

**Exit Criteria:**

* All critical user actions generate a message
* Templates editable without code deploy
* Delivery + failure states logged

**Failure Modes:**

* Duplicate sends (lack of idempotency)
* No audit trail
* Hardcoded templates

---

## 2. Volunteer Portal

**Goal:** Self-service system to recruit and manage volunteers.

**Scope:**

* Browse available roles/shifts
* Sign up / cancel
* Admin view of coverage gaps
* Automated reminders

**Deliverables:**

* Tables:

  * `volunteer`
  * `volunteer_role`
  * `volunteer_shift`
  * `volunteer_assignment`
* Features:

  * shift capacity limits
  * simple check-in tracking (optional)

**Exit Criteria:**

* Volunteers can self-assign to roles
* Admin can see coverage in real time
* Reminder notifications sent pre-event

**Failure Modes:**

* Overbooking shifts
* No-shows without visibility
* No easy way to rebalance staffing

---

## 3. Drop & Transfer Management

**Goal:** Controlled, auditable changes to registrations.

**Scope:**

* Drop registration:

  * with refund
  * without refund
* Transfer registration:

  * between classes
  * preserve priority/timestamp when valid
* Waitlist promotion logic

**Deliverables:**

* Tables:

  * `registration_change_log`
  * `refund_event`
* APIs:

  * drop registration
  * transfer registration
* Integration:

  * Shopify refund handling

**Exit Criteria:**

* All changes are logged and reversible (where possible)
* Transfers respect capacity + waitlist rules
* Refunds reconcile with Shopify

**Failure Modes:**

* Losing original priority (breaks fairness)
* Inventory mismatch after transfer
* Refunds not synced with Shopify

---

Add this as a fourth parallel workstream. This one is operationally critical—your current system failures (credits, partial payments, mismatches) are exactly where trust breaks.

---

## 4. Admin Billing Reconciliation (Debit & Credit Repair)

**Goal:** Give administrators precise control to correct payment mismatches between Shopify and actual services rendered.

**Scope:**

* Issue refunds (full/partial)
* Create manual charges/invoices
* Apply credits to future use
* Reconcile discrepancies:

  * paid but not registered
  * registered but not paid
  * partial payments
* Maintain a clear financial audit trail

**Key Principle:**

* Shopify remains the **source of truth for money movement**
* Local system becomes the **source of truth for intent + reconciliation**

---

### Deliverables

**Tables:**

* `billing_adjustment`
* `billing_ledger`
* `credit_balance`
* `invoice`
* `invoice_line_item`

**Adjustment Types:**

* `refund`
* `credit_issue`
* `credit_apply`
* `manual_charge`
* `write_off`

**Core APIs:**

* issue refund (calls Shopify API)
* create invoice (manual charge)
* apply credit to registration
* reconcile payment mismatch

---

### UI Capabilities

* Search by:

  * parent email
  * performer
  * Shopify order
* View:

  * payments (Shopify)
  * entitlements (local)
  * balance summary
* Actions:

  * refund (full/partial)
  * apply credit
  * generate invoice
  * mark resolved

---

### Exit Criteria

* Admin can resolve any payment mismatch without engineering support
* Every financial adjustment is:

  * logged
  * traceable
  * tied to a user and reason
* Shopify and local system remain reconcilable at all times

---

### Failure Modes (Critical)

* Silent adjustments (no audit trail)
* Double refunds or duplicate credits
* Ledger drift between Shopify and local system
* No way to reconstruct financial history

---

### Integration Guidance

* Depends on **Phase 1 (Shopify)** and **Phase 2 (Entitlements)**
* Should be built **before or alongside Phase 3**, not after
  (you will need this during real registration chaos)

---

### Priority

**High priority** — this is not a “nice to have”
This is what prevents weeks of manual cleanup and damaged trust with families.

---

# Final Side Quest Set

* Communications Automation
* Volunteer Portal
* Drop & Transfer Management
* **Admin Billing Reconciliation (Debit & Credit Repair)**


