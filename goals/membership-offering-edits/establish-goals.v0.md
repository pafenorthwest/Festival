# Establish Goals

## Status

- Task name: membership-offering-edits
- Iteration: v0
- State: locked

## Request

- Rewrite GitHub issue #73 as an implementable specification for authorized Organization Admin edits to an active Teacher Membership offering's Shopify-backed title, description, and price.

## Blocking ambiguity

- None. The user confirmed that duration edits are excluded, only active offerings are editable, new Shopify prices apply only to new checkouts, and a local Festival persistence failure after Shopify succeeds is surfaced for manual reconciliation.

## Assumptions

- Product title and description are Shopify product attributes; price is the existing sole `Plan = Standard` variant's Shopify price. Festival retains the offering's stable product/variant association and immutable historical commerce/entitlement facts.

## Goals

1. An authorized Organization Admin can update only the active Teacher Membership offering's Shopify product title, description, and sole variant price through Festival's server-side, tenant-scoped Shopify Admin boundary.
2. The operation preserves the offering ID, Shopify product/variant GIDs, entitlement class, duration, existing checkout intents, validation decisions, order projections, and entitlement grants.
3. Festival validates Shopify mutation results and refreshes its local display snapshot after Shopify succeeds. If local persistence fails after a successful Shopify mutation, Festival reports a safe manual-reconciliation-required outcome and does not attempt Shopify compensation.
4. The rewritten GitHub issue contains explicit authorization, state, mutation, failure, audit, and focused-test acceptance criteria sufficient for implementation.

## Non-goals

- Editing `durationDays`, creating/replacing/retiring offerings, changing variant shape, Shopify product status/publication, shipping, taxes, fulfillment, inventory, checkout flows, or historical commerce/entitlement records.
- Browser-direct Shopify mutations, use of Storefront credentials for product administration, and automatic Shopify rollback after a local persistence failure.

## Success criteria

- [G1] The issue requires Firebase-authenticated Admin membership in the offering's Organization and rejects non-Admin, cross-tenant, inactive-offering, browser-authority, and unsupported-field attempts.
- [G2] The issue requires Shopify Admin `productUpdate` for title/description and the existing product-variant update path for price, each against the persisted offering identifiers and with bounded audit entries.
- [G3] The issue requires re-read/validation of the one-variant `Plan = Standard` product shape and current price before local snapshot persistence; successful Shopify updates become effective for future checkout price re-reads only.
- [G4] The issue requires preserving all existing checkout, decision, order, and grant snapshots, and safely surfacing local persistence failure after Shopify success for manual reconciliation.
- [G5] The issue requires focused tests for authorization, tenant isolation, active-only restriction, title/description/price updates, immutable-history preservation, Shopify and local failure handling, audit/redaction, and public/admin DTO refresh behavior.

## Next action

- Rewrite GitHub issue #73 to these locked goals.
