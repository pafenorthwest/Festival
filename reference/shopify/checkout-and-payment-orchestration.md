# Checkout and Payment Orchestration

## Goal
Process payment through coordinated Shopify and Stripe operations.

## Shopify operations
- Use Storefront `cartCreate` and related cart APIs to produce checkout URLs and line-item state.
- Use app-side cart validation first (eligibility + class dependencies) before cart submission.

## Stripe coordination
- Create Stripe payment intents from app backend after cart validation.
- Store reconciliation identifiers (cart/order IDs, payment intent IDs) in app and optionally Shopify metadata.

## Notes
- Custom cart constraints are app-level, not Shopify-native discount/script rules.
- No discount rules are implemented for this project.

## References
- https://shopify.dev/docs/api/storefront/latest/mutations/cartCreate
- https://shopify.dev/docs/api/storefront/latest/mutations/cartLinesAdd
- https://shopify.dev/docs/api/storefront/latest/objects/Cart
- https://shopify.dev/docs/api/storefront/latest/mutations/cartBuyerIdentityUpdate
