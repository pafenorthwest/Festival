# Guardian/Parent Records

## Goal
Maintain app-level payer records for guardians/parents while linking each payer to a Shopify customer.

## Shopify operations
- `customerSet` (Admin GraphQL) to create or update the linked Shopify customer.
- Optional tags/metafields to label payer role (`guardian` or `parent`) and map app IDs.

## Notes
- App database remains system-of-record for payer-specific registration metadata.
- Shopify customer ID is stored in app records for reconciliation.

## References
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/customerSet
- https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet
