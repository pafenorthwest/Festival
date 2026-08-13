# Goals Extract
- Task name: normalize-shopify-implied-read-scopes
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Canonicalize `write_products` as implying `read_products`.
2. Derive capability diagnostics from effective scopes.
3. Apply effective scopes to token authorization.
4. Preserve unrelated fail-closed capabilities.
5. Test the observed Shopify token response.
6. Pass lint, build, and tests.

## Non-goals

- Weakening protected operations or changing unrelated Shopify/UI behavior.

## Success criteria

- `read_orders,write_products` yields granted product read/write capabilities and supports the required product workflow.
- Missing product read/write permission remains denied.
- Canonical verification passes.
