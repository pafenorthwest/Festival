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

## 5. Music Review App & Catalog Cleanup

**Goal:** Create an internal review tool and API to normalize repertoire data into professional titles, canonical composer names, and reference-backed works.

**Purpose:**

* Clean up inconsistent piece titles entered during registration
* Standardize composer names
* Tie reviewed works to an authoritative reference
* Build a reusable repertoire catalog over time

**Key Principle:**

* User-submitted text is the raw input
* Reviewed catalog data becomes the trusted internal reference

---

### Scope

* Internal review app for staff and editors
* API for querying, reviewing, and updating repertoire records
* IMSLP reference URL for composer/work verification
* Personal review queue for each reviewer
* Flagging system for titles needing attention
* Filtering by:

  * class type
  * division
  * string search
  * review status
  * assigned reviewer

---

### Core Capabilities

**Review Workflow**

* View submitted title/composer
* Compare against normalized values
* Save reviewed title and composer
* Attach IMSLP URL reference
* Mark as:

  * reviewed
  * flagged
  * needs follow-up
  * approved for publication

**Personal Work Queue**

* Each reviewer has an assigned queue
* Queue can be manually assigned or auto-filled
* Reviewer sees:

  * pending items
  * flagged items
  * recent completions

**Flagging**

* Flag records for:

  * ambiguous title
  * missing composer
  * spelling issue
  * duplicate work
  * uncertain work identification
* Add reviewer notes

**Filtering**

* By class type
* By division
* By substring / free-text match
* By status
* By reviewer
* By flagged / unflagged

---

### Deliverables

**Tables:**

* `music_entry`
* `music_review`
* `music_flag`
* `composer_catalog`
* `work_catalog`
* `review_assignment`

**Suggested Data Model**

* `music_entry`

  * raw title
  * raw composer
  * performer / registration linkage
  * class type
  * division
* `music_review`

  * normalized title
  * normalized composer
  * imslp_url
  * status
  * reviewed_by
  * reviewed_at
* `music_flag`

  * flag type
  * note
  * created_by
* `composer_catalog`

  * canonical composer name
  * imslp composer URL
* `work_catalog`

  * canonical work title
  * composer reference
  * accepted naming form

---

### API Surface

**Read**

* list music entries
* filter by class type / division / status / assigned user
* get reviewer queue
* search by title/composer substring

**Write**

* assign entry to reviewer
* save reviewed title/composer
* attach IMSLP URL
* add or clear flags
* mark approved / needs follow-up

**Admin**

* bulk assign queue items
* export reviewed catalog
* view flagged backlog

---

### UI Capabilities

* Reviewer dashboard with personal queue
* Split view:

  * raw submitted data
  * normalized reviewed data
* Inline flagging and notes
* Filter panel:

  * class type
  * division
  * string match
  * status
  * assigned user
* Quick links to IMSLP reference
* History of changes per record

---

### Exit Criteria

* Reviewers can process repertoire through a personal queue
* Titles and composers can be normalized consistently
* Each approved work can include an IMSLP reference URL
* Staff can filter and resolve flagged titles efficiently
* Cleaned data can be reused in programs, schedules, and reports

---

### Failure Modes

* No distinction between raw submission and reviewed value
* Editors overwrite source text with no audit history
* IMSLP links stored inconsistently
* No queue ownership, so work stalls
* No canonical catalog, forcing repeated manual cleanup

---

### Integration Guidance

* Can begin after **Phase 2**, once class registration metadata exists
* Most useful before large-scale scheduling, program generation, and concert publication
* Should integrate later with:

  * registration metadata
  * program generation
  * schedule output
  * adjudication / results publication

---

### Priority

**High priority** Admin Billing and Reconcilation 

---

# Updated Side Quest Set

* Communications Automation
* Volunteer Portal
* Drop & Transfer Management
* **Admin Billing Reconciliation (Debit & Credit Repair)**
* Music Review App & Catalog Cleanup



