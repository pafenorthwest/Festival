# Establish Goals

## Status

- Task name: shopify-integration-scopes-layout
- Iteration: v0
- State: blocked

## Request

- Update the Shopify integration instructions and verified scope presentation on
  `/org/:slug/admin/integrations` so they match `SETUP.md`, including additional
  required scopes. Tighten and frame the rendered Shopify settings presentation
  above the credential inputs.

## Blocking ambiguity

- Which exact Shopify scope list should the page require and present? The current
  `SETUP.md` example and the page both say
  `read_orders,read_products,write_products`, while the request says additional
  scopes are needed. Please provide the intended complete comma-separated list,
  or point to the specific `SETUP.md` section whose newer list should be used.
- Should the visual reductions use the midpoint values (about 12% smaller text
  and 50% less vertical spacing), or do you have exact CSS values/design tokens
  to apply?

## Assumptions

- The scoped settings presentation is the verification/capabilities/webhook
  content rendered when `props.app.shopifySettings()` is present, not the setup
  instruction card above it.

## Goals

1. Pending scope clarification: update the setup instruction scope list and
   verified-scope/capability display to the complete required list from SETUP.
2. Tighten the Shopify settings presentation by roughly half vertically, reduce
   its type size modestly, add a rounded gray input-like border, and separate it
   clearly from the credential fields below.

## Non-goals

- Do not modify Shopify authorization behavior, database schema, or unrelated
  integration cards unless the confirmed scope list requires it.

## Success criteria

- [G1] The page's setup instructions and verified scope display enumerate the
  confirmed required scopes, with automated coverage for any changed scope
  diagnostics.
- [G2] The settings presentation has the confirmed compact styling, rounded gray
  border, and bottom separation before the inputs; relevant frontend tests pass.

## Next action

- Ask blocking questions
