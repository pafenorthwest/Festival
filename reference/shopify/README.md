# Shopify API Reference for Festival App

Last reviewed: 2026-03-01

## Purpose
This reference maps Shopify APIs to the festival registration app responsibilities:
- Guardian/parent payer records
- Digital class pass products and metadata
- Checkout/payment orchestration with Stripe coordination
- Drop/refund operations
- Webhook synchronization

## API surfaces used
- Admin GraphQL API for customers, products, metafields, refunds, and webhooks.
- Storefront API for carts and checkout URLs.

## App boundaries
- Eligibility rules and cart gating logic remain in custom app services.
- Student-specific metadata lifecycle is app-owned and only mirrored into Shopify metadata when needed.
- Discount rules are intentionally out of scope.

## Documents in this folder
- [auth-and-versions.md](./auth-and-versions.md)
- [guardian-parent-records.md](./guardian-parent-records.md)
- [digital-class-passes.md](./digital-class-passes.md)
- [checkout-and-payment-orchestration.md](./checkout-and-payment-orchestration.md)
- [drops-and-refunds.md](./drops-and-refunds.md)
- [webhooks-and-sync.md](./webhooks-and-sync.md)
