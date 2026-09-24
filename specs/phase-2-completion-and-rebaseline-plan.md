# Phase 2 Completion and Schema Re-baseline Plan

## 1. Executive Summary & Context

This document establishes the authoritative execution plan to finish **Product Phase 2 (Class Purchase Entitlement)** and execute a post-Phase-2 **database schema re-baseline**.

### 1.1 PR #208 Architectural Synthesis & Review Guidance

During the review of [PR #208](https://github.com/pafenorthwest/Festival/pull/208) (`feat(repertoire): add relational musical repertoire catalog`), Eric Passmore identified critical operational and architectural principles governing both current development and future schema evolution:

1. **Rollout Environment Is Test-Only**: The application is in pre-production. There are zero production registrations. Therefore, complex backward-compatibility projections (`legacyRepertoireCompatibilityProjection`), fallback shims, and backfill scripts for JSON-only repertoire records created prior to the relational repertoire schema are unnecessary overhead. Pre-relational data must be treated as ephemeral test records.
2. **Atomic Relational Snapshot Writes**: Checkout must write piece snapshots (`registration_repertoire_items`) and contributor snapshots (`registration_repertoire_item_contributors`) directly into the normalized relational tables inside the checkout transaction, rather than maintaining dual-write or two-phase legacy fallbacks.
3. **Developer DB Reset Workflow**: The primary developer database workflow is:
   ```bash
   # 1. Drop all tables in database
   # 2. Build, test, and start development server
   bun run build && bun run test && bun run dev
   # 3. Onboard new organization, configure, and test
   ```
   This workflow bypasses incremental migration scripts during rapid prototyping and ensures test integrity from a clean state.
4. **Post-Phase 2 Ground-Up Re-baseline**: Once Product Phase 2 is functionally complete, verified, and signed off, the database schema will be re-baselined from the ground up:
   - Consolidate all schema definitions into a single, canonical schema file ([`database/postgres17-schema.sql`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/database/postgres17-schema.sql)).
   - Clear all interim migration files (such as `database/migrations/20260922_musical_repertoire*`).
5. **Phase 3 Formal Migrations & Backward Compatibility**: Starting with Phase 3 (multi-line cart, soft-capacity allocation, and waitlists), the platform will transition to production-grade migration management with schema version tracking and strict backward compatibility for rolling deployments.

---

## 2. Evaluation of Existing Documentation vs. Product Phase 2 Scope

### 2.1 Scope of `implementation_plan.md` (100% Merged)

The existing [`implementation_plan.md`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/implementation_plan.md) is titled **`api-router.ts` Modularization — Revised Implementation Plan**. Its scope was strictly architectural router modularization:
- **Status**: 100% COMPLETE & MERGED INTO `main`.
  - [PR #196](https://github.com/pafenorthwest/Festival/pull/196) (Commit `2d9b29f`): Administrative surface modularization (Phases 0–8).
  - [PR #207](https://github.com/pafenorthwest/Festival/pull/207) (Commit `201378b`): Customer surface modularization (Phases 9–12).
- **Accomplishment**: Deconstructed the 1,600+ line monolithic `api-router.ts` into isolated, domain-specific modules (`catalog`, `org-info`, `volunteers`, `identity`, `staff`, `admin-org`, `admin-registration`, `admin-shopify`, `customer-auth`, `customer`, `customer-children`, and `customer-registration`).
- **Boundary**: `implementation_plan.md` created clean HTTP routing contracts and decoupled domain boundaries, but it was **not** the complete feature implementation of Product Phase 2.

### 2.2 Remaining Product Phase 2 Scope & Work Breakdown

As specified in [`specs/Phase-2-Class-Purchase-Entitlement.md`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/specs/Phase-2-Class-Purchase-Entitlement.md) and tracked across open issues (including GitHub Issue [#211](https://github.com/pafenorthwest/Festival/issues/211)), the following breakdown defines the remaining Phase 2 completion path:

| Phase Step | Scope Item | Status | Summary & Objectives |
|---|---|---|---|
| **Step 1.1** | **PR #208 Finalization** | **COMPLETE** | Strip legacy JSON backwards-compatibility fallbacks; enforce direct atomic relational snapshot writes. Merged in PR #208 (commit `3a26350`). |
| **Step 1.2** | **Backend Hardening & Follow-ups Gate (Issue #211)** | **COMPLETE** | Resolve the 7 tracked follow-up items across Cluster A (Route/DTO Hygiene: #204, #205; Merged PR #212, commit `edab5d4`), Cluster B (Core Invariants & Compensation Boundaries: #143, #199, #203; Merged PR #213, commit `7e10a66`), and Cluster C (Route Isolation & Validation Tests: #200, #206; Merged PR #214, commit `56d35d1`). Issue #211 CLOSED. |
| **Step 1.3** | **Remaining Phase 2 Endpoints & Feature Gaps** | **COMPLETE** | Task 1.3.1 (Metadata edit endpoint with 6-week festival timezone cutoff, #138, #141): COMPLETE (Merged PR #215, commit `22fc298`). Task 1.3.2 (Shopify Class Product lifecycle sync / mock, #141): COMPLETE. |
| **Step 1.4** | **Frontend Workflows** | **PENDING** | Admin class catalog management UI (`FestivalAdminClassesPage.tsx`); Customer class registration multi-step flow & checkout UI. |
| **Step 1.5** | **E2E Integration Verification & Sign-off Gate** | **PENDING** | End-to-end integration test execution, invariant verification, and formal Phase 2 sign-off gate. |
| **Part 2** | **Schema Re-baseline & Migration Reset** | **PENDING** | Post-Phase 2 schema consolidation into canonical `postgres17-schema.sql`, retirement of interim migrations, automated `bun run db:reset` tooling. Gated on Step 1.5 sign-off. |

---

## 3. Part 1: Phase 2 Completion Execution Plan

### 3.1 Step 1.1: PR #208 Finalization (Strip Legacy JSON Fallback, Atomic Relational Snapshot) — COMPLETE

**Status**: COMPLETE (Merged PR #208, commit `3a26350`)

**Objective**: Align [PR #208](https://github.com/pafenorthwest/Festival/pull/208) with architectural directives by removing unnecessary legacy backward-compatibility shims and writing snapshots directly and atomically into normalized relational tables.

- **Tasks**:
  1. **Strip Legacy Compatibility Layers**:
     - Remove `legacyRepertoireCompatibilityProjection` and JSON fallback branches in [`packages/backend/src/checkout/class-checkout-service.ts`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/backend/src/checkout/class-checkout-service.ts).
     - Remove pre-relational JSON-only read fallbacks across repository layer.
  2. **Enforce Atomic Relational Snapshot Writes**:
     - In [`packages/backend/src/checkout/postgres-checkout-repository.ts`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/backend/src/checkout/postgres-checkout-repository.ts), insert `registration_repertoire_items` and `registration_repertoire_item_contributors` atomically within the checkout creation transaction.
     - Trim `title` and `composer` strings before snapshot insertion.
     - Allow explicit `null` for `piece.movement` in DTO validation.
     - Ensure `repertoire_contributors` queries are strictly scoped by `organization_id`.
  3. **Verification**:
     - Run backend test suite: `bun test packages/backend/tests/checkout-repository.test.ts` and `bun test packages/backend/tests/class-checkout-service.test.ts`.
     - Confirm all tests pass with zero legacy compatibility overhead.
  4. **Merge**: Rebase and merge PR #208 into `main` (Merged, commit `3a26350`).

---

### 3.2 Step 1.2: Backend Hardening & Follow-ups Gate (Issue #211) — COMPLETE

**Status**: COMPLETE (Issue #211 CLOSED)

**Objective**: Close the 7 focused follow-up items tracked under GitHub Issue [#211](https://github.com/pafenorthwest/Festival/issues/211) ("Tracking: Almost-closed follow-ups"). This gate hardens the domain layer, request/response boundaries, compensation guarantees, and route isolation before building out remaining feature surfaces.

#### Cluster A: Route & DTO Hygiene (#204, #205) — COMPLETE (Merged PR #212, commit `edab5d4`)

- **Task 1.2.A.1: Clarify Unused Class Checkout Request Fields ([#204](https://github.com/pafenorthwest/Festival/issues/204))**:
  - **Problem**: `StartClassCheckoutInput` declares `organizationSlug` and `divisionId`, but the checkout service does not use either, leaving ambiguity as to which values are authoritative.
  - **Action**: Clean `StartClassCheckoutInput` to declare only used, authoritative values, or validate a supplied division against the resolved class configuration. Keep organization and class resolution strictly server-owned.
  - **Acceptance Criteria**:
    - `StartClassCheckoutInput` contains only trusted, utilized fields.
    - No caller can infer that an unvalidated division parameter overrides class configuration.
    - Unit tests cover any retained division match validation.

- **Task 1.2.A.2: Redact Internal Checkout Intent from Class Checkout Response ([#205](https://github.com/pafenorthwest/Festival/issues/205))**:
  - **Problem**: `ClassCheckoutResult` exposes optional `intent`, and HTTP route handler returns the service result directly, exposing internal correlation IDs, session tokens, idempotency keys, Shopify product/variant IDs, and internal status fields to the browser.
  - **Action**: Define and return an explicit browser-safe checkout DTO containing only the checkout redirect URL and necessary opaque identifiers.
  - **Acceptance Criteria**:
    - HTTP response omits `CheckoutIntentRecord` and internal Shopify identifiers.
    - Browser client receives clean redirect URL and can resume registration UX.
    - Route tests verify redaction of internal intent fields.

#### Cluster B: Core Invariants & Compensation Boundaries (#143, #199, #203) — COMPLETE (Merged PR #213, commit `7e10a66`)

- **Task 1.2.B.1: Hard 90-Day Age-Snapshot Enforcement for Selection ([#143](https://github.com/pafenorthwest/Festival/issues/143))**:
  - **Problem**: Class selection eligibility must enforce a hard 90-day validity window on child age snapshots at the domain level.
  - **Action**: In the class-selection eligibility service and checkout pipeline:
    - Enforce that the child's stored age snapshot is at most 90 days old from creation (`valid_until > server_time` and snapshot age <= 90 days).
    - Reject stale snapshots before returning eligibility, even if the stored age would mathematically fit the class age bounds.
    - Ensure refresh workflow never persists birth dates to database storage.
  - **Acceptance Criteria**:
    - Snapshot aged <= 90 days is accepted only when all other eligibility rules pass.
    - Expired snapshot is rejected for new selection.
    - Stale-but-future-valid regression test added (expired snapshot whose age would still fit class is strictly rejected).
    - Server-side invariant verified independent of UI state.

- **Task 1.2.B.2: Compensate Class-Registration Metadata Write Failures ([#199](https://github.com/pafenorthwest/Festival/issues/199))**:
  - **Problem**: Class checkout creates an intent before writing `registration_metadata`. If metadata write fails (FK violation, uniqueness conflict, or transient error), the intent is abandoned in `creating` status, permanently blocking the idempotency key as `in_progress`.
  - **Action**: Make intent creation and metadata persistence atomic, or extend the checkout failure compensation boundary to encompass metadata persistence, marking the intent failed if metadata cannot be written.
  - **Acceptance Criteria**:
    - Metadata persistence failure cannot leave an abandoned processing intent.
    - Re-attempting checkout with same or new idempotency key has defined, safe behavior.
    - Failure-injection unit test added to simulate metadata persistence error and verify compensation.

- **Task 1.2.B.3: Preserve Shopify Integration Change Detection in Class Checkout ([#203](https://github.com/pafenorthwest/Festival/issues/203))**:
  - **Problem**: Checkout executes two integration reads around external Shopify checkout handoff (read 1: captures trusted store configuration; read 2: detects mid-flight configuration changes before returning URL). Performance refactoring must not collapse these lookups.
  - **Action**: Add explicit architectural comments and focused configuration-change tests defending the double-read pattern.
  - **Acceptance Criteria**:
    - Code explicitly documents rationale for integration version/domain comparison.
    - Test proves that a modified integration version or domain triggers safe checkout failure and intent compensation.

#### Cluster C: Route Isolation & Validation Tests (#200, #206) — COMPLETE (Merged PR #214, commit `56d35d1`)

- **Task 1.2.C.1: Validate Required Repertoire Composer in Class Checkout ([#200](https://github.com/pafenorthwest/Festival/issues/200))**:
  - **Problem**: Runtime checkout JSON was only validating repertoire title and duration; missing or blank composer bypassed validation despite `RepertoirePiece.composer: string` domain contract.
  - **Action**: Validate that each repertoire item contains a non-blank composer string prior to checkout intent creation; validate all persisted repertoire fields consistently.
  - **Acceptance Criteria**:
    - Missing or whitespace-only composer returns `400 Bad Request` before intent creation.
    - Valid composer, optional movement, title, and positive finite duration are persisted.
    - HTTP-level route regression test and service-level test added.

- **Task 1.2.C.2: Test Class Checkout Resolution Scoped to Organization & Festival ([#206](https://github.com/pafenorthwest/Festival/issues/206))**:
  - **Problem**: Route and service layer must guarantee strict scoping to tenant and festival, preventing cross-festival leakage or unintended primary-festival fallbacks.
  - **Action**: Implement comprehensive route isolation tests covering:
    - Named non-primary festival with matching class succeeds.
    - Nonexistent festival returns clean `404 Not Found`.
    - Primary-festival class ID rejected when attempted through another festival URL.
    - Cross-organization class IDs fail without data leakage.
  - **Acceptance Criteria**:
    - Scoped route passes `festivalShortName` to service.
    - Tests verify zero primary-festival fallback behavior.

---

### 3.3 Step 1.3: Remaining Phase 2 Endpoints & Feature Gaps — IN PROGRESS

**Status**: COMPLETE (Task 1.3.1 COMPLETE; Task 1.3.2 COMPLETE)

**Objective**: Implement remaining backend feature requirements for registration metadata editing and class product lifecycle sync.

#### Task 1.3.1: Registration Metadata Edit Endpoint with 6-Week Cutoff (#138, #141) — COMPLETE (Merged PR #215, commit `22fc298`)
- Mount endpoint: `PATCH /api/organizations/:slug/festivals/:festivalShortName/registration/class-registrations/:registrationId/metadata` in [`packages/backend/src/routes/customer/customer-registration.routes.ts`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/backend/src/routes/customer/customer-registration.routes.ts).
- **Business Invariants**:
  - Calculate cutoff timestamp: `festival.start_date` minus 42 days (6 weeks) evaluated in the festival's configured IANA timezone (`festival.timezone`).
  - If `currentTime >= cutoffTimestamp`, reject edit with `422 Unprocessable Entity` ("Registration metadata edits are closed for this festival.").
  - Permitted edits: Update piece title, composer, movement, duration, or accompanist selection.
  - Invariant protection: Permitted edits must NEVER alter class entitlement, class selection, child, teacher snapshot, or price paid.
- **Outcome**: Merged in PR #215 (commit `22fc298`).

#### Task 1.3.2: Shopify Class Product Lifecycle Sync / Mock (#141) — COMPLETE
- In [`packages/backend/src/services/admin-class-catalog.service.ts`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/backend/src/services/admin-class-catalog.service.ts):
  - **On Class Creation**: Automatically create a digital, no-shipping Shopify product with a single trusted variant; record and audit `shopify_product_id` and `shopify_variant_id`.
  - **On Class Update**: Propagate class price updates immediately to the associated Shopify variant.
  - **On Class Deactivation**: Non-destructively set Shopify product status to draft/archived; block new checkout attempts.
  - **Dev Environment Resilience**: Transparent mock behavior when Shopify partner credentials are not configured in local development.
- **Outcome**: Implemented `AdminClassCatalogService`, `AdminClassShopifySync`, audit tracking, mock fallback, status archiving/unarchiving on `ShopifyAdminApiClient`, wired into `OrganizationService` and admin routes with full test coverage in `packages/backend/tests/admin-class-catalog-service.test.ts`.

---

### 3.4 Step 1.4: Frontend Workflows

**Objective**: Deliver complete administrative and parent-facing user interfaces for class management, registration, and checkout.

#### Task 1.4.1: Admin Class Catalog UI
- Replace stub in [`packages/frontend/src/pages/FestivalAdminClassesPage.tsx`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/frontend/src/pages/FestivalAdminClassesPage.tsx):
  - **Class Catalog Table**: Display classes with division, subtype, title, price, capacity, and active status badge.
  - **Create Class Modal/Form**:
    - Select same-tenant active Division and Subtype.
    - Configure Title, optional Description, Price (non-negative decimal), Default Capacity (prefilled to 100), Minimum/Maximum Age, Performance Minutes.
  - **Edit Class Modal/Form**:
    - Enforce immutability: Festival, Division, and Subtype cannot be changed after creation.
    - Editable fields: Title, Description, Price, Capacity, Active/Inactive status toggle.
  - Access control and tenant validation (restricted to Organization Admin).

#### Task 1.4.2: Customer Class Registration & Checkout Flow
- Implement customer class registration pages and components in `packages/frontend/src/pages/`:
  - **Step 1: Performer Selection**: Select existing child or enroll child; trigger age snapshot verification.
  - **Step 2: Division Selection**: Select festival division (enabled after child selection).
  - **Step 3: Teacher Selection**: Select teacher associated with child/division; preview teacher snapshot.
  - **Step 4: Class Selection**: Present class catalog filtered strictly by selected festival, division, active status, and child's age eligibility.
  - **Step 5: Repertoire Entry**: Input musical piece details (Title, Composer with catalog typeahead or free-text, Movement text, Duration in seconds).
  - **Step 6: Accompanist Selection**: Select registered festival accompanist or choose explicit **None**.
  - **Step 7: Checkout Initiation**: Review registration summary; initiate checkout; redirect to Shopify hosted checkout URL.
  - **Step 8: Post-Checkout Processing**: Return page from Shopify displaying processing status while webhook verifies payment and creates class entitlement.
- **Customer Registration Management**:
  - In `CustomerAccountOrdersPage.tsx` or dedicated registration view: display registered classes.
  - Enable "Edit Repertoire / Accompanist" action only prior to the 6-week cutoff date.

---

### 3.5 Step 1.5: End-to-End Integration Verification & Sign-off Gate

**Objective**: Formal verification of end-to-end user journeys, domain invariants, and security boundaries.

- **Verification Criteria**:
  1. **Full Test Suite Clean**: Zero errors, zero warnings on `bun run build && bun run test`.
  2. **End-to-End User Journey Verified**:
     - Admin class catalog setup -> Shopify product/variant sync.
     - Customer child enrollment -> Class registration form -> Checkout redirect -> Webhook processing -> Entitlement creation.
  3. **Hard Invariants Verified**:
     - 90-day age snapshot rejection (including stale-but-future-valid case).
     - Metadata write failure compensation without abandoned intents.
     - Repertoire composer non-blank validation before intent creation.
     - Scoped festival routing with zero primary-festival fallback.
  4. **Cutoff Boundary Testing**:
     - Metadata edit allowed at 6 weeks minus 1 minute in festival timezone.
     - Metadata edit strictly blocked at 6 weeks exact in festival timezone.
  5. **Formal Sign-off Gate**:
     - Execution of Part 2 is strictly blocked until Step 1.5 verification is signed off.

---

## 4. Part 2: Post-Phase 2 Schema Re-baseline & Migration Reset (Gated on Step 1.5 Sign-off)

> [!IMPORTANT]
> **Milestone Gate**: Execution of Part 2 is strictly gated on Step 1.5 sign-off. No schema re-baselining or deletion of migration files may occur while Phase 2 implementation is active.

### 4.1 Ground-Up Schema Re-baseline

Once Phase 2 is frozen and signed off:

1. **Consolidate Canonical Schema**:
   - Merge all tables, indexes, constraints, and triggers into a single clean DDL script: [`database/postgres17-schema.sql`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/database/postgres17-schema.sql).
   - Ensure clean table ordering, foreign-key constraints, tenant isolation (`organization_id`), and indexes.
   - Synchronize [`packages/backend/src/repo/postgres-schema.ts`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/packages/backend/src/repo/postgres-schema.ts) with the updated canonical DDL.
2. **Retire Interim Migration Scripts**:
   - Delete all interim migration files created during Phase 2 development:
     - `database/migrations/20260922_musical_repertoire.sql`
     - `database/migrations/20260922_musical_repertoire.concurrent-index.sql`
   - Clean up `database/migrations/` so the repository has a single, clean starting state.

### 4.2 Developer Tooling: Database Reset Workflow

Codify the developer database reset workflow into automated tooling to eliminate manual friction:

- **Create Reset Script** (`scripts/reset-dev-db.ts` or `scripts/reset-dev-db.ps1`):
  1. Terminate active database connections.
  2. Drop all tables, schemas, and custom types in the target PostgreSQL database.
  3. Execute [`database/postgres17-schema.sql`](file:///c:/Users/gusto/.gemini/antigravity/scratch/Festival/database/postgres17-schema.sql).
  4. Run database seed script (`packages/backend/scripts/seed-dev-data.ts`) to populate default organization, festival admin, divisions, and sample catalog.
- **Add Package Script**:
  - Add `"db:reset": "bun run scripts/reset-dev-db.ts"` to root `package.json`.
  - Document the command in `README.md` and `database/README.md`.

### 4.3 Phase 3 Migration Readiness

Phase 3 introduces critical production features:
- Issue [#28](https://github.com/pafenorthwest/Festival/issues/28): Soft-capacity allocation, capacity reservation, waitlists.
- Multi-line cart checkout and family bundle purchases.
- Verified-payment capacity confirmation.

**Migration Protocol for Phase 3 and Beyond**:
1. **Immutable Baseline**: The post-Phase-2 `postgres17-schema.sql` becomes Version 1.0.0.
2. **Sequential Versioned Migrations**: All future changes will be placed in `database/migrations/` using timestamped naming (e.g., `YYYYMMDDHHMMSS_phase3_capacity_allocation.sql`).
3. **Migration Runner**: Introduce a lightweight, transactional migration tracking table (`schema_migrations`) that records applied migration checksums and execution timestamps.
4. **Backward Compatibility Rules**:
   - Every Phase 3 migration must be non-breaking and support zero-downtime / rolling deployments.
   - New columns must be nullable or include default values.
   - Multi-phase schema changes (expand/contract pattern) will be enforced for any column rename or type mutation.

---

## 5. Execution Summary Table

```
Phase 2 Completion (Part 1)
├── Step 1.1: PR #208 Finalization (strip legacy JSON fallback, atomic relational snapshot) [COMPLETE - Merged, commit 3a26350]
├── Step 1.2: Backend Hardening & Follow-ups Gate (Issue #211 CLOSED) [COMPLETE]
│    ├── Cluster A: Route & DTO Hygiene (#204, #205) [COMPLETE - Merged PR #212, commit edab5d4]
│    ├── Cluster B: Core Invariants & Compensation Boundaries (#143, #199, #203) [COMPLETE - Merged PR #213, commit 7e10a66]
│    └── Cluster C: Route Isolation & Validation Tests (#200, #206) [COMPLETE - Merged PR #214, commit 56d35d1]
├── Step 1.3: Remaining Phase 2 Endpoints [IN PROGRESS]
│    ├── Task 1.3.1: Metadata edit endpoint with 6-week festival timezone cutoff (#138, #141) [COMPLETE - Merged PR #215, commit 22fc298]
│    └── Task 1.3.2: Shopify Class Product lifecycle sync / mock (#141) [IN PROGRESS]
├── Step 1.4: Frontend Workflows (Admin class catalog UI, Customer registration & checkout UI) [PENDING]
└── Step 1.5: End-to-End Integration Verification & Sign-off Gate [PENDING]
         │
         ▼ [GATE: Step 1.5 Sign-Off Complete]
         │
Post-Phase 2 Schema Re-baseline & Migration Reset (Part 2) [PENDING]
├── Ground-Up Schema Re-baseline (Consolidate postgres17-schema.sql, retire interim migrations)
├── Developer Tooling (Automated bun run db:reset workflow)
└── Phase 3 Migration Readiness (Versioned migrations & backward-compatibility invariants)
```
