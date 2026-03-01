# Drops and Refunds

## Goal
Handle class drops and monetary refunds with dual-system reconciliation.

## Shopify operations
- Use `refundCreate` for order refunds in Shopify.
- Preserve app-side refund status and correlation IDs to ensure retry/reconciliation handling.

## Stripe operations
- Issue Stripe refund against payment intent/charge used in checkout flow.
- Mark drop/refund complete only when both Shopify and Stripe refund operations succeed or are explicitly compensated.

## References
- https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate
- https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund
- https://shopify.dev/docs/api/admin-graphql/latest/objects/Order
