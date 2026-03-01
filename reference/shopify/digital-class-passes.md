# Digital Class Passes

## Goal
Represent class registrations as digital passes usable for physical festival entry.

## Shopify modeling options
- Model purchasable classes as products/variants.
- Persist pass/student linkage through metafields or order/customer metadata.
- Keep detailed student-specific metadata editable in external app systems; mirror only required data into Shopify.

## Notes
- Pass token generation and validation remain app-owned.
- Shopify stores commercial artifacts (products/orders/customer linkage), not full eligibility state.

## References
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate
- https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet
