## Festival Software Spec: Accounts, Memberships, and Registration Phases

### 1. Overview

The festival software supports two major account categories:

**Organizational accounts**
These are administrative and operational accounts used to configure and run the festival. Organizational users authenticate through **Google Firebase** using:

* Google single sign-on
* Email/password

**Membership accounts**
These are participant-facing accounts tied to membership purchase and festival participation. The initial release supports:

* Teacher memberships
* Accompanist memberships

The first release should support:

1. Organizational onboarding and configuration
2. Division configuration
3. Teacher and accompanist membership registration
4. A later student registration phase

---

## 2. User Types

### 2.1 Organizational users

Organizational users can:

* Create and configure their organization
* Invite additional organization members
* Configure festival divisions
* Open and manage registration phases
* Review membership and registration data
* Reconcile operational data against Shopify billing state

### 2.2 Teacher members

Teachers are public, discoverable membership users who:

* Purchase a membership through Shopify
* Maintain a teacher profile in the festival database
* Belong to one or more divisions
* Become selectable by students during student registration
* Can be distinguished from teachers with the same name via an assigned color

### 2.3 Accompanist members

Accompanists are also public, discoverable membership users who:

* Register through the membership flow
* May pay a reduced fee or zero fee
* Maintain a profile in the festival database
* Are listed publicly and discoverable in a manner similar to teachers

---

## 3. Core Source-of-Truth Model

### 3.1 Shopify responsibilities

Shopify is the source of truth for:

* Payment status
* Pricing
* Membership entitlements
* On-file payment methods
* Billing address
* Other billing-required data

### 3.2 Festival database responsibilities

The festival database is the default source of truth for operational data, including:

* Contact information
* Teacher and accompanist profiles
* Division associations
* Musical piece information
* Historical data
* Registration records
* Volatile operational data
* Public listing and discovery data

### 3.3 Reconciliation requirement

Shopify and the festival database must be reconciled **at least daily**.

The purpose of reconciliation is to ensure:

* the system grants only the entitlements that were purchased
* billed memberships actually receive the correct access
* membership state does not drift between Shopify and the application database

A good shorthand requirement is:

> The system must ensure you get what you pay for, and you pay for what you get.

This implies:

* automated daily reconciliation job
* webhook-driven updates where possible
* administrative tools for exception handling and repair

---

## 4. Registration Timeline

The registration timeline has **two distinct phases**.

### Phase 1: Teacher and accompanist registration

During this phase:

* Teachers may register and purchase memberships
* Accompanists may register and purchase or claim memberships
* Student registration is not allowed

This phase exists to ensure the festival has a complete roster of active teachers and accompanists before student enrollment begins.

### Phase 2: Student registration

During this phase:

* Students register directly
* Students can search for and select teachers
* Students can discover accompanists where applicable
* Student workflows rely on the teacher and accompanist directory established during Phase 1

This means student registration is **not invitation-only** in the initial version. It is direct registration, but it depends on prior teacher/accompanist onboarding.

---

## 5. Division Configuration

Before teacher and accompanist registration opens, the organization must configure the divisions for the festival.

The system should support default divisions such as:

* High Strings
* Low Strings
* Brass
* Woodwinds
* Percussion

The system must also support:

* adding custom divisions
* alternate display titles
* enabling only a subset of divisions for a given festival

Divisions should be configurable data, not hard-coded enums.

---

## 6. Teacher Membership Flow

### 6.1 Registration and payment

Teachers sign up through Shopify because membership purchase is required.

High-level flow:

1. Teacher begins membership registration
2. Teacher completes Shopify purchase flow
3. Shopify records billing, payment, entitlement, and price state
4. Festival database creates or updates operational teacher membership record
5. Teacher becomes active for festival use after entitlement is confirmed

### 6.2 Teacher profile data

The system must collect and store:

* Full name
* Zip code
* One or more divisions
* Stable assigned color
* Membership dates or membership year
* Public listing state
* Contact information needed for festival operations

### 6.3 Multi-division support

A teacher can belong to **several divisions**.

This should not be modeled as a single division field on the teacher record. Instead, use:

* `teacher_profile`
* `division`
* `teacher_division` join table

That design avoids repainting the model later.

### 6.4 Teacher disambiguation

Every teacher should receive a randomly assigned color.

The color is:

* assigned to every teacher, not only collision cases
* stable across the membership term
* used in public discovery and selection flows
* intended to help distinguish teachers with the same name, especially within the same division

For example:

* Sarah Chen — High Strings — Blue
* Sarah Chen — High Strings — Green

Internally, the system must still rely on immutable IDs, not color, for joins and workflow actions.

---

## 7. Accompanist Membership Flow

### 7.1 Registration

Accompanists register similarly to teachers, though the membership price may be lower or zero.

### 7.2 Accompanist profile data

The system should collect and store:

* Full name
* Zip code
* Email address
* Phone number
* Membership dates or membership year
* Public listing state

### 7.3 Public discoverability

Accompanists are publicly listed and discoverable in the same broad way teachers are.

That means accompanists should be modeled as searchable directory entities, not just internal support records.

Depending on later product decisions, accompanists may also eventually need:

* division associations
* availability indicators
* region filters
* student or teacher matching metadata

For the initial version, the required public discovery fields are name and contact/discovery details, with zip code available for operational lookup and possibly local filtering.

---

## 8. Data Model

## 8.1 Organization

Fields:

* organization_id
* name
* active_festival_id
* configuration_status
* created_at
* updated_at

## 8.2 Organization user

Fields:

* organization_user_id
* organization_id
* firebase_uid
* email
* auth_provider
* role
* invited_by
* created_at
* updated_at

## 8.3 Festival

Fields:

* festival_id
* organization_id
* title
* festival_year
* registration_phase
* teacher_registration_open_at
* student_registration_open_at
* created_at
* updated_at

`registration_phase` should be explicit, for example:

* setup
* teacher_accompanist_registration
* student_registration
* closed

## 8.4 Division

Fields:

* division_id
* organization_id or festival_id depending on scoping decision
* internal_key
* display_title
* alternate_title
* sort_order
* is_active
* is_default
* created_at
* updated_at

## 8.5 Membership

This should be the billing-linked entitlement record.

Fields:

* membership_id
* organization_id
* member_type

  * teacher
  * accompanist
* shopify_customer_id
* shopify_order_id or subscription reference
* entitlement_status
* membership_year
* membership_start_at
* membership_end_at
* reconciliation_status
* last_reconciled_at
* created_at
* updated_at

`entitlement_status` might include:

* pending
* active
* expired
* suspended
* canceled

## 8.6 Teacher profile

Fields:

* teacher_profile_id
* membership_id
* full_name
* stable_display_name
* assigned_color
* zip_code
* public_listed
* created_at
* updated_at

## 8.7 Teacher division join

Fields:

* teacher_profile_id
* division_id
* created_at

## 8.8 Accompanist profile

Fields:

* accompanist_profile_id
* membership_id
* full_name
* zip_code
* email
* phone_number
* public_listed
* created_at
* updated_at

## 8.9 Student

You did not fully define student identity yet, but because students register directly in Phase 2, the model will need a student entity.

Minimum likely fields:

* student_id
* full_name
* birthdate or age basis
* contact email for parent/guardian or student, depending on policy
* selected_teacher_profile_id
* created_at
* updated_at

## 8.10 Musical piece / repertoire

Since the database is the source of truth for musical piece information, plan for first-class repertoire tables rather than burying this in JSON blobs.

Likely future fields:

* piece_id
* student_id
* title
* composer
* movement
* duration
* instrumentation
* festival_id
* created_at
* updated_at

---

## 9. Discovery and Public Listing Requirements

### 9.1 Teacher discovery

During student registration, students must be able to discover teachers using:

* teacher name
* assigned color
* division
* possibly zip code or region later

### 9.2 Accompanist discovery

Accompanists must be similarly discoverable using:

* name
* possibly zip code or region
* contact details or controlled contact workflow depending on privacy design

### 9.3 Public listing controls

Because teachers and accompanists are publicly listed, the system should include a clear `public_listed` flag and a publication policy. Even if members are generally public by default, that decision should be explicit in the model.

---

## 10. Reconciliation Requirements

The platform must reconcile Shopify and the festival database at least once every 24 hours.

The reconciliation process should verify:

* active paid memberships in Shopify exist as active entitlements in the application
* expired or canceled billing state is reflected in application entitlements
* membership dates match expected entitlement windows
* required operational profiles exist for active members
* discrepancies are logged and surfaced for administrative repair

Recommended reconciliation mechanisms:

* Shopify webhooks for near-real-time updates
* daily full reconciliation sweep
* admin dashboard for mismatch resolution

Examples of mismatches:

* paid teacher membership exists in Shopify but no teacher profile exists in the database
* database shows active accompanist, but Shopify entitlement is expired
* membership record exists without linked Shopify customer
* teacher division data exists, but membership is not active

---

## 11. Updated Requirements Summary

### Functional requirements

The system shall:

1. Support organizational accounts authenticated via Firebase using Google SSO or email/password.
2. Allow organizational users to create and configure an organization.
3. Allow organizational users to invite additional organizational members.
4. Require division configuration before teacher and accompanist registration can open.
5. Support configurable default and custom divisions.
6. Support teacher memberships linked to Shopify purchase and entitlement state.
7. Support accompanist memberships linked to Shopify purchase and entitlement state.
8. Allow teachers to belong to multiple divisions.
9. Assign every teacher a stable color discriminator.
10. Publicly list and make teachers discoverable during student registration.
11. Publicly list and make accompanists discoverable similarly to teachers.
12. Collect teacher operational profile data in the festival database.
13. Collect accompanist operational profile data in the festival database.
14. Enforce a two-phase registration lifecycle:

* teacher/accompanist registration first
* direct student registration second

15. Reconcile Shopify and database state at least daily.

### Non-functional requirements

The system should:

1. Treat Shopify as the source of truth for billing and entitlements.
2. Treat the festival database as the default source for operational and volatile data.
3. Use explicit reconciliation to prevent entitlement drift.
4. Use normalized many-to-many modeling for teachers and divisions.
5. Store historical data in the application database for reporting and festival continuity.

---

## 12. Product and architecture implications

These choices imply a few important architecture decisions.

First, **membership** and **profile** should remain separate. A teacher’s billing entitlement is not the same thing as the teacher’s operational profile.

Second, the platform needs an explicit **registration phase state machine**. Otherwise, edge cases around “students signing up too early” will become messy fast.

Third, because accompanists are public and discoverable, they are not a side table. They are first-class participant directory entities.

Fourth, because teachers can belong to several divisions, the division model is already relational and should be built that way from day one.

My strongest recommendation is to formalize the next draft around:

* domain model
* lifecycle state machine
* reconciliation workflows
* public directory/search behavior

The cleanest next artifact would be either a **database schema draft** or a **full PRD with user stories and acceptance criteria**.
