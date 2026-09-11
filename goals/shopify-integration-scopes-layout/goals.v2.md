# Goals Extract
- Task name: shopify-integration-scopes-layout
- Iteration: v2
- State: locked

## Goals

1. Update `SETUP.md`, the setup instructions, and required verified Shopify
   scope/capability diagnostics to use the eight confirmed working scopes:
   `read_customers`, `read_orders`, `read_products`, `write_products`,
   `customer_read_customers`, `customer_read_draft_orders`,
   `customer_read_metaobjects`, and `customer_read_orders`.
2. Treat `read_customers` as a special scope that requires manual verification:
   present that requirement on `/org/:slug/admin/integrations` and exclude it
   from automatic missing-scope warnings. Continue automatically verifying and
   warning for the other seven scopes.
3. Render verified scope rows as an indented list without bullet markers.
4. Keep the Shopify settings presentation at 50% less vertical spacing, reduce its type
   size by approximately 12%, add a gray rounded border consistent with text
   inputs, and add clear bottom spacing before the credential fields.


## Non-goals

- Do not alter Shopify token acquisition or unrelated integration cards.


## Success criteria

- [G1] `SETUP.md`, page instructions, backend scope diagnostics, and frontend
  display all enumerate the same eight confirmed scopes, with coverage for
  missing-scope reporting.
- [G2] `read_customers` is clearly designated as manually verified and cannot
  trigger a missing-scope warning; every other configured scope remains in the
  automatic missing-scope warning.
- [G3] Verified-scope rows are indented and have no bullet markers.
- [G4] The settings presentation uses 50% less vertical spacing, about 12%
  smaller text, an input-like gray rounded border, and visibly separates from
  the inputs below; relevant automated tests pass.

