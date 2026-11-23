# Consolidate Admin Memberships

## Goal reference

[Locked goals](../../goals/consolidate-admin-memberships/goals.v0.md)

## Scope

The memberships route, its Entitlements table, and the private admin report projection. The report resolves active profiles by organization, customer ID, and membership role, then applies effective teacher divisions before filtering and paging. Existing admin endpoints handle updates and revocation.

## Delivery

- Merged in PR `#446` (`ca84970`) via commits `1979fec` and `080534f`:
  - `1979fec`: Consolidated admin membership controls into the 6-column `AdminEntitlementTable.tsx` and moved Shopify reconciliation and validation (`AdminShopifyReconciliationPanel.tsx`) onto `/org/:slug/admin/integrations` (`AdminIntegrationsPage.tsx`).
  - `080534f`: Kept teacher membership edits locked across entitlement report reloads.

## Verification

- `bun run format:check`
- `bun run build`
- `bun run --cwd packages/frontend check:types`
- `bun run test`

The build, formatting, frontend and backend type checks, and test suite passed. The test run recorded 2,757 passes and 159 skips.
