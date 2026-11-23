# Pull Request Roadmap & Issue Grouping Proposal

This document outlines the architecture boundaries of the Festival monorepo, catalogs all 21 open GitHub issues by architectural layer and functional domain, establishes best practices for combining vs. separating Front End and Back End work in pull requests, and proposes a sequenced PR roadmap for team review.

> [!NOTE]
> **Active Master Ledger (`2026-11-17`)**: [specs/pre-thanksgiving-program.md](../specs/pre-thanksgiving-program.md) is the authoritative active execution ledger (`S00`–`S20`). Since this initial issue-grouping draft, `#332` (`#383`), `#327` (`#396`), `#330` (`#396`), `#336` (`#412`), `#410` checkout restoration code (`#413`; Issue `#410` stays open pending live partial-payment E2E), `S09`–`S14` modularization, `S15` (`#414`), and `S16` (`#415`) have merged onto `main`. Pre-`v0.4.0` work now runs along two tracks ahead of the **December 1, 2026 Phase 1 Live Launch** (Paid Teacher Shopify checkout + `$0` Unpaid Accompanist form; paid Accompanist `#133` deferred to summer): sequential `teacher-directory` packets **`S17` (`#417`) -> `S18` (`#416`) -> `S19` (`#418`, `READY`, `D6` locked: `exactly 1` active division)** alongside parallel `catalog-repertoire` packet **`S20` (`#359` Admin Concerto Repertoire CSV import/export, `READY`)**, leaving December (`Dec 1–31` -> `v1.0.0`) focused on **Phase 2 Student Class Registration** (`#357`, `#328`–`#329`, `#333`–`#335`, `#340`, `#341`).

---

## 1. Overview & Architecture Boundaries

Festival is structured as a Bun workspace monorepo with strict separation of concerns across four primary boundaries:

- **`packages/frontend` (Front End)**:
  - **Tech Stack**: SolidJS, TypeScript, and global CSS (`packages/frontend/src/styles.css`).
  - **Responsibilities**: Client-side routing and app shell (`src/app/`), route-scoped domain state (`src/domains/*`, `S13`), reusable UI components and modals (`src/components/`), route page views and page-specific helpers (`src/pages/`), typed Hono RPC domain API clients (`src/lib/api/*`, `S12`) and cart state (`src/lib/`), and frontend unit/integration tests (`tests/`).
  - **Related UI Extension**: `packages/shopify-confirmation` provides the Shopify checkout thank-you and order-status return UI extension.

- **`packages/backend` (Back End)**:
  - **Tech Stack**: Hono HTTP server on Bun, PostgreSQL repositories, Firebase Admin authentication, and Shopify Admin/Storefront API clients.
  - **Responsibilities**: HTTP route handlers (`src/routes/`), per-domain DI composition (`src/composition/*`, `S14`), bounded-context domain modules (`src/domains/*` across `tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, and `commerce-projection`, `S09`–`S11`) alongside legacy domain/service modules (`src/services/`, `src/volunteers/`, `src/communication/`, `src/repo/`, `src/checkout/`, `src/customer/`, etc.), authentication/security middleware (`src/auth/`, `src/security/`, `src/middleware/`), and backend tests (`tests/`).

- **`packages/common` (Shared Contracts)**:
  - **Tech Stack**: Pure TypeScript domain contracts, types, and validation logic (`organization.ts`, `customer-account.ts`, `repertoire.ts`, `registration.ts`, `entitlements.ts`, `shopify.ts`, etc.).
  - **Responsibilities**: Acts as the contract boundary consumed by both `packages/frontend` and `packages/backend`.

- **`database/` (Database Schema & Migrations)**:
  - **Tech Stack**: PostgreSQL 17 SQL schemas (`postgres17-schema.sql`), timestamped migrations (`database/migrations/`), and seed scripts (`database/seeds/`).

---

## 2. Open Issues Grouped by Related Scope

All 21 open issues have been standardized with `Front End:`, `Back End:`, or `Front End / Back End:` prefixes to make architectural ownership immediately visible.

### Group A: Repertoire Validation & Customer Account Repertoire Editing

| Issue    | Title                                                                                        | Layer                | Primary Affected Files                                                                                                                                              |
| :------- | :------------------------------------------------------------------------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#329** | `Back End: Validate repertoire piece limits before querying the catalog`                     | Back End             | `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`, backend checkout/metadata tests                                                         |
| **#328** | `Back End: Use canonical work details for catalog-linked registration repertoire`            | Back End             | `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`, backend checkout/metadata tests                                                         |
| **#330 (DONE in #396)** | `Front End / Back End: Resolve 404 bugs in CustomerAccountOrdersPage handleSaveRepertoire`   | Front End / Back End | `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`, `packages/common/src/customer-account.ts`, `packages/backend/src/domains/class-checkout/` |
| **#327 (DONE in #396)** | `Front End: Let families select a concerto catalog work when editing existing registrations` | Front End            | `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`, `packages/frontend/src/components/ConcertoTitleField.tsx`, `packages/frontend/src/components/FestivalRepertoireModal.tsx` |

### Group B: Organization & Festival Admin UI / CSS Layout Polish

| Issue    | Title                                                                          | Layer     | Primary Affected Files                                                                                                                                                 |
| :------- | :----------------------------------------------------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#336 (DONE in #412)** | `Front End: Move classes popover below the top of the page` | Front End | `packages/frontend/src/styles.css`, `packages/frontend/src/components/FestivalClassModal.tsx`, `packages/frontend/src/pages/FestivalAdminClassesPage.tsx` |
| **#335** | `Front End: Improve membership cards with separated details and actions`       | Front End | `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`, `packages/frontend/src/styles.css`                                                                      |
| **#334** | `Front End: Display entitlement state badges in a wrapping horizontal list`    | Front End | `packages/frontend/src/pages/AdminEntitlementOperationsSection.tsx`, `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`, `packages/frontend/src/styles.css` |
| **#333** | `Front End: Fix overlapping festival dates and controls in organization admin` | Front End | `packages/frontend/src/pages/AdminFestivalsPage.tsx`, `packages/frontend/src/components/FestivalRegistrationWindowEditor.tsx`, `packages/frontend/src/styles.css`      |

### Group C: Public Front Page Redesign

| Issue    | Title                                                                               | Layer     | Primary Affected Files                                                                                                                                                                  |
| :------- | :---------------------------------------------------------------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#332 (DONE in #383)** | `Front End: Redesign front page with organization grid and new organization signup` | Front End | `packages/frontend/src/pages/HomePage.tsx`, `packages/frontend/src/pages/OrganizationChooser.tsx`, `packages/frontend/src/components/AppHeader.tsx`, `packages/frontend/src/styles.css` |

### Group D: Phase 4 & Phase 5 Core Roadmap Deliverables

| Issue    | Title                                                                                       | Layer                | Primary Affected Files                                                                                                                                                                                              |
| :------- | :------------------------------------------------------------------------------------------ | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#260** | `Front End / Back End: Phase 4 Multi-Line Item Recovery`                                    | Front End / Back End | `packages/backend/src/checkout/`, `packages/backend/src/commerce/`, `packages/frontend/src/pages/CustomerCheckoutRecoveryPage.tsx`, `packages/frontend/src/pages/AdminCheckoutRecoveryPage.tsx`, `packages/common/` |
| **#30**  | `Back End: Phase 4 Registration Spike Performance Hardening`                                | Back End             | `packages/backend/scripts/`, `packages/backend/src/customer/`, `packages/backend/src/checkout/`, `database/migrations/`                                                                                             |
| **#31**  | `Back End: Phase 5 Scheduling Domain and Assignment APIs`                                   | Back End             | `packages/backend/src/rooms/`, `packages/backend/src/routes/`, `packages/common/`, `database/migrations/`                                                                                                           |
| **#32**  | `Front End: Phase 5 Manual Scheduling and Export Workspace`                                 | Front End            | `packages/frontend/src/pages/`, `packages/frontend/src/components/`, `packages/frontend/src/lib/api.ts`                                                                                                             |
| **#38**  | `Front End / Back End (Side Quest): Personalized Schedule Portal and Public Class Schedule` | Front End / Back End | `packages/backend/src/`, `packages/frontend/src/pages/`, `packages/common/`                                                                                                                                         |

### Group E: Security, Infrastructure, Deferred & Tracking Issues

| Issue    | Title                                                                                        | Layer                | Primary Affected Files                                                                                                                   |
| :------- | :------------------------------------------------------------------------------------------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| **#95**  | `Back End: Security - Production edge, network, and operator hardening`                      | Back End / Infra     | `cloud-setup/`, `docker/`, `nginx/`, production operator runbooks                                                                        |
| **#216** | `Front End / Back End (FYI): Repository files exceeding 500 lines for modularization review` | Front End / Back End | `S09`–`S14` modularization complete; `S15` enforces `<= 500`L on new `.ts`/`.tsx` production files (plus `domains/**`, `app.ts`, `composition/**`), grandfathers existing non-domain `.ts`/`.tsx` files at `<= 2,000`L to ratchet down over time, and grandfathers `database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts` (`S16` performs no pre-release file splits) |
| **#247** | `Back End (Deferred): Shopify Defense in Depth`                                              | Back End             | Future Shopify checkout validation architecture                                                                                          |
| **#246** | `Front End / Back End (Future): Waitlist Entitlements`                                       | Front End / Back End | Future waitlist purchase-permission domain model                                                                                         |
| **#172** | `Front End / Back End (Deferred): Teacher multi-division policy and checkout snapshots`      | Front End / Back End | `packages/common/`, `packages/backend/src/checkout/`, `packages/backend/src/commerce/`, `packages/frontend/src/pages/MembershipPage.tsx` |
| **#133** | `Front End / Back End (Deferred to Summer): Paid accompanist Shopify checkout and order projection` | Front End / Back End | `packages/backend/src/checkout/`, `packages/backend/src/commerce/`, `packages/frontend/src/pages/AccompanistMembershipPage.tsx` (`Dec 1` launches `$0` unpaid Accompanist form + `#416` directory parity) |
| **#98**  | `Front End / Back End (Post-MVP): Membership cancellation and refund approval workflow`      | Front End / Back End | `packages/backend/src/commerce/`, `packages/backend/src/shopify/`, `packages/frontend/src/pages/`                                        |

### Group F: Pre-`Dec 1` Phase 1 Membership, Directory & Concerto CSV Launch Packets (`S17`–`S20` -> `v0.4.0`)

| Issue    | Title                                                                                          | Layer                | Primary Affected Files                                                                                                                                                                                                 |
| :------- | :--------------------------------------------------------------------------------------------- | :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#417 (Queued `S17`, `READY`)** | `Front End: Add Teacher and Accompanist acquisition buttons to account memberships` | Front End | `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx`, `packages/frontend/src/pages/customerMembershipStatus.ts`, `packages/frontend/src/styles.css`, frontend account membership tests |
| **#416 (Queued `S18`, `READY` after `S17`)** | `Automatically approve new accompanist public-directory listings during membership registration` *(expanded per `D5` to full `#361` parity + removing copy-pasted `staffAccessConsent` gate)* | Front End / Back End | `packages/frontend/src/pages/AccompanistMembershipPage.tsx`, `packages/common/src/commerce.ts`, `packages/frontend/src/lib/api/{directory,commerce}.ts`, `CustomerAccountMembershipsPage.tsx`, `CustomerTeacherDirectoryCard.tsx`, `AdminTeacherDirectoryPanel.tsx`, `customer-membership.routes.ts`, `packages/backend/src/domains/teacher-directory/**`, `packages/backend/src/repo/*` |
| **#418 (Queued `S19`, `READY` after `S18`)** | `Front End / Back End: Restrict post-creation Teacher membership division changes to administrators` *(locked per `D6`: `exactly 1` active division)* | Front End / Back End | `packages/common/src/{directory,profile}.ts`, `participant-profile.routes.ts`, `CustomerTeacherDirectoryCard.tsx`, `CustomerAccountMembershipsPage.tsx`, `AdminTeacherDirectoryPanel.tsx`, `packages/backend/src/domains/teacher-directory/**`, `packages/backend/src/commerce/membership-status-service.ts`, `nginx/*.conf`, `docker/nginx.festival.conf` |
| **#359 (Queued `S20`, `READY` parallel worktree)** | `Admin: Bulk import and export the Concerto repertoire catalog as CSV` *(pulled into `v0.4.0` ahead of `Dec 1`)* | Front End / Back End | `packages/common/src/{repertoire,concerto-repertoire-csv}.ts`, `packages/backend/src/domains/catalog-repertoire/**`, `packages/backend/src/routes/admin-org/admin-concerto-repertoire.routes.ts`, `packages/frontend/src/lib/api/concerto-catalog.ts`, `AdminConcertoRepertoirePage.tsx`, `AdminHomePage.tsx`, `AdminRoutes.tsx`, `nginx/*.conf`, `docker/nginx.festival.conf` |

---

## 3. Best Practices: Combining vs. Separating Front End and Back End Issues in PRs

### Why Separate Front End and Back End PRs by Default

1. **Atomic Rollback & Blast Radius**: Separating backend business logic/persistence changes from frontend UI changes ensures that a CSS/UI regression never forces a rollback of backend validation or database migrations (and vice versa).
2. **Contract-First Sequencing**: When an issue spans both layers (or when a frontend feature depends on a backend fix), landing the `@festival/common` + `packages/backend` contract change first gives the frontend PR a stable, typed, and tested API surface to build against.
3. **Focused Code Review**: Reviewers can verify backend invariants, SQL queries, and security bounds independently from DOM layout, responsive viewport behavior, and SolidJS reactivity.

### Criteria for Combining Issues into a Single PR

Multiple issues should be combined into a single PR **only** when they meet all of the following criteria:

- **Same Architectural Layer**: Both issues are pure Back End or pure Front End.
- **Shared File Neighborhood & Test Suite**: The issues modify the exact same helper functions, components, or CSS sections, such that working on them in parallel branches would guarantee merge conflicts.
- **Tightly Coupled Invariants**: Fixing them together produces cleaner, non-redundant code and unified regression tests.

### Merge-Conflict Hotspot Analysis

1. **`packages/backend/src/domains/class-checkout/class-checkout-validation.ts` (#328 and #329)**:
   - Both #328 and #329 are direct follow-ups to #322 in `class-checkout-validation.ts` (moved from `class-checkout-helpers.ts` during `S11`) and share `class-checkout-service.test.ts`. Running them on separate branches would conflict directly in validation ordering and test fixtures. **Recommendation**: Combine #328 + #329 into a single Back End PR.
2. **`packages/frontend/src/pages/CustomerAccountOrdersPage.tsx` (#330 and #327 — DONE in #396)**:
   - Both `#330` (exposing `festivalShortName` and passing `entitlement.id` in `handleSaveRepertoire`) and `#327` (selecting concerto catalog works when editing existing registrations) landed together in PR `#396`.
3. **`packages/frontend/src/styles.css` (#333, #334, #335, #336, and #332 — #332 DONE in #383; #336 DONE in #412)**:
   - `#332` landed in PR `#383` and `#336` landed in PR `#412` (`84df859`), leaving `#333`, `#334`, and `#335` in `packages/frontend/src/styles.css`.
   - Grouping the remaining three Admin UI layout fixes (#333, #334, #335) avoids CSS merge conflicts.
4. **`teacher-directory` Account & Admin UI Slice (#417 `S17` -> #416 `S18` -> #418 `S19`) vs. `catalog-repertoire` (#359 `S20`)**:
   - `#417` (`S17`), `#416` (`S18`), and `#418` (`S19`, `READY`, `D6` locked: `exactly 1` active division) share `CustomerAccountMembershipsPage.tsx`, `CustomerTeacherDirectoryCard.tsx`, `AdminTeacherDirectoryPanel.tsx`, `domains/teacher-directory/**`, and profile/account test suites (`12+` overlapping files between `S18` and `S19`). **Resolution**: Execute `S17 -> S18 -> S19` sequentially, while running `#359` (`S20`) in a parallel `catalog-repertoire` worktree (`100%` disjoint from `S17`–`S18`, and disjoint across all domain/UI modules from `S19`).

---

## 4. Proposed Draft PR Roadmap

```mermaid
flowchart LR
  subgraph Tier1["Tier 1: Immediate Actionable Bugfix & UI PRs"]
    PR1["PR 1 (Back End)<br/>#328 + #329<br/>Repertoire Catalog Validation"]
    PR2["PR 2 (FE / BE Bugfix - DONE #396)<br/>#330<br/>Fix handleSaveRepertoire 404s"]
    PR3["PR 3 (Front End - DONE #396)<br/>#327<br/>Concerto Selector in Account Editor"]
    PR4["PR 4 (Front End Admin UI)<br/>#333 + #334 + #335 (#336 DONE #412)<br/>Admin Layout & Card Fixes"]
    PR5["PR 5 (Front End Public UI - DONE #383)<br/>#332<br/>Front Page Org Grid Redesign"]
    PR1 --> PR2 --> PR3
    PR4 --> PR5
  end

  subgraph Active["Active Pre-Dec 1 Launch & Dec Phase 2 QA Ledger"]
    DoneW4["Merged on main<br/>#412 (#336) + #413 (#410) + S15 (#414) + S16 (#415)"]
    S17S19["Sequential teacher-directory Track<br/>S17 (#417) -> S18 (#416) -> S19 (#418 READY)"]
    S20CSV["Parallel catalog-repertoire Worktree<br/>S20 (#359 Concerto CSV Import/Export)"]
    Cut040["Cut v0.4.0<br/>Dec 1 Phase 1 Live Launch"]
    DecQA["December Phase 2 Student Class Reg QA<br/>#357 + #328-#329 + #333-#335 + #340 + #341 -> v1.0.0"]
    DoneW4 --> S17S19 --> Cut040
    DoneW4 --> S20CSV --> Cut040
    Cut040 --> DecQA
  end

  subgraph Tier2["Tier 2: Phase 4 & Phase 5 Deliverables"]
    PR6["PR 6 (FE / BE)<br/>#260: Multi-Line Recovery"]
    PR7["PR 7 (Back End)<br/>#30: Spike Hardening"]
    PR8["PR 8 (Back End)<br/>#31: Phase 5 Scheduling APIs"]
    PR9["PR 9 (Front End)<br/>#32: Phase 5 Scheduling UI"]
    PR10["PR 10 (FE / BE)<br/>#38: Schedule Portal"]
    PR11["PR 11 (Back End / Infra)<br/>#95: Production Hardening"]
    PR8 --> PR9 --> PR10
  end
```

### Tier 1: Immediate Actionable Bugfix & UI PRs

> Merged Wave 4 stabilization PRs (`#412` closing `#336`, `#413` landing `#410` checkout restoration code while `#410` stays open pending live partial-payment E2E, `S15` `#414`, and `S16` `#415`), sequential `teacher-directory` packets `S17` (`#417`) -> `S18` (`#416`) -> `S19` (`#418`, `READY`), parallel `catalog-repertoire` packet `S20` (`#359`), and December Phase 2 Student Class Registration QA items (`#357`, `#340`, `#341`) are tracked in [specs/pre-thanksgiving-program.md](../specs/pre-thanksgiving-program.md).

#### PR 1 — Back End: Repertoire Catalog Validation Hardening

- **Issues Included**:
  - **#329**: `Back End: Validate repertoire piece limits before querying the catalog`
  - **#328**: `Back End: Use canonical work details for catalog-linked registration repertoire`
- **Layer**: Pure Back End (`packages/backend`)
- **Scope & Files**:
  - `packages/backend/src/domains/class-checkout/class-checkout-validation.ts`
  - `packages/backend/tests/class-checkout-service.test.ts` and customer metadata edit tests
- **Rationale**: Both issues modify the exact same validation helper function in `class-checkout-validation.ts`. Validating array shape, piece count limits, and basic fields before issuing catalog DB lookups (#329) naturally precedes enforcing canonical work title/composer on resolved catalog works (#328).
- **Merge Order**: Independent; scheduled in December Week 2 QA per [specs/pre-thanksgiving-program.md](../specs/pre-thanksgiving-program.md).

#### PR 2 — Front End / Back End: Customer Account Repertoire Save 404 Fixes (`DONE in #396`)

- **Issues Included**:
  - **#330**: `Front End / Back End: Resolve 404 bugs in CustomerAccountOrdersPage handleSaveRepertoire` (**DONE in `#396`**)
- **Layer**: Shared Contract + Back End Summary + Front End Bugfix (`packages/common`, `packages/backend`, `packages/frontend`)
- **Scope & Files**:
  - `packages/common/src/customer-account.ts` (include `festivalShortName` on `CustomerClassEntitlementSummary` or `CustomerFestivalClassSummary`)
  - `packages/backend/src/domains/class-checkout/` (populate `festivalShortName` in customer account summary projection)
  - `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx` (pass `target.entitlement.id` instead of `target.metadata.id` and use `festivalShortName` in `handleSaveRepertoire`)
  - Unit tests in `packages/backend/tests/customer-account-service.test.ts` and `packages/frontend/tests/festival-class-registration.test.ts`
- **Status**: Merged in PR `#396` alongside `#327` and `#362`.

#### PR 3 — Front End: Concerto Catalog Work Selector in Customer Account Repertoire Editor (`DONE in #396`)

- **Issues Included**:
  - **#327**: `Front End: Let families select a concerto catalog work when editing existing registrations` (**DONE in `#396`**)
- **Layer**: Pure Front End (`packages/frontend`)
- **Scope & Files**:
  - `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`
  - `packages/frontend/src/components/ConcertoTitleField.tsx` and `packages/frontend/src/components/FestivalRepertoireModal.tsx`
  - `packages/frontend/tests/browser/order-repertoire.tsx` and `packages/frontend/tests/useConcertoCatalogSearch.test.ts`
- **Status**: Merged in PR `#396` (`pg_trgm` trigram typeahead + manual concerto entry + Orders concerto selector).

#### PR 4 — Front End: Admin Layout, Cards, Badges & Popover Polish

- **Issues Included**:
  - **#336 (DONE in #412)**: `Front End: Move classes popover below the top of the page`
  - **#335**: `Front End: Improve membership cards with separated details and actions`
  - **#334**: `Front End: Display entitlement state badges in a wrapping horizontal list`
  - **#333**: `Front End: Fix overlapping festival dates and controls in organization admin`
- **Layer**: Pure Front End (`packages/frontend`)
- **Scope & Files**:
  - `packages/frontend/src/styles.css`
  - `packages/frontend/src/pages/AdminMembershipProductsPage.tsx` (#335, #334)
  - `packages/frontend/src/pages/AdminEntitlementOperationsSection.tsx` (#334)
  - `packages/frontend/src/pages/AdminFestivalsPage.tsx` & `packages/frontend/src/components/FestivalRegistrationWindowEditor.tsx` (#333)
  - `packages/frontend/src/components/FestivalClassModal.tsx` & `packages/frontend/src/pages/FestivalAdminClassesPage.tsx` (#336, merged in PR `#412`)
- **Sub-Splitting Option (Option 4A vs. Option 4B)**:
  - **Option 4-Unified**: Combine the remaining three Admin UI/CSS polish issues (`#333`, `#334`, `#335`) in a single PR now that `#412` (`#336`) has merged to avoid `styles.css` conflicts.
  - **Option 4A + 4B Split**:
    - **PR 4A (Admin Memberships UI)**: Combine **#334 + #335** (both on `/org/:slug/admin/memberships` touching `AdminMembershipProductsPage.tsx`, `AdminEntitlementOperationsSection.tsx`, and `styles.css`).
    - **PR 4B (Admin Festivals UI)**: **#333** (`/org/:slug/admin/festivals` plus `styles.css`; **#336** merged in PR `#412`).
- **Merge Order**: `#412` (`#336`) merged (`84df859`); remaining `#333`–`#335` are scheduled in December Week 2 QA per [specs/pre-thanksgiving-program.md](../specs/pre-thanksgiving-program.md).

#### PR 5 — Front End: Public Front Page Redesign (`DONE in #383`)

- **Issues Included**:
  - **#332**: `Front End: Redesign front page with organization grid and new organization signup` (**DONE in `#383`**)
- **Layer**: Pure Front End (`packages/frontend`)
- **Scope & Files**:
  - `packages/frontend/src/pages/HomePage.tsx`
  - `packages/frontend/src/pages/OrganizationChooser.tsx`
  - `packages/frontend/src/components/AppHeader.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/onboarding-integration.test.ts`
- **Status**: Merged in PR `#383` (followed by seasonal banners in `#384`).

---

### Tier 2: Roadmap Phase 4 & Phase 5 Deliverables

| Draft PR  | Issue(s)                                                                                             | Layer                | Dependency & Sequencing Notes                                                                                                                                                   |
| :-------- | :--------------------------------------------------------------------------------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PR 6**  | **#260**: `Front End / Back End: Phase 4 Multi-Line Item Recovery`                                   | Front End / Back End | Requires #258 deployed and verified first. Can be split into PR 6A (Backend recovery state machine + projection) and PR 6B (Frontend multi-line recovery review UI) if desired. |
| **PR 7**  | **#30**: `Back End: Phase 4 Registration Spike Performance Hardening`                                | Back End             | Independent Phase 4 performance, caching, indexing, and load-test workstream.                                                                                                   |
| **PR 8**  | **#31**: `Back End: Phase 5 Scheduling Domain and Assignment APIs`                                   | Back End             | Foundation for Phase 5 scheduling. Must land **before PR 9 (#32) and PR 10 (#38)**.                                                                                             |
| **PR 9**  | **#32**: `Front End: Phase 5 Manual Scheduling and Export Workspace`                                 | Front End            | Depends on **PR 8 (#31)** backend APIs and export read models.                                                                                                                  |
| **PR 10** | **#38**: `Front End / Back End (Side Quest): Personalized Schedule Portal and Public Class Schedule` | Front End / Back End | Depends on **PR 8 (#31)** and **PR 9 (#32)**.                                                                                                                                   |
| **PR 11** | **#95**: `Back End: Security - Production edge, network, and operator hardening`                     | Back End / Infra     | Operational & edge deployment hardening; independent of application feature PRs.                                                                                                |

---

### Tier 3: Deferred, Post-MVP & Tracking Issues (No Active PR Scheduled)

These issues are explicitly marked in their specifications as FYI tracking, post-MVP, or deferred future work and should **not** be bundled into active feature PRs until scheduled:

- **#216** (`Front End / Back End (FYI): Repository files exceeding 500 lines for modularization review`): `S09`–`S14` modularization is complete. Under the settled `4A` ratchet policy (`S15`), a `500`-line limit applies to new `.ts`/`.tsx` production files (alongside `domains/**`, `app.ts`, and `composition/**`), existing non-domain `.ts`/`.tsx` files (`packages/frontend/src/lib/api/registration.ts`, `packages/backend/src/routes/customer/customer-class-checkout.routes.ts`, `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`, `packages/backend/src/checkout/in-memory-class-checkout-execution-helpers.ts`, and peers) are grandfathered at an initial `2,000`-line ceiling to ratchet down over time, and SQL/schema files (`database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts`) are explicitly grandfathered (`S16` no longer performs pre-release file splits). When future modularization is scheduled, keep each split scoped to a single package/module per PR.
- **#247** (`Back End (Deferred): Shopify Defense in Depth`): Future Shopify checkout validation layer.
- **#246** (`Front End / Back End (Future): Waitlist Entitlements`): Future waitlist purchase-permission model.
- **#172** (`Front End / Back End (Deferred): Teacher multi-division policy and checkout snapshots`): Deferred from #166.
- **#133** (`Front End / Back End (Deferred to Summer): Paid accompanist Shopify checkout and order projection`): Deferred to summer (`D5`); December 1, 2026 Phase 1 live launch uses the `$0` unpaid Accompanist registration form paired with `#416` (`S18`) Public Directory parity and `#417` (`S17`) account acquisition buttons.
- **#98** (`Front End / Back End (Post-MVP): Membership cancellation and refund approval workflow`): Split from #78; outside Teacher Membership MVP.

---

## 5. Open Decisions for Team Review

Before creating branches and opening the Tier 1 PRs, please confirm your preference on two grouping decisions:

1. **Decision 1 — Admin UI Polish Grouping (PR 4)**:
   - **Option A (Unified PR 4)**: Combine all four Admin UI layout fixes (**#333, #334, #335, #336**) into one Front End PR.
   - **Option B (Split PR 4A + PR 4B)**: Split by admin route into **PR 4A (#334 + #335 on `/org/:slug/admin/memberships`)** and **PR 4B (#333 + #336 on festival admin pages)**.

2. **Decision 2 — Customer Account Repertoire Fixes (PR 2 & PR 3)**:
   - **Option A (Sequential PR 2 then PR 3 — Recommended)**: Land **PR 2 (#330)** first to fix the 404 bugs and update the shared `CustomerClassEntitlementSummary` contract, then land **PR 3 (#327)** for the pure Front End concerto catalog selector UI.
   - **Option B (Combined PR 2+3)**: Combine **#330 + #327** into a single full-stack Customer Account Repertoire Editor PR since both center on `CustomerAccountOrdersPage.tsx`.
