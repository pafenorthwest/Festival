# Establish Goals

## Status

- Task name: shopify-integration-scopes-layout
- Iteration: v1
- State: locked

## Request

- Update the Shopify integration instructions and verified scope presentation on
  `/org/:slug/admin/integrations` so they match `SETUP.md`, including additional
  required scopes. Tighten and frame the rendered Shopify settings presentation
  above the credential inputs.

## Blocking ambiguity

- None.

## Assumptions

- The scoped settings presentation is the verification/capabilities/webhook
  content rendered when `props.app.shopifySettings()` is present, not the setup
  instruction card above it.
- The provided working scopes are authoritative and will replace the stale
  three-scope `SETUP.md` example:
  `read_customers,read_orders,read_products,write_products,customer_read_customers,customer_read_draft_orders,customer_read_metaobjects,customer_read_orders`.

## Goals

1. Update `SETUP.md`, the setup instructions, and required verified Shopify
   scope/capability diagnostics to use the eight confirmed working scopes:
   `read_customers`, `read_orders`, `read_products`, `write_products`,
   `customer_read_customers`, `customer_read_draft_orders`,
   `customer_read_metaobjects`, and `customer_read_orders`.
2. Present every confirmed scope's verified status on
   `/org/:slug/admin/integrations`, and flag missing confirmed scopes after
   verification.
3. Tighten the Shopify settings presentation by 50% vertically, reduce its type
   size by approximately 12%, add a gray rounded border consistent with text
   inputs, and add clear bottom spacing before the credential fields.

## Non-goals

- Do not alter Shopify token acquisition or unrelated integration cards.

## Success criteria

- [G1] `SETUP.md`, page instructions, backend scope diagnostics, and frontend
  display all enumerate the same eight confirmed scopes, with coverage for
  missing-scope reporting.
- [G2] Verified integrations show the status of all eight scopes and surface any
  missing scope as a warning.
- [G3] The settings presentation uses 50% less vertical spacing, about 12%
  smaller text, an input-like gray rounded border, and visibly separates from
  the inputs below; relevant automated tests pass.

## Next action

- Hand off to implement
