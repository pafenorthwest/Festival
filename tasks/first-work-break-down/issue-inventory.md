# Issue Inventory

## Dedup Notes
- Existing coverage to preserve:
  - `#16` `Database and Auth Foundation` covers Firebase identity, local `app_user`, and login audit foundations.
  - `#15` `Implement Organization Onboarding Pages (UI Only, No Backend)` matches the UI scaffold scope the user referenced as `#17`.
- Reference correction:
  - GitHub item `#17` in `pafenorthwest/Festival` is a closed pull request, `Roadmap Details`, closed on `2026-04-18`.
  - For dedup purposes, the onboarding scaffold exclusion is applied to issue `#15`.

## Phase 0 — Org + Auth Foundation
- Existing: `#16` Backend identity foundation.
- Existing: `#15` UI-only onboarding scaffold.
- New planned issues:
  1. `#20` `Phase 0 Backend: Organization and Membership Foundation API` (`backend API`)
  2. `#21` `Phase 0 Backend: Tenant Context and Role Authorization Middleware` (`backend API`)
  3. `#22` `Phase 0 Frontend: Integrate Onboarding Flow with Firebase and Org APIs` (`frontend UI`)

## Phase 1 — Memberships via Shopify
1. `#23` `Phase 1 Backend: Shopify Membership Ingestion and Customer Mapping` (`backend API`)
2. `#24` `Phase 1 Backend: Membership Directory and Division Configuration APIs` (`backend API`)
3. `#25` `Phase 1 Frontend: Membership and Division Administration UI` (`frontend UI`)

## Phase 2 — Class Purchases
1. `#26` `Phase 2 Backend: Class Entitlements and Registration Metadata APIs` (`backend API`)
2. `#27` `Phase 2 Frontend: Performer and Registration Metadata Flows` (`frontend UI`)

## Phase 3 — Cart Logic + Waitlists
1. `#28` `Phase 3 Backend: Capacity Holds and Waitlist Engine` (`backend API`)
2. `#29` `Phase 3 Frontend: Cart Holds and Waitlist Experience` (`frontend UI`)

## Phase 4 — Performance
1. `#30` `Phase 4 Platform: Registration Spike Performance Hardening` (`combined`)

## Phase 5 — Scheduling + Physical Space Modeling
1. `#31` `Phase 5 Backend: Scheduling Domain and Assignment APIs` (`backend API`)
2. `#32` `Phase 5 Frontend: Manual Scheduling and Export Workspace` (`frontend UI`)

## Side Quests
1. `#33` `Side Quest: Communications Automation` (`combined`)
2. `#34` `Side Quest: Volunteer Portal` (`combined`)
3. `#35` `Side Quest: Drop and Transfer Management` (`combined`)
4. `#36` `Side Quest: Admin Billing Reconciliation` (`combined`)
5. `#37` `Side Quest: Music Review App and Catalog Cleanup` (`combined`)
